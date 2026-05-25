import { AiLookup } from './AiLookup.js';

export interface TotalRow {
  header: string;
  claudeModel: string;
  claudeTotal: string;
  claudeRate: string;
}

export interface CostEstimate {
  perUnitHeader: string;
  inputTokens: string;
  outputTokens: string;
  costPerUnit: string;
  totals: TotalRow[];
}

// Approximate token usage per monster (all features, worst-case AI path)
const CALLS_PER_MONSTER = 15;
const INPUT_TOKENS  = 5_000;
const OUTPUT_TOKENS = 700;

const MODEL_META: Record<string, { name: string; inputRate: number; outputRate: number; rateLabel: string }> = {
  sonnet: { name: 'Claude Sonnet', inputRate: 3,   outputRate: 15, rateLabel: '$3 + $15 per 1M tokens' },
  haiku:  { name: 'Claude Haiku',  inputRate: 0.8, outputRate: 4,  rateLabel: '$0.80 + $4 per 1M tokens' },
  opus:   { name: 'Claude Opus',   inputRate: 15,  outputRate: 75, rateLabel: '$15 + $75 per 1M tokens' },
};

function resolveModelKey(): string {
  const raw = ((game as any).settings?.get('beavers-ai-assistant', 'claudeModel') as string ?? '').toLowerCase();
  if (raw.includes('haiku')) return 'haiku';
  if (raw.includes('opus'))  return 'opus';
  return 'sonnet';
}

function formatCost(usd: number): string {
  if (usd < 0.005) return '<$0.01';
  return `~$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `~${(n / 1000).toFixed(0)} 000` : `~${n}`;
}

export function estimateCost(...counts: number[]): CostEstimate | null {
  if (!AiLookup.isAvailable() || !AiLookup.isEnabled()) return null;

  const meta        = MODEL_META[resolveModelKey()];
  const costPerUnit = (INPUT_TOKENS * meta.inputRate + OUTPUT_TOKENS * meta.outputRate) / 1_000_000;

  const totals: TotalRow[] = counts.map((count) => ({
    header:      `Total (× ${count} monster${count === 1 ? '' : 's'})`,
    claudeModel: meta.name,
    claudeTotal: formatCost(costPerUnit * count),
    claudeRate:  meta.rateLabel,
  }));

  return {
    perUnitHeader: `Per monster (~${CALLS_PER_MONSTER} AI calls)`,
    inputTokens:   `${formatTokens(INPUT_TOKENS)} tokens`,
    outputTokens:  `${formatTokens(OUTPUT_TOKENS)} tokens`,
    costPerUnit:   formatCost(costPerUnit),
    totals,
  };
}