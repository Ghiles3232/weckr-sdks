/**
 * Shared types — match the wire shape returned by the Weckr backend.
 * KEEP IN SYNC with weckr-api/lib/types.ts.
 */

export interface WeckrConfig {
  apiKey: string;
  /** Override for testing / self-hosting. Defaults to https://app.useweckr.com. */
  baseUrl?: string;
  /** Optional pre-known project id. If omitted, we resolve it from /api/v1/me. */
  projectId?: string;
}

export interface MeResponse {
  project: {
    id: string;
    name: string;
    api_key: string;
    created_at: string;
  };
}

export interface OverviewStats {
  totalCostUsd: number;
  totalRevenueUsd: number;
  totalMarginUsd: number;
  requestCount: number;
  unprofitableUsers: number;
  combinedLossUsd: number;
  topCostFeature: string | null;
  last30Days: Array<{ date: string; cost: number; revenue: number }>;
  featureBreakdown: FeatureBreakdownRow[];
}

export interface FeatureBreakdownRow {
  feature: string | null;
  totalCostUsd: number;
  requestCount: number;
  avgCostUsd: number;
  pctOfTotal: number;
}

export interface UserMargin {
  userId: string | null;
  totalCostUsd: number;
  planRevenueUsd: number;
  marginUsd: number;
  requestCount: number;
  status: 'profitable' | 'unprofitable' | 'watch';
}

export interface UsersResponse {
  users: UserMargin[];
}

export interface ModelRecommendation {
  feature: string;
  currentModel: string;
  recommendedModel: string;
  avgOutputTokens: number;
  avgInputTokens: number;
  monthlyRequests: number;
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  estimatedSaving: number;
  complexity: 'simple';
  confidence: 'high' | 'medium';
}

export interface ModelRecommendationsResponse {
  recommendations: ModelRecommendation[];
  message?: string;
}

export interface PricingRecommendation {
  plan: string;
  currentPrice: number;
  avgCostPerUser: number;
  userCount: number;
  unprofitableUsers: number;
  unprofitablePct: number;
  totalLossUsd: number;
  recommendedPrice: number;
  potentialMonthlyGain: number;
  recommendedAction: string;
}

export interface PricingRecommendationsResponse {
  insufficientData: boolean;
  message?: string;
  totalRequests?: number;
  totalUsers?: number;
  recommendations: PricingRecommendation[];
}
