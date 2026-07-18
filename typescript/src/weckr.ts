import { calculateCost } from './pricing.js';
import { detectAdapter } from './providers.js';
import { createLogger, type Logger } from './logger.js';
import { createCapChecker, deriveCheckEndpoint } from './cap-cache.js';
import { capCheckToError, WeckrConfigError } from './errors.js';
import type { CapCheckResult, ChatOptions, LogPayload, WeckrConfig } from './types.js';

const DEFAULT_ENDPOINT = 'https://app.useweckr.com/api/v1/log';

export class Weckr {
  private readonly apiKey: string;
  private readonly plans: Record<string, number>;
  private readonly logger: Logger;
  private readonly checkCap: ((userId: string, planName: string, model?: string) => Promise<CapCheckResult>) | null;
  private readonly onError?: (err: unknown) => void;
  private readonly onDowngrade: (info: { userId: string; from: string; to: string }) => void;
  private readonly downgradeSeen = new Set<string>();

  constructor(config: WeckrConfig) {
    if (!config?.apiKey) {
      throw new Error('Weckr: apiKey is required.');
    }
    this.apiKey = config.apiKey;
    this.plans = config.plans ?? {};
    this.onError = config.onError;
    this.onDowngrade = config.onDowngrade ?? defaultDowngradeWarn.bind(this);

    const logEndpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.logger = createLogger({
      apiKey: config.apiKey,
      endpoint: logEndpoint,
      fetch: config.fetch,
      onError: config.onError,
    });

    if (config.disableCapCheck) {
      this.checkCap = null;
    } else {
      const checkEndpoint = config.checkEndpoint ?? deriveCheckEndpoint(logEndpoint);
      this.checkCap = createCapChecker({
        apiKey: config.apiKey,
        endpoint: checkEndpoint,
        fetch: config.fetch,
        onError: config.onError,
      });
    }
  }

  async chat<TClient, TResult = unknown>(client: TClient, options: ChatOptions): Promise<TResult> {
    const adapter = detectAdapter(client);
    if (!adapter) {
      throw new Error(
        'Weckr: could not detect provider. Pass an OpenAI, Anthropic, or Gemini client instance.',
      );
    }

    // Fail-fast on misconfigured plan name. Silent fallback to 0 revenue would
    // poison the dashboard with phantom unprofitable users.
    if (options.plan != null && !Object.prototype.hasOwnProperty.call(this.plans, options.plan)) {
      throw new WeckrConfigError(
        'unknown_plan',
        `Weckr: plan "${options.plan}" is not in the constructor's \`plans\` map. ` +
          `Add it as \`plans: { "${options.plan}": <monthly_usd> }\` when constructing Weckr.`,
      );
    }

    // Cap check (best-effort, fails open on 5xx/network — but fails CLOSED on
    // 401/403 to force config errors to surface synchronously).
    let effectiveOptions = options;
    if (this.checkCap && options.userId && options.plan) {
      const check = await this.checkCap(options.userId, options.plan, options.model);
      if (!check.allowed) {
        if (check.action === 'downgrade' && check.alternativeModel) {
          this.onDowngrade({
            userId: options.userId,
            from: options.model,
            to: check.alternativeModel,
          });
          effectiveOptions = { ...options, model: check.alternativeModel };
        } else {
          // action='block', or action='downgrade' with no alternativeModel,
          // or unexpected shape. Fail-CLOSED.
          throw capCheckToError({
            userId: options.userId,
            planName: options.plan,
            result: check,
          });
        }
      }
    }

    // Generate the event_id ONCE here so it's stable across the LLM call,
    // any retries, and the (potentially errored) log emission below. The
    // server dedupes on (project_id, event_id) — same call retried = same
    // dashboard row, not a duplicate.
    const eventId = generateEventId();

    const startedAt = nowMs();
    let result: TResult;
    try {
      result = (await adapter.call(client as never, effectiveOptions)) as TResult;
    } catch (err) {
      // LLM call failed (provider 5xx, timeout, content policy, etc.).
      // Log an error row so the dashboard sees the failure, then re-throw.
      const latencyMs = Math.round(nowMs() - startedAt);
      this.tryLog(
        adapter.name,
        effectiveOptions,
        { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0 },
        latencyMs,
        eventId,
      );
      throw err;
    }
    const latencyMs = Math.round(nowMs() - startedAt);

    let usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0 };
    try {
      usage = adapter.extractUsage(result);
    } catch (err) {
      this.onError?.(err);
    }
    this.tryLog(adapter.name, effectiveOptions, usage, latencyMs, eventId);

