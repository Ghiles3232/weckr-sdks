#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { WeckrClient } from './client.js';
import { TOOLS, toolsForListing } from './tools.js';
import type {
  FeatureBreakdownRow,
  ModelRecommendation,
  OverviewStats,
  PricingRecommendation,
  PricingRecommendationsResponse,
  UserMargin,
} from './types.js';

// --------------------------------------------------------------------------
// Env / args
// --------------------------------------------------------------------------

const apiKey = process.env.WECKR_API_KEY;
const baseUrl = process.env.WECKR_BASE_URL; // optional override for self-host
const envProjectId = process.env.WECKR_PROJECT_ID; // optional pre-known id

// We deliberately do NOT process.exit when apiKey is missing — Claude Desktop
// shows the resulting "server disconnected" with no diagnostic. Instead, boot
// the server, advertise the tools, and return a clear error message on every
// tool call. The user sees the actual error in the conversation.
let client: WeckrClient | null = null;
let bootError: string | null = null;
if (!apiKey) {
  bootError =
    'WECKR_API_KEY is not set. Add it to the "env" block of your MCP server config — ' +
    'see https://github.com/Ghiles3232/weckr/tree/main/weckr-mcp#configuration. ' +
    'Get a wk_ key at https://app.useweckr.com/dashboard/projects/new.';
  // Also write to stderr so the user can find it in logs if Claude doesn't
  // render the in-conversation error.
  console.error(`[weckr-mcp] ${bootError}`);
} else {
  try {
    client = new WeckrClient({
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(envProjectId ? { projectId: envProjectId } : {}),
    });
  } catch (err) {
    bootError = err instanceof Error ? err.message : String(err);
    console.error(`[weckr-mcp] ${bootError}`);
  }
}

// --------------------------------------------------------------------------
// Server
// --------------------------------------------------------------------------

const server = new Server(
  { name: 'weckr', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolsForListing(),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!client) {
    return errorResult(bootError ?? 'Weckr MCP server is not configured.');
  }
  const name = request.params.name as string;
  const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return errorResult(`Unknown tool: ${name}`);

    // Validate input against the tool's Zod schema. Bad args -> friendly error.
    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return errorResult(
        `Invalid arguments for ${name}: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
          .join('; ')}`,
      );
    }
    const args = parsed.data as Record<string, unknown>;

    switch (name) {
      case 'get_overview': {
        const data = await client.getOverview();
        return textResult(formatOverview(data));
      }
      case 'get_users': {
        const users = await client.getUsers();
        const filter = (args.filter as string | undefined) ?? 'all';
        const limit = (args.limit as number | undefined) ?? 20;
        const filtered =
          filter === 'all'
            ? users
            : users.filter((u) => u.status === (filter as UserMargin['status']));
        return textResult(formatUsers(filtered, limit));
      }
      case 'get_feature_breakdown': {
        const data = await client.getOverview();
        return textResult(formatFeatureBreakdown(data.featureBreakdown ?? []));
      }
      case 'get_model_recommendations': {
        const recs = await client.getModelRecommendations();
        return textResult(formatModelRecs(recs));
      }
      case 'get_pricing_recommendations': {
        const res = await client.getPricingRecommendations();
        return textResult(formatPricingRecs(res));
      }
      case 'get_spending_cap_url': {
        const plan = args.plan as string | undefined;
        const limitUsd = args.limitUsd as number | undefined;
        const action = args.action as string | undefined;
        const lines = [
          'Spending caps are edited from the dashboard:',
          '',
          '  https://app.useweckr.com/dashboard/settings',
          '',
          'This tool only returns the link — it did NOT change any settings.',
        ];
        if (plan || limitUsd != null || action) {
          lines.push('');
          lines.push('Values to use on that page:');
          if (plan) lines.push(`  plan:     ${plan}`);
          if (limitUsd != null) lines.push(`  limitUsd: $${limitUsd}`);
          if (action) lines.push(`  action:   ${action}`);
        }
        return textResult(lines.join('\n'));
      }
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(message);
  }
});

// --------------------------------------------------------------------------
// Formatters — kept tight; the MCP client renders the text.
// --------------------------------------------------------------------------

function formatOverview(d: OverviewStats): string {
  const profitable = (d.totalMarginUsd ?? 0) >= 0;
  const cost = fmtUsd(d.totalCostUsd, 4);
  const rev = fmtUsd(d.totalRevenueUsd, 2);
  const margin = fmtUsd(d.totalMarginUsd, 2);
  const loss = Math.abs(d.combinedLossUsd ?? 0);
  const lines = [
    `## Weckr overview — this month`,
    ``,
    `Total AI cost     ${cost}`,
    `Total revenue     ${rev}`,
    `Net margin        ${margin}  ${profitable ? '(profitable)' : '(losing money)'}`,
    `Requests          ${d.requestCount ?? 0}`,
    `Unprofitable users ${d.unprofitableUsers ?? 0}`,
  ];
  if ((d.unprofitableUsers ?? 0) > 0 && loss > 0) {
    lines.push(`Combined loss     ${fmtUsd(loss, 4)}  (sum of margins for unprofitable users)`);
  }
  lines.push(`Top-cost feature  ${d.topCostFeature ?? '(none yet)'}`);
  return lines.join('\n');
}

