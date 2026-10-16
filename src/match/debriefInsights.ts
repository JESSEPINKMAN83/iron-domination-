import type { ArmyDebriefStats } from './battleDebrief';

export interface DebriefInsight { title: string; text: string; tone: string }
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Only conclusions supported by recorded totals; never infer timing or shot accuracy. */
export function debriefInsights(local: ArmyDebriefStats, enemies: ArmyDebriefStats[], seconds: number): DebriefInsight[] {
  const items: DebriefInsight[] = [];
  if (local.unitKills || local.unitLosses) {
    items.push({ title: local.unitKills >= local.unitLosses ? 'Favorable unit trades' : 'A costly frontline',
      text: `You destroyed ${fmt(local.unitKills)} enemy units and lost ${fmt(local.unitLosses)}. ${local.unitKills >= local.unitLosses ? 'More enemy units fell than your own.' : 'Try focused attacks and fallback orders to preserve your force.'} Unit counts do not account for unit cost.`,
      tone: local.unitKills >= local.unitLosses ? 'positive' : 'warning' });
  }
  if (local.damageDealt || local.damageReceived) {
    const ratio = local.damageReceived > 0 ? `${(local.damageDealt / local.damageReceived).toFixed(2)}×` : 'No damage received';
    items.push({ title: 'Your damage exchange', text: `${ratio} · ${fmt(local.damageDealt)} dealt / ${fmt(local.damageReceived)} received. This compares your own outgoing and incoming damage, across units and buildings.`, tone: local.damageDealt >= local.damageReceived ? 'positive' : 'warning' });
  }
  const rival = [...enemies].sort((a, b) => b.damageDealt - a.damageDealt)[0];
  if (rival?.damageDealt) items.push({ title: 'The heaviest enemy firepower', text: `${rival.label} dealt ${fmt(rival.damageDealt)} damage across the battlefield${enemies.length > 1 ? ` — ${Math.round(rival.damageDealt / enemies.reduce((sum, a) => sum + a.damageDealt, 0) * 100)}% of hostile damage output` : ''}. This includes damage to other armies, not just yours.`, tone: 'neutral' });
  if (local.income > 0 && seconds >= 60) items.push({ title: 'Your economy, in perspective', text: `$${fmt(local.income / (seconds / 60))} harvested per minute on average. You finished with $${fmt(local.credits)} available${local.credits > 3000 ? ' — a reserve you could turn into reinforcements' : ''}.`, tone: 'neutral' });
  if (local.buildingKills > 0) items.push({ title: 'Dismantling the enemy base', text: `${fmt(local.buildingKills)} enemy structures destroyed by your force. ${local.buildingsSurviving} of your ${local.buildingsConstructed} constructed or starting structures remained. Walls count as structures.`, tone: 'positive' });
  if (!items.length) items.push({ title: 'A quiet battlefield', text: 'No combat or harvesting was recorded. Play a longer engagement to reveal meaningful comparisons.', tone: 'neutral' });
  return items;
}
