/**
 * Weckr Task Cost Benchmark runner.
 *
 * Runs every task in tasks.json against every configured provider, records real
 * token usage and latency from the provider response, prices it with Weckr's own
 * pricing table (lib/caps.ts, the same table the /log route uses to recompute
 * cost server side), and writes a timestamped JSON result file.
 *
 * Run it:
 *   node scripts/benchmark/run.ts
 *   node scripts/benchmark/run.ts --env-file ../../testkey.env
 *   node scripts/benchmark/run.ts --only openai,kimi --task support-reply
 *   node scripts/benchmark/run.ts --dry-run          (no API calls, prints the plan)
 *
 * Node 24 strips TypeScript types natively, so there is no build step and no new
 * dependency. Every provider is called over plain fetch so the exact HTTP request
 * is auditable by anyone reproducing the run.
 *
 * Keys are read from the environment. Standard names first, local aliases second:
 *   OpenAI     OPENAI_API_KEY      | OPENAI_TEST_API_KEY
 *   Anthropic  ANTHROPIC_API_KEY   | CLAUDE_TEST_API_KEY  | CLAUDE_API_KEY
 *   Gemini     GEMINI_API_KEY      | GEMINI_TEST_API_KEY  | GOOGLE_API_KEY
 *   Kimi       MOONSHOT_API_KEY    | KIMI_TEST_API_KEY    | KIMI_API_KEY
 *
 * A provider with no usable key is skipped and reported. It is never estimated,
 * never interpolated, and never written to the results file as if it had run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePricing, type ModelPricing } from '../../lib/caps.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ config */

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'kimi';

type ProviderConfig = {
  id: ProviderId;
  label: string;
  /** Exact model identifier sent to the API. Verified against each provider's
   *  live model list on 2026-07-23 before this suite was first run. */
  model: string;
  envVars: string[];
  /** Why this model is the fair comparison tier for this provider. */
  tierNote: string;
};

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    model: 'gpt-5.4-mini',
    envVars: ['OPENAI_API_KEY', 'OPENAI_TEST_API_KEY'],
    tierNote: 'The small, fast tier of the current GPT-5 line, the one built for high volume production work.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    model: 'claude-haiku-4-5',
    envVars: ['ANTHROPIC_API_KEY', 'CLAUDE_TEST_API_KEY', 'CLAUDE_API_KEY'],
    tierNote: 'Haiku is the small, fast tier of the Claude line, the direct peer of mini and flash.',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    model: 'gemini-3.6-flash',
    envVars: ['GEMINI_API_KEY', 'GEMINI_TEST_API_KEY', 'GOOGLE_API_KEY'],
    tierNote: 'Flash is the small, fast tier of the Gemini line. Flash Lite sits a tier below and maps to nano.',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    model: 'kimi-k2.6',
    envVars: ['MOONSHOT_API_KEY', 'KIMI_TEST_API_KEY', 'KIMI_API_KEY'],
    tierNote: 'K2.6 is the general purpose Moonshot model, one tier below K3.',
  },
];

type Task = {
  id: string;
  name: string;
  summary: string;
  category: string;
  maxOutputTokens: number;
  system: string;
  turns: string[];
};

type Suite = {
  suite: string;
  version: string;
  updated: string;
  about: string;
  fixtures: Record<string, string>;
  tasks: Task[];
};

/* -------------------------------------------------------------- primitives */

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  /** Reasoning or thinking tokens, where the provider reports them separately.
   *  These are already inside outputTokens and are billed at the output rate.
   *  Broken out so the report can show where invisible cost comes from. */
  reasoningTokens: number;
};

type TurnResult = Usage & {
  turn: number;
  latencyMs: number;
  text: string;
  /** Provider reported stop reason, kept verbatim. */
  finishReason: string;
  /** True when the model stopped because it hit the output cap rather than
   *  because it finished. A truncated turn understates the real task cost, so
   *  the results file flags it instead of quietly reporting a low number. */
  truncated: boolean;
};

type TaskResult = {
  taskId: string;
  provider: ProviderId;
  model: string;
  ok: boolean;
  error?: string;
  turnCount: number;
  latencyMs: number;
  costUsd: number | null;
  /** True if any turn hit the output cap. Cost for this task is a floor, not
   *  the real figure, and the published table marks it. */
  truncated: boolean;
  turns: TurnResult[];
} & Usage;