function formatUsers(users: UserMargin[], limit: number): string {
  if (users.length === 0) return 'No users match that filter.';
  const head = `## Users (${users.length} match${users.length === 1 ? '' : 'es'}, showing up to ${limit})`;
  const rows = users.slice(0, limit).map((u) => {
    const id = u.userId ?? '(anonymous)';
    const dot =
      u.status === 'unprofitable' ? '✗' : u.status === 'watch' ? '!' : '·';
    return [
      `${dot} ${id}`,
      `    cost ${fmtUsd(u.totalCostUsd, 6)}`,
      `    revenue ${fmtUsd(u.planRevenueUsd, 2)}`,
      `    margin ${fmtUsd(u.marginUsd, 6)}`,
      `    requests ${u.requestCount}`,
      `    status ${u.status}`,
    ].join('  ·  ');
  });
  return [head, '', ...rows].join('\n');
}

function formatFeatureBreakdown(rows: FeatureBreakdownRow[]): string {
  if (rows.length === 0) return 'No feature data yet.';
  const head = `## Feature cost breakdown — this project`;
  const lines = rows.map((f) => {
    const name = f.feature ?? '(unlabeled)';
    return [
      `  ${name}`,
      `    total ${fmtUsd(f.totalCostUsd, 4)}`,
      `    avg/req ${fmtUsd(f.avgCostUsd, 6)}`,
      `    ${f.requestCount} requests`,
      `    ${fmtPct(f.pctOfTotal)} of total cost`,
    ].join('  ·  ');
  });
  return [head, '', ...lines].join('\n');
}

function formatModelRecs(recs: ModelRecommendation[]): string {
  if (recs.length === 0) {
    return 'No cheaper-model swap recommendations right now. Either every feature is already on a cost-optimal model, or there isn\'t enough volume (need 10+ requests per feature this month) for a confident suggestion.';
  }
  const head = `## Cheaper-model recommendations (${recs.length})`;
  const lines = recs.map((r) => {
    return [
      `  ${r.feature}: ${r.currentModel} → ${r.recommendedModel}`,
      `    saves ${fmtUsd(r.estimatedSaving, 2)}/mo (${fmtUsd(r.currentMonthlyCost, 2)} → ${fmtUsd(r.projectedMonthlyCost, 2)})`,
      `    ${r.monthlyRequests} requests/mo, avg output ${r.avgOutputTokens} tokens`,
      `    confidence: ${r.confidence}`,
    ].join('\n');
  });
  return [head, '', ...lines].join('\n\n');
}

function formatPricingRecs(res: PricingRecommendationsResponse): string {
  if (res.insufficientData) {
    return [
      'Not enough data for pricing recommendations yet.',
      `  Need at least 5 distinct users and 30 requests this month.`,
      `  Current: ${res.totalUsers ?? 0} users, ${res.totalRequests ?? 0} requests.`,
    ].join('\n');
  }
  if (res.recommendations.length === 0) {
    return 'Current pricing is healthy across all plans — no changes recommended.';
  }
  const head = `## Pricing recommendations (${res.recommendations.length} plans)`;
  const lines = res.recommendations.map((p: PricingRecommendation) => {
    return [
      `  ${p.plan} plan (current: ${fmtUsd(p.currentPrice, 2)}/mo)`,
      `    ${p.userCount} users, avg cost ${fmtUsd(p.avgCostPerUser, 4)}/user`,
      `    ${p.unprofitableUsers} unprofitable (${fmtPct(p.unprofitablePct)})`,
      `    total monthly loss on this plan: ${fmtUsd(p.totalLossUsd, 2)}`,
      `    recommended price: ${fmtUsd(p.recommendedPrice, 2)}/mo`,
      `    potential monthly gain: ${fmtUsd(p.potentialMonthlyGain, 2)}`,
      `    action: ${p.recommendedAction}`,
    ].join('\n');
  });
  return [head, '', ...lines].join('\n\n');
}

// --------------------------------------------------------------------------
// Small formatting helpers
// --------------------------------------------------------------------------

/**
 * Format a USD value for human reading. The `decimals` argument is the
 * default; for sub-$1 values we automatically bump precision to 6 so a
 * single-call cost like $0.000003 doesn't render as $0.0000 (which reads as
 * "we didn't track anything" — the most demoralising first-event UX).
 */
function fmtUsd(n: number | null | undefined, decimals: number): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const effective = abs > 0 && abs < 1 ? Math.max(decimals, 6) : decimals;
  return `${sign}$${abs.toFixed(effective)}`;
}

function fmtPct(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `${v.toFixed(1)}%`;
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(text: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${text}` }],
    isError: true,
  };
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

async function main() {
  // Best-effort: pre-resolve the projectId from the api key so the first tool
  // call is fast. If this fails we'll surface the error on the actual tool
  // call, which is friendlier than crashing at startup.
  if (client) {
    try {
      await client.resolveProjectId();
    } catch (err) {
      console.error(
        `[weckr-mcp] warning: could not resolve projectId at startup: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[weckr-mcp] running on stdio (project=${client?.getProjectId() ?? (apiKey ? 'unresolved' : 'NO_API_KEY')})`,
  );
}

main().catch((err) => {
  console.error('[weckr-mcp] fatal:', err);
  process.exit(1);
});
