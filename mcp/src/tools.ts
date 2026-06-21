import { z } from 'zod';
import { zodToJsonSchema } from './zod-to-jsonschema.js';

/**
 * Tool definitions for the Weckr MCP server. Each tool has:
 *   - name        : the canonical tool identifier
 *   - description : shown to Claude/MCP client; written so the model picks the right one
 *   - schema      : Zod schema for runtime validation; converted to JSON Schema for clients
 */

const GetOverviewInput = z.object({}).strict();
const NoInput = z.object({}).strict();

const GetUsersInput = z
  .object({
    filter: z
      .enum(['all', 'unprofitable', 'profitable', 'watch'])
      .optional()
      .describe(
        'Filter users by profitability status. Default: all. ' +
          '"unprofitable" = users costing more than they pay; ' +
          '"watch" = >=70% of their revenue is going to AI cost; ' +
          '"profitable" = healthy.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max number of users to return. Default 20. Must be 1..100.'),
  })
  .strict();

// `get_spending_cap_url` (renamed from set_spending_cap) — does NOT mutate; just
// walks the user to the dashboard page where caps are edited. All inputs are
// optional so Claude doesn't have to invent placeholder values when the user
// just asks "where do I set caps?".
const GetSpendingCapUrlInput = z
  .object({
    plan: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Optional plan name to pre-fill, e.g. "free", "starter", "pro".'),
    limitUsd: z
      .number()
      .nonnegative()
      .optional()
      .describe('Optional monthly USD spend ceiling per user to suggest.'),
    action: z
      .enum(['block', 'downgrade'])
      .optional()
      .describe('Optional cap action. block = throw WeckrCapError; downgrade = swap to a cheaper same-provider model.'),
  })
  .strict();

export const TOOLS = [
  {
    name: 'get_overview',
    description:
      'Get a high-level overview of AI costs, revenue, and margin for the current calendar month. ' +
      'Returns total spend, total revenue, net margin, request count, count of unprofitable users, ' +
      'combined loss in USD, and the most expensive feature. Best first call for any ' +
      '"how am I doing" question.',
    schema: GetOverviewInput,
  },
  {
    name: 'get_users',
    description:
      'Get per-user cost/revenue/margin breakdown. Sorted by margin (worst first). Use this for ' +
      '"which users are losing me money?" and "which users cost the most?" questions. ' +
      'Anonymous calls (rows with null userId) appear grouped under "(anonymous)".',
    schema: GetUsersInput,
  },
  {
    name: 'get_feature_breakdown',
    description:
      'Get per-feature cost breakdown. Shows which features (the `feature` label your code passes ' +
      'to wk.chat()) are the most expensive across all users. Use this for ' +
      '"which feature is costing me the most?" or "where should I optimize?".',
    schema: NoInput,
  },
  {
    name: 'get_model_recommendations',
    description:
      'Get recommendations for swapping to cheaper models. We surface features that are using ' +
      'expensive models for short outputs (<150 avg output tokens) where a same-provider ' +
      'cheaper model exists and the projected monthly saving is >=$1. ' +
      'Use this for "where can I cut AI cost without breaking anything?".',
    schema: NoInput,
  },
  {
    name: 'get_pricing_recommendations',
    description:
      'Get per-plan pricing recommendations based on actual AI costs this month. Tells you which ' +
      'plans are unprofitable and what to charge to keep margins healthy. Needs at least 5 users ' +
      'and 30 requests this month to produce a recommendation — otherwise returns a note.',
    schema: NoInput,
  },
  {
    name: 'get_spending_cap_url',
    description:
      'Returns the dashboard URL where the user can edit a monthly AI spending cap for a plan. ' +
      'This tool does NOT change any settings — it only produces a link. Caps are stored on the ' +
      'project and edited from a browser session, so the founder always reviews them visually. ' +
      'All args are optional; if provided they\'re echoed in the response so the user can confirm.',
    schema: GetSpendingCapUrlInput,
  },
] as const;

export type ToolName = (typeof TOOLS)[number]['name'];

/** Tools serialized for MCP's ListTools response (JSON Schema for inputSchema). */
export function toolsForListing() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema),
  }));
}