const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  reasoningTokens: 0,
});

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Price a task with Weckr's own pricing table. This mirrors recalcCost in
 * lib/validate.ts exactly, which is what the /log route uses to recompute cost
 * server side. Returns null when the model has no pricing entry, so an unpriced
 * model shows as unknown rather than as a misleading zero.
 */
function priceUsd(model: string, u: Usage): number | null {
  const pricing: ModelPricing | null = resolvePricing(model);
  if (!pricing) return null;
  const cached = Math.max(0, Math.min(u.cachedInputTokens, u.inputTokens));
  const uncached = u.inputTokens - cached;
  const cachedRate = pricing.cachedInput ?? pricing.input;
  const writeRate = pricing.cacheWrite ?? pricing.input;
  return round6(
    (uncached / 1_000_000) * pricing.input +
      (cached / 1_000_000) * cachedRate +
      (Math.max(0, u.cacheCreationTokens) / 1_000_000) * writeRate +
      (u.outputTokens / 1_000_000) * pricing.output,
  );
}

/* ------------------------------------------------------------------- utils */

/** Load KEY=value pairs from a dotenv style file into process.env without
 *  overwriting anything already set in the real environment. */
function loadEnvFile(file: string): number {
  if (!fs.existsSync(file)) {
    console.warn(`warning: env file not found at ${file}, continuing with the process environment`);
    return 0;
  }
  let loaded = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const i = trimmed.indexOf('=');
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
      loaded++;
    }
  }
  return loaded;
}

/**
 * Find a usable key for a provider. A value that is absent, blank, obviously a
 * placeholder, or too short to be a real credential counts as not configured.
 * Better to skip and say so than to burn a run on 401s.
 */
