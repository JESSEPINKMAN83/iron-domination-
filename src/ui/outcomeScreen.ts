import type { MapId, MapSize } from '../content/maps';
import { MAP_PRESETS, MAP_SIZE_PRESETS } from '../content/maps';
import type { Difficulty, Personality } from '../content/phase6';
import type { CombatMode } from '../content/rules';
import type { ArmyDebriefStats, MatchSnapshot } from '../match/battleDebrief';
import { FACTION, factionId } from '../render/palette';

export interface OutcomeSettings {
  mapId: MapId;
  mapSize: MapSize;
  seed: number;
  ai: Difficulty;
  aiStyle: Personality;
  combatMode: CombatMode;
}

interface OutcomeScreenOptions {
  outcome: 'victory' | 'defeat';
  settings: OutcomeSettings;
  snapshot: MatchSnapshot;
  onPlayAgain: () => void;
  onSetup: () => void;
  onRematch?: () => void;
}

const number = new Intl.NumberFormat('en-US');

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function formatNumber(value: number): string {
  return number.format(Math.round(value));
}

function accuracy(army: ArmyDebriefStats): number {
  return army.shotsFired > 0 ? Math.min(100, Math.round((army.hits / army.shotsFired) * 100)) : 0;
}

function survival(army: ArmyDebriefStats): number {
  return army.unitsDeployed > 0 ? Math.round((army.unitsSurviving / army.unitsDeployed) * 100) : 0;
}

function hexColor(team: number): string {
  return `#${FACTION[factionId(team)].accent.toString(16).padStart(6, '0')}`;
}

function metric(label: string, value: string, detail?: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'battle-debrief__metric';
  root.innerHTML = `<span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ''}`;
  return root;
}

function teamCard(army: ArmyDebriefStats, maxDamage: number, localSide: number): HTMLDivElement {
  const accent = hexColor(army.team);
  const root = document.createElement('div');
  root.className = `battle-debrief__army${army.isLocal ? ' is-local' : ''}${army.eliminated ? ' is-eliminated' : ''}`;
  root.style.setProperty('--army-accent', accent);
  const header = document.createElement('div');
  header.className = 'battle-debrief__army-header';
  header.innerHTML = `
    <span class="battle-debrief__army-index">${army.team}</span>
    <div><strong>${army.label}</strong><small>SIDE ${army.side}${army.isLocal ? ' · COMMANDER' : army.side === localSide ? ' · ALLIED FORCE' : ' · OPPOSITION'}</small></div>
    <b>${army.eliminated ? 'ELIMINATED' : 'OPERATIONAL'}</b>`;
  const stats = document.createElement('div');
  stats.className = 'battle-debrief__army-stats';
  stats.append(
    metric('DAMAGE', formatNumber(army.damageDealt), `${formatNumber(army.damageReceived)} received`),
    metric('DESTROYED', `${army.unitKills + army.buildingKills}`, `${army.unitKills} units · ${army.buildingKills} structures`),
    metric('FORCE LEFT', `${army.unitsSurviving}`, `${army.unitLosses} lost · ${survival(army)}% survival`),
    metric('BASE LEFT', `${army.buildingsSurviving}`, `${army.buildingLosses} lost`),
    metric('ECONOMY', `$${formatNumber(army.income)}`, `$${formatNumber(army.spent)} invested`),
    metric('ACCURACY', `${accuracy(army)}%`, `${army.hits} hits · ${army.shotsFired} shots`),
  );
  const bar = document.createElement('div');
  bar.className = 'battle-debrief__damage-bar';
  bar.innerHTML = `<i style="width:${maxDamage > 0 ? Math.max(3, (army.damageDealt / maxDamage) * 100) : 3}%"></i>`;
  root.append(header, stats, bar);
  return root;
}

function assessmentFor(local: ArmyDebriefStats, enemies: ArmyDebriefStats[]): Array<{ title: string; text: string; tone: string }> {
  const enemyDamage = enemies.reduce((total, army) => total + army.damageDealt, 0);
  const enemyKills = enemies.reduce((total, army) => total + army.unitKills + army.buildingKills, 0);
  const result: Array<{ title: string; text: string; tone: string }> = [];
  const localSurvival = survival(local);
  if (localSurvival >= 65) result.push({ title: 'Force preservation', text: `${localSurvival}% of deployed units survived. Your army traded efficiently and retained momentum.`, tone: 'positive' });
  else result.push({ title: 'Reinforce the front', text: `${local.unitLosses} units were lost. Use formations, repairs and fallback orders to preserve expensive units.`, tone: 'warning' });
  if (local.damageDealt >= enemyDamage) result.push({ title: 'Fire superiority', text: `Your force dealt ${formatNumber(local.damageDealt - enemyDamage)} more damage than all hostile armies combined.`, tone: 'positive' });
  else result.push({ title: 'Damage deficit', text: `Hostile armies dealt ${formatNumber(enemyDamage - local.damageDealt)} more damage. Focus fire and use unit counters.`, tone: 'warning' });
  if (local.collectorsSurviving >= 2 || local.income >= local.spent * 0.65) result.push({ title: 'Economy sustained', text: `$${formatNumber(local.income)} harvested with ${local.collectorsSurviving} collectors remaining. Production stayed funded.`, tone: 'neutral' });
  else result.push({ title: 'Economy exposed', text: `Only ${local.collectorsSurviving} collectors remained. Protect ore routes before committing to the next assault.`, tone: 'warning' });
  if (enemyKills === 0 && local.unitKills + local.buildingKills > 0) result[0] = { title: 'Flawless engagement', text: 'No confirmed friendly losses were credited to hostile fire.', tone: 'positive' };
  return result.slice(0, 3);
}

