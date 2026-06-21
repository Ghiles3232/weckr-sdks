import type {
  MeResponse,
  ModelRecommendation,
  ModelRecommendationsResponse,
  OverviewStats,
  PricingRecommendationsResponse,
  UserMargin,
  UsersResponse,
  WeckrConfig,
} from './types.js';

const DEFAULT_BASE_URL = 'https://app.useweckr.com';

/**
 * Thin wrapper around the Weckr HTTP API for server-to-server use from an MCP
 * server (or any other tool that has a wk_ key but no user JWT).
 *
 * All endpoints used here accept the `x-api-key` header. The api key
 * authoritatively identifies the project — the server uses it to resolve
 * `projectId` once at startup, then scopes every subsequent call to that
 * project. The dashboard endpoints (`/api/v1/stats`, `/users`,
 * `/recommendations/*`) verify the URL project id matches the api key's
 * project and return 404 on mismatch, so the api key cannot be used to read
 * another project's data.
 */
export class WeckrClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private projectId: string | null;

  constructor(config: WeckrConfig) {
    if (!config?.apiKey) {
      throw new Error('WeckrClient: apiKey is required.');
    }
    this.apiKey = config.apiKey;
    const rawBase = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    validateBaseUrl(rawBase);
    this.baseUrl = rawBase;
    if (rawBase !== DEFAULT_BASE_URL) {
      // Sending the wk_ key to a non-default host is sometimes legitimate
      // (self-hosted Weckr, dev loop) and sometimes a copy-paste attack via a
      // shared MCP config. We can't tell — but a loud stderr warning gives the
      // user a chance to notice before requests fire.
      // eslint-disable-next-line no-console
      console.error(
        `[weckr-mcp] WARNING: WECKR_BASE_URL is set to ${rawBase}. Your wk_ key will be sent to this host on every request. Only proceed if you trust it.`,
      );
    }
    this.projectId = config.projectId ?? null;
  }

  /** Resolve and cache the projectId from the api key. Safe to call repeatedly. */
  async resolveProjectId(): Promise<string> {
    if (this.projectId) return this.projectId;
    const data = await this.fetchJson<MeResponse>('/api/v1/me');
    if (!data?.project?.id) {
      throw new Error('Weckr /api/v1/me did not return project.id');
    }
    this.projectId = data.project.id;
    return this.projectId;
  }

  getProjectId(): string | null {
    return this.projectId;
  }

  async getOverview(): Promise<OverviewStats> {
    const pid = await this.requireProjectId();
    return this.fetchJson<OverviewStats>(`/api/v1/stats/${pid}`);
  }

  async getUsers(): Promise<UserMargin[]> {
    const pid = await this.requireProjectId();
    const data = await this.fetchJson<UsersResponse>(`/api/v1/users/${pid}`);
    return data.users ?? [];
  }

  async getModelRecommendations(): Promise<ModelRecommendation[]> {
    const pid = await this.requireProjectId();
    const data = await this.fetchJson<ModelRecommendationsResponse>(
      `/api/v1/recommendations/models/${pid}`,
    );
    return data.recommendations ?? [];
  }

  async getPricingRecommendations(): Promise<PricingRecommendationsResponse> {
    const pid = await this.requireProjectId();
    return this.fetchJson<PricingRecommendationsResponse>(
      `/api/v1/recommendations/pricing/${pid}`,
    );
  }

  private async requireProjectId(): Promise<string> {
    if (this.projectId) return this.projectId;
    return this.resolveProjectId();
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'content-type': 'application/json',
        },
      });
    } catch (err) {
      throw new Error(
        `Weckr API network error calling ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const hint =
        res.status === 401
          ? ' (check WECKR_API_KEY — get a wk_ key at https://app.useweckr.com/dashboard/projects/new)'
          : res.status === 404
          ? ' (the project this api_key owns may not match what you asked for)'
          : res.status === 429
          ? ' (rate-limited by Weckr)'
          : '';
      throw new Error(`Weckr API ${res.status} on ${path}${hint}: ${body || res.statusText}`);
    }

    return (await res.json()) as T;
  }
}

/**
 * Reject obviously-dangerous base URLs (file://, javascript:, http://random-attacker.com)
 * before they can exfiltrate the api key. Allow https everywhere, and http only for
 * loopback hosts (localhost / 127.0.0.1 / ::1) for local development.
 */
function validateBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`WECKR_BASE_URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return;
    throw new Error(
      `WECKR_BASE_URL must use https:// (got http://${host}). ` +
        `Only loopback hosts (localhost / 127.0.0.1 / ::1) may use plain http.`,
    );
  }
  throw new Error(
    `WECKR_BASE_URL must use https:// (got ${parsed.protocol}). file://, javascript:, etc. are rejected.`,
  );
}