function findKey(envVars: string[]): { key: string; via: string } | { reason: string } {
  for (const name of envVars) {
    const raw = process.env[name];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (!value) return { reason: `${name} is set but empty` };
    if (/\s/.test(value) || value.length < 20) {
      return { reason: `${name} is set to a placeholder value, not a usable API key` };
    }
    return { key: value, via: name };
  }
  return { reason: `no key found, set one of: ${envVars.join(', ')}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type HttpAttempt = { status: number; body: string };

/** POST JSON with a small retry on transient failures. Returns the last response
 *  either way so the caller can decide what to do with a 4xx. */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  attempts = 3,
): Promise<HttpAttempt> {
  let last: HttpAttempt = { status: 0, body: 'no attempt made' };
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      last = { status: res.status, body: text };
      // Retry only on rate limit and server errors. A 400 is our bug and will
      // not fix itself, so return it immediately for the degrade path.
      if (res.status === 429 || res.status >= 500) {
        if (i < attempts - 1) {
          await sleep(2000 * (i + 1));
          continue;
        }
      }
      return last;
    } catch (err) {
      last = { status: 0, body: err instanceof Error ? err.message : String(err) };
      if (i < attempts - 1) await sleep(2000 * (i + 1));
    }
  }
  return last;
}

/* --------------------------------------------------------------- providers */

type Message = { role: 'user' | 'assistant'; content: string };

type CallResult = TurnResult;

/**
 * Each provider adapter takes the accumulated conversation and returns one
 * turn's text plus its usage as reported by the provider. Usage is always taken
 * from the API response, never estimated locally.
 */
type Adapter = (args: {
  key: string;
  model: string;
  system: string;
  messages: Message[];
  maxOutputTokens: number;
}) => Promise<CallResult>;

function fail(status: number, body: string): never {
  const snippet = body.length > 400 ? `${body.slice(0, 400)}...` : body;
  throw new Error(`HTTP ${status}: ${snippet}`);
}

const openAiCompatible =
  (baseUrl: string): Adapter =>
  async ({ key, model, system, messages, maxOutputTokens }) => {
    const payload: Record<string, unknown> = {
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      // GPT-5 era models use max_completion_tokens. Moonshot accepts it too.
      max_completion_tokens: maxOutputTokens,
    };
    // No reasoning parameter is set anywhere in this suite. See RUN_SETTINGS.

    const started = performance.now();
    let res = await postJson(`${baseUrl}/chat/completions`, { authorization: `Bearer ${key}` }, payload);
    // Degrade path: fall back to max_tokens for models on the older parameter.
    if (res.status === 400 && 'max_completion_tokens' in payload) {
      delete payload.max_completion_tokens;
      payload.max_tokens = maxOutputTokens;
      res = await postJson(`${baseUrl}/chat/completions`, { authorization: `Bearer ${key}` }, payload);
    }
    const latencyMs = Math.round(performance.now() - started);
    if (res.status !== 200) fail(res.status, res.body);

    const json = JSON.parse(res.body);
    const u = json.usage ?? {};
    const finishReason = json.choices?.[0]?.finish_reason ?? 'unknown';
    return {
      turn: 0,
      latencyMs,
      finishReason,
      truncated: finishReason === 'length',
      text: json.choices?.[0]?.message?.content ?? '',
      inputTokens: u.prompt_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? 0,
      cacheCreationTokens: 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  };

const anthropicAdapter: Adapter = async ({ key, model, system, messages, maxOutputTokens }) => {
  const started = performance.now();
  const res = await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    { model, system, messages, max_tokens: maxOutputTokens },
  );
  const latencyMs = Math.round(performance.now() - started);
  if (res.status !== 200) fail(res.status, res.body);

  const json = JSON.parse(res.body);
  const u = json.usage ?? {};
  const text = (json.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('');
  return {
    turn: 0,
    latencyMs,
    finishReason: json.stop_reason ?? 'unknown',
    truncated: json.stop_reason === 'max_tokens',
    text,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cachedInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    reasoningTokens: 0,
  };
};

const geminiAdapter: Adapter = async ({ key, model, system, messages, maxOutputTokens }) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    // No thinkingConfig is set. Gemini runs at its default. See RUN_SETTINGS.
    generationConfig: { maxOutputTokens },
  };

  const started = performance.now();
  const res = await postJson(url, { 'x-goog-api-key': key }, payload);
  const latencyMs = Math.round(performance.now() - started);
  if (res.status !== 200) fail(res.status, res.body);

  const json = JSON.parse(res.body);
  const u = json.usageMetadata ?? {};
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('');
  const thoughts = u.thoughtsTokenCount ?? 0;
  const finishReason = json.candidates?.[0]?.finishReason ?? 'unknown';
  // candidatesTokenCount excludes thinking tokens, but thinking is billed as
  // output, so the billable output is the sum of the two.
  return {
    turn: 0,
    latencyMs,
    finishReason,
    truncated: finishReason === 'MAX_TOKENS',
    text,
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: (u.candidatesTokenCount ?? 0) + thoughts,
    cachedInputTokens: u.cachedContentTokenCount ?? 0,
    cacheCreationTokens: 0,
    reasoningTokens: thoughts,
  };
};

/**
 * Every provider runs at its own default settings. No reasoning effort, no
 * thinking budget, no temperature, no sampling parameter is set anywhere in this
 * suite. Two reasons. First, it is what a feature actually costs if you simply
 * call the API, which is the question this benchmark exists to answer. Second,
 * the providers do not offer matching rungs, so any attempt to equalise thinking
 * would mean choosing which rungs count as equivalent, and that choice would
 * quietly decide the winner. Reasoning and thinking tokens are reported inside
 * output tokens and billed at the output rate, so they are counted in full.
 */
const RUN_SETTINGS =
  'Provider defaults. No reasoning effort, thinking budget, temperature, or sampling parameter is set. Only the per task max output token cap from tasks.json is sent.';

const ADAPTERS: Record<ProviderId, Adapter> = {
  openai: openAiCompatible('https://api.openai.com/v1'),
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  // Kimi speaks the OpenAI protocol, so it goes through the OpenAI client path
  // pointed at Moonshot, exactly like the Weckr Kimi integration does.
  kimi: openAiCompatible('https://api.moonshot.ai/v1'),
};

/* --------------------------------------------------------------- execution */

/**
 * Run one task against one provider. Multi turn tasks resend the whole
 * conversation each turn, which is the point: cost compounds with turn count
 * even though the per token rate never changes.
 */
async function runTask(
  provider: ProviderConfig,
  key: string,
  task: Task,
  document: string,
): Promise<TaskResult> {
  const adapter = ADAPTERS[provider.id];
  const messages: Message[] = [];
  const turns: TurnResult[] = [];
  let total = emptyUsage();
  let latencyMs = 0;

  for (let i = 0; i < task.turns.length; i++) {
    const content = task.turns[i]!.replace('{{document}}', document);
    messages.push({ role: 'user', content });
    try {
      const r = await adapter({
        key,
        model: provider.model,
        system: task.system,
        messages,
        maxOutputTokens: task.maxOutputTokens,
      });
      const turn: TurnResult = { ...r, turn: i + 1 };
      turns.push(turn);
      total = addUsage(total, r);
      latencyMs += r.latencyMs;
      // A model that spends its entire output budget on reasoning returns no
      // text at all. Continuing would push an empty assistant message into the
      // next request, which some providers reject with a confusing 400. Stop
      // here and say plainly what happened.
      if (!r.text.trim()) {
        return {
          taskId: task.id,
          provider: provider.id,
          model: provider.model,
          ok: false,
          error:
            `empty response on turn ${i + 1} (finishReason ${r.finishReason}, ` +
            `${r.reasoningTokens} reasoning tokens of ${r.outputTokens} output). ` +
            `The model used its whole output budget without producing an answer.`,
          turnCount: task.turns.length,
          latencyMs,
          costUsd: priceUsd(provider.model, total),
          truncated: turns.some((t) => t.truncated),
          turns,
          ...total,
        };
      }
      messages.push({ role: 'assistant', content: r.text });
    } catch (err) {
      return {
        taskId: task.id,
        provider: provider.id,
        model: provider.model,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        turnCount: task.turns.length,
        latencyMs,
        costUsd: null,
        truncated: turns.some((t) => t.truncated),
        turns,
        ...total,
      };
    }
  }

  return {
    taskId: task.id,
    provider: provider.id,
    model: provider.model,
    ok: true,
    turnCount: task.turns.length,
    latencyMs,
    costUsd: priceUsd(provider.model, total),
    truncated: turns.some((t) => t.truncated),
    turns,
    ...total,
  };
}

/* -------------------------------------------------------------------- main */

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const inline = argv[i]?.includes('=') ? argv[i]!.split('=')[1] : undefined;
    return inline ?? argv[i + 1];
  };
  const withEq = (flag: string) => argv.find((a) => a.startsWith(`${flag}=`))?.split('=').slice(1).join('=');
  return {
    envFile: withEq('--env-file') ?? get('--env-file'),
    only: (withEq('--only') ?? get('--only'))?.split(',').map((s) => s.trim()),
    task: withEq('--task') ?? get('--task'),
    dryRun: argv.includes('--dry-run'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.envFile) {
    const resolved = path.resolve(process.cwd(), args.envFile);
    const n = loadEnvFile(resolved);
    console.log(`loaded ${n} variable(s) from ${resolved}\n`);
  }

  const suite: Suite = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks.json'), 'utf8'));
  const document = fs.readFileSync(path.join(HERE, suite.fixtures.document!), 'utf8');

  const tasks = args.task ? suite.tasks.filter((t) => t.id === args.task) : suite.tasks;
  if (!tasks.length) {
    console.error(`no task matched "${args.task}"`);
    process.exit(1);
  }

  const selected = args.only
    ? PROVIDERS.filter((p) => args.only!.includes(p.id))
    : PROVIDERS;

  // Resolve keys up front so the run reports exactly who is in and who is out
  // before a single dollar is spent.
  const ready: { provider: ProviderConfig; key: string; via: string }[] = [];
  const skipped: { provider: ProviderId; label: string; model: string; reason: string }[] = [];

  console.log(`Weckr Task Cost Benchmark, suite v${suite.version}`);
  console.log(`${tasks.length} task(s) across ${selected.length} provider(s)\n`);
  console.log('provider readiness');
  for (const p of selected) {
    const found = findKey(p.envVars);
    if ('key' in found) {
      ready.push({ provider: p, key: found.key, via: found.via });
      const pricing = resolvePricing(p.model);
      const rate = pricing ? `$${pricing.input}/$${pricing.output} per 1M` : 'NO PRICING ENTRY';
      console.log(`  ok      ${p.label.padEnd(10)} ${p.model.padEnd(18)} ${rate}  (key from ${found.via})`);
    } else {
      skipped.push({ provider: p.id, label: p.label, model: p.model, reason: found.reason });
      console.log(`  SKIP    ${p.label.padEnd(10)} ${p.model.padEnd(18)} ${found.reason}`);
    }
  }
  console.log();

  if (!ready.length) {
    console.error('no provider has a usable key, nothing to run');
    process.exit(1);
  }
  if (args.dryRun) {
    console.log('dry run, no API calls made');
    return;
  }

  // Providers run concurrently, tasks run in order within a provider so we do
  // not trip per account rate limits.
  const started = Date.now();
  const perProvider = await Promise.all(
    ready.map(async ({ provider, key }) => {
      const out: TaskResult[] = [];
      for (const task of tasks) {
        const r = await runTask(provider, key, task, document);
        const cost = r.costUsd === null ? 'unpriced' : `$${r.costUsd.toFixed(6)}`;
        const status = r.ok ? 'ok  ' : 'FAIL';
        console.log(
          `  ${status} ${provider.label.padEnd(10)} ${task.id.padEnd(24)} ` +
            `in ${String(r.inputTokens).padStart(6)}  out ${String(r.outputTokens).padStart(5)}  ` +
            `${cost.padStart(11)}  ${String(r.latencyMs).padStart(6)}ms` +
            (r.truncated ? '  TRUNCATED' : '') +
            (r.ok ? '' : `  ${r.error}`),
        );
        out.push(r);
      }
      return out;
    }),
  );

  const results = perProvider.flat();
  const runAt = new Date().toISOString();
  const payload = {
    suite: suite.suite,
    suiteVersion: suite.version,
    runAt,
    runDate: runAt.slice(0, 10),
    durationSec: Math.round((Date.now() - started) / 1000),
    pricingSource: 'weckr-api/lib/caps.ts PRICING, the same table the /log route uses to recompute cost server side',
    runSettings: RUN_SETTINGS,
    providers: [
      ...ready.map(({ provider }) => {
        const pricing = resolvePricing(provider.model);
        return {
          id: provider.id,
          label: provider.label,
          model: provider.model,
          status: 'ran' as const,
          tierNote: provider.tierNote,
          inputPerMillionUsd: pricing?.input ?? null,
          outputPerMillionUsd: pricing?.output ?? null,
        };
      }),
      ...skipped.map((s) => ({
        id: s.provider,
        label: s.label,
        model: s.model,
        status: 'skipped' as const,
        reason: s.reason,
      })),
    ],
    tasks: suite.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      summary: t.summary,
      category: t.category,
      turns: t.turns.length,
    })),
    results,
  };

  const outDir = path.join(HERE, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const dated = path.join(outDir, `${payload.runDate}.json`);
  const latest = path.join(outDir, 'latest.json');
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(dated, json);
  fs.writeFileSync(latest, json);

  /* summary */
  console.log('\ncost per task, in dollars');
  const cols = ready.map((r) => r.provider);
  console.log(`  ${'task'.padEnd(26)}${cols.map((c) => c.label.padStart(12)).join('')}`);
  for (const t of tasks) {
    const cells = cols.map((c) => {
      const r = results.find((x) => x.taskId === t.id && x.provider === c.id);
      if (!r || !r.ok || r.costUsd === null) return 'n/a'.padStart(12);
      return r.costUsd.toFixed(6).padStart(12);
    });
    console.log(`  ${t.id.padEnd(26)}${cells.join('')}`);
  }
  const totals = cols.map((c) => {
    const rs = results.filter((x) => x.provider === c.id && x.ok && x.costUsd !== null);
    return rs.reduce((s, x) => s + (x.costUsd ?? 0), 0);
  });
  console.log(`  ${'TOTAL'.padEnd(26)}${totals.map((t) => t.toFixed(6).padStart(12)).join('')}`);

  const failures = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failures.length}/${results.length} calls ok, ${failures.length} failed`);
  if (skipped.length) {
    console.log(`skipped provider(s): ${skipped.map((s) => `${s.label} (${s.reason})`).join('; ')}`);
  }
  console.log(`\nwrote ${dated}`);
  console.log(`wrote ${latest}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