export function showOutcomeScreen(options: OutcomeScreenOptions): void {
  document.getElementById('battle-debrief')?.remove();
  const win = options.outcome === 'victory';
  const local = options.snapshot.armies.find((army) => army.isLocal) ?? options.snapshot.armies[0];
  const enemies = options.snapshot.armies.filter((army) => army.side !== local.side);
  const maxDamage = Math.max(1, ...options.snapshot.armies.map((army) => army.damageDealt));
  const totalEnemyKills = local.unitKills + local.buildingKills;
  const totalEnemyLosses = enemies.reduce((total, army) => total + army.unitLosses + army.buildingLosses, 0);
  const totalAssaults = enemies.reduce((total, army) => total + army.attacksLaunched, 0);

  const overlay = document.createElement('div');
  overlay.id = 'battle-debrief';
  overlay.className = `battle-debrief ${win ? 'is-victory' : 'is-defeat'}`;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', win ? 'Victory battle debrief' : 'Defeat battle debrief');

  const shell = document.createElement('section');
  shell.className = 'battle-debrief__shell';
  const header = document.createElement('header');
  header.className = 'battle-debrief__header';
  header.innerHTML = `
    <div class="battle-debrief__result-mark"><span>${win ? '✓' : '×'}</span></div>
    <div class="battle-debrief__result-copy">
      <small>${win ? 'OPERATION COMPLETE · TOTAL DOMINANCE' : 'OPERATION FAILED · COMMAND REVIEW'}</small>
      <h1>${win ? 'DECISIVE VICTORY' : 'FORCES DEFEATED'}</h1>
      <p>${win ? 'Every hostile command yard has fallen. The battlefield is under your control.' : 'Your command network has collapsed. Review the battle data and return stronger.'}</p>
    </div>
    <div class="battle-debrief__operation">
      <span>AFTER ACTION REPORT</span>
      <strong>${MAP_PRESETS[options.settings.mapId].shortLabel}</strong>
      <small>${MAP_SIZE_PRESETS[options.settings.mapSize].label} · SEED ${options.settings.seed}</small>
    </div>`;

  const highlights = document.createElement('div');
  highlights.className = 'battle-debrief__highlights';
  highlights.append(
    metric('BATTLE TIME', formatDuration(options.snapshot.elapsedSeconds), 'engagement duration'),
    metric('HOSTILE LOSSES', `${totalEnemyKills}`, `${totalEnemyLosses} confirmed losses`),
    metric('COMBAT OUTPUT', formatNumber(local.damageDealt), `${accuracy(local)}% weapon accuracy`),
    metric('FORCE SURVIVAL', `${survival(local)}%`, `${local.unitsSurviving} of ${local.unitsDeployed} units`),
    metric('ORE HARVESTED', `$${formatNumber(local.income)}`, `${local.collectorsSurviving} collectors remain`),
    metric('ENEMY PRESSURE', `${totalAssaults}`, `${enemies.reduce((t, a) => t + a.rebuilds, 0)} rebuilds · ${enemies.reduce((t, a) => t + a.retreats, 0)} retreats`),
  );

  const body = document.createElement('div');
  body.className = 'battle-debrief__body';
  const comparison = document.createElement('div');
  comparison.className = 'battle-debrief__comparison';
  const comparisonTitle = document.createElement('div');
  comparisonTitle.className = 'battle-debrief__section-title';
  comparisonTitle.innerHTML = '<span>01</span><div><strong>ARMY PERFORMANCE</strong><small>FINAL FORCE, COMBAT AND ECONOMY COMPARISON</small></div>';
  const teams = document.createElement('div');
  teams.className = 'battle-debrief__armies';
  for (const army of [...options.snapshot.armies].sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.team - b.team)) {
    teams.append(teamCard(army, maxDamage, local.side));
  }
  comparison.append(comparisonTitle, teams);

  const intelligence = document.createElement('aside');
  intelligence.className = 'battle-debrief__intelligence';
  const assessmentTitle = document.createElement('div');
  assessmentTitle.className = 'battle-debrief__section-title';
  assessmentTitle.innerHTML = '<span>02</span><div><strong>COMMANDER ASSESSMENT</strong><small>WHAT TO CARRY INTO THE NEXT BATTLE</small></div>';
  const assessments = document.createElement('div');
  assessments.className = 'battle-debrief__assessments';
  for (const item of assessmentFor(local, enemies)) {
    const card = document.createElement('div');
    card.className = `battle-debrief__assessment is-${item.tone}`;
    card.innerHTML = `<i></i><div><strong>${item.title}</strong><p>${item.text}</p></div>`;
    assessments.append(card);
  }
  const doctrine = document.createElement('div');
  doctrine.className = 'battle-debrief__doctrine';
  doctrine.innerHTML = `<span>ENGAGEMENT DOCTRINE</span><strong>${options.settings.combatMode.toUpperCase()} COMBAT</strong><small>${options.settings.ai.toUpperCase()} · ${options.settings.aiStyle.toUpperCase()} OPPOSITION</small>`;
  intelligence.append(assessmentTitle, assessments, doctrine);
  body.append(comparison, intelligence);

  const footer = document.createElement('footer');
  footer.className = 'battle-debrief__footer';
  const hint = document.createElement('p');
  hint.innerHTML = '<strong>BATTLE DATA SAVED</strong><span>Use this report to refine your army composition and economy timing.</span>';
  const actions = document.createElement('div');
  actions.className = 'battle-debrief__actions';
  const setup = outcomeButton('RETURN TO SETUP', options.onSetup, false);
  const again = outcomeButton(options.onRematch ? 'REQUEST REMATCH' : 'PLAY AGAIN', () => {
    if (options.onRematch) {
      options.onRematch();
      again.disabled = true;
      again.textContent = 'WAITING FOR COMMANDER';
    } else options.onPlayAgain();
  }, true);
  actions.append(setup, again);
  footer.append(hint, actions);
  shell.append(header, highlights, body, footer);
  overlay.append(shell);
  document.body.append(overlay);
}

function outcomeButton(label: string, action: () => void, primary: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = `battle-debrief__button${primary ? ' is-primary' : ''}`;
  button.onpointerdown = (event) => event.stopPropagation();
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  return button;
}