    return result;
  }

  /**
   * Return the eventId of the last call alongside the result. Useful when the
   * caller wants to correlate this specific LLM call to a dashboard row
   * (customer support: "which call was that?").
   *
   * Same wire shape as chat(), but returns `{ result, eventId }`. The
   * underlying log POST is identical.
   */
  async chatWithEventId<TClient, TResult = unknown>(
    client: TClient,
    options: ChatOptions,
  ): Promise<{ result: TResult; eventId: string }> {
    // Reuse chat() by stashing the eventId on `this`. Cheap; avoids
    // duplicating the entire 60-line happy/error path. A cleaner refactor is
    // tracked in the audit doc.
    const seen = this.lastEventIdHolder;
    const result = await this.chat<TClient, TResult>(client, options);
    return { result, eventId: seen.value };
  }

  private readonly lastEventIdHolder: { value: string } = { value: '' };

  private tryLog(
    provider: 'openai' | 'anthropic' | 'gemini' | 'unknown',
    options: ChatOptions,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      cacheCreationTokens: number;
    },
    latencyMs: number,
    eventId: string,
  ): void {
    try {
      const { costUsd } = calculateCost(
        options.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cachedInputTokens,
        usage.cacheCreationTokens,
      );

      const planName = options.plan ?? null;
      const planRevenueUsd =
        planName != null && Object.prototype.hasOwnProperty.call(this.plans, planName)
          ? this.plans[planName]!
          : null;
      const marginUsd = planRevenueUsd != null ? planRevenueUsd - costUsd : null;

      const payload: LogPayload = {
        userId: options.userId ?? null,
        feature: options.feature ?? null,
        model: options.model,
        provider,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        costUsd,
        latencyMs,
        planName,
        planRevenueUsd,
        marginUsd, // sent for backward-compat; server ignores
        timestamp: new Date().toISOString(),
        eventId,
      };

      this.lastEventIdHolder.value = eventId;
      this.logger.log(payload);
    } catch (err) {
      this.onError?.(err);
    }
  }

  /**
   * Await all in-flight log POSTs. Call this before `process.exit()` /
   * `Lambda return` / end of a short-lived CLI run, otherwise the daemon
   * process is torn down before the POST hits the network.
   */
  flush(timeoutMs?: number): Promise<void> {
    return this.logger.flush(timeoutMs);
  }
}

function defaultDowngradeWarn(
  this: Weckr,
  info: { userId: string; from: string; to: string },
): void {
  const key = `${info.userId}:${info.from}>${info.to}`;
  // Private access via `this` is fine here — we bind it in the constructor.
  const seen = (this as unknown as { downgradeSeen: Set<string> }).downgradeSeen;
  if (seen.has(key)) return;
  seen.add(key);
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      `Weckr: downgrading ${info.userId} from ${info.from} to ${info.to} (cap reached). Subsequent downgrades for this user/model will be silent.`,
    );
  }
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Client-side UUID v4 — used as the eventId in every /log POST so the server
 * can dedupe retries via (project_id, event_id). Prefers `crypto.randomUUID()`
 * (Node 19+, modern browsers), falls back to a Math.random()-based v4 for
 * older runtimes. Collision probability is irrelevant at our scale.
 */
function generateEventId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    try {
      return g.crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  // RFC 4122-ish fallback. Not cryptographically random, but uniqueness for
  // dedupe is sufficient.
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}
