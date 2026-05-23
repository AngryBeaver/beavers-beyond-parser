import { AiLookup } from './AiLookup.js';

export interface CostRow {
  label: string;
  claude: string;
  local: string;
}

// Cost per monster: semantic (15 calls) + patch (3 calls), worst-case.
const COST_PER_MONSTER: Record<string, number> = {
  sonnet: 0.030,
  haiku: 0.008,
  opus: 0.100,
};

function resolveModelKey(): string {
  const modelRaw = ((game as any).settings?.get('beavers-ai-assistant', 'claudeModel') as string) ?? '';
  const model = modelRaw.toLowerCase();
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('opus')) return 'opus';
  return 'sonnet'; // default / fallback
}

function formatCost(usd: number): string {
  if (usd < 0.005) return '<$0.01';
  return `~$${usd.toFixed(2)}`;
}

export function estimateCost(monsterCount: number): CostRow[] {
  if (!AiLookup.isAvailable() || !AiLookup.isEnabled()) return [];

  const isLocal =
    ((game as any).settings?.get('beavers-ai-assistant', 'aiProvider') as string) === 'local-ai';

  const costPerMonster = isLocal ? 0 : COST_PER_MONSTER[resolveModelKey()];
  const total = costPerMonster * monsterCount;

  const label =
    monsterCount === 1
      ? '~1 monster'
      : monsterCount <= 25
        ? `Small adventure (~${monsterCount} monsters)`
        : `Full campaign (~${monsterCount} monsters)`;

  return [{ label, claude: isLocal ? '$0.00' : formatCost(total), local: '$0.00' }];
}
