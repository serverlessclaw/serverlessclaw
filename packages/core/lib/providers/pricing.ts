export interface ModelPricing {
  input: number; // Cost per 1 token
  output: number; // Cost per 1 token
}

export const PRICING_REGISTRY: Record<string, Record<string, ModelPricing>> = {
  openai: {
    'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
    'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
    o3: { input: 10 / 1_000_000, output: 40 / 1_000_000 },
    'o3-mini': { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 },
  },
  anthropic: {
    'claude-sonnet-4-20250514': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
    'claude-opus-4-20250514': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
    'claude-haiku-3-5-20241022': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
  },
  google: {
    'gemini-2.5-pro': { input: 1.25 / 1_000_000, output: 10 / 1_000_000 },
    'gemini-2.5-flash': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  },
};

const DEFAULT_INPUT_RATE = 3 / 1_000_000;
const DEFAULT_OUTPUT_RATE = 15 / 1_000_000;

/**
 * Estimates USD cost for token usage based on provider/model pricing.
 * Uses conservative default rates when exact pricing is unavailable.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  provider?: string,
  model?: string
): number {
  const modelPricing = PRICING_REGISTRY[provider ?? '']?.[model ?? ''];

  if (modelPricing) {
    return inputTokens * modelPricing.input + outputTokens * modelPricing.output;
  }

  return inputTokens * DEFAULT_INPUT_RATE + outputTokens * DEFAULT_OUTPUT_RATE;
}

/**
 * Estimates USD cost for token usage when only total tokens are known.
 * Assumes a 50/50 split between input and output tokens for the calculation.
 */
export function estimateCostForTotal(
  totalTokens: number,
  provider?: string,
  model?: string
): number {
  return estimateCost(totalTokens / 2, totalTokens / 2, provider, model);
}
