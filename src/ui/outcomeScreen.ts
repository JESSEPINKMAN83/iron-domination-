import { debriefInsights } from '../match/debriefInsights';
import { currentCommander } from '../identity/commander';
import type { MapId, MapSize } from '../content/maps';
import { MAP_PRESETS, MAP_SIZE_PRESETS } from '../content/maps';
import type { Difficulty, Personality } from '../content/phase6';
import type { CombatMode } from '../content/rules';
import type { ArmyDebriefStats, MatchSnapshot } from '../match/battleDebrief';
import { FACTION, factionId } from '../render/palette';

export interface OutcomeSettings {
  campaign?: 'first-light';
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
    <div><strong>ARMY</strong><small>SIDE ${army.side}${army.isLocal ? ' · COMMANDER' : army.side === localSide ? ' · ALLIED FORCE' : ' · OPPOSITION'}</small></div>
    <b>${army.eliminated ? 'ELIMINATED' : 'OPERATIONAL'}</b>`;
  header.querySelector('strong')!.textContent = army.label;
  const stats = document.createElement('div');
  stats.className = 'battle-debrief__army-stats';
  stats.append(
    metric('DAMAGE', formatNumber(army.damageDealt), `${formatNumber(army.damageReceived)} received`),
    metric('DESTROYED', `${army.unitKills + army.buildingKills}`, `${army.unitKills} units · ${army.buildingKills} structures`),
    metric('FORCE LEFT', `${army.unitsSurviving}`, `${army.unitLosses} lost · ${survival(army)}% survival`),
    metric('BASE LEFT', `${army.buildingsSurviving}`, `${army.buildingLosses} lost`),
    metric('ECONOMY', `$${formatNumber(army.income)}`, `$${formatNumber(army.spent)} invested`),
    metric('CREDITS LEFT', `$${formatNumber(army.credits)}`, 'available at match end'),
  );
  const bar = document.createElement('div');
  bar.className = 'battle-debrief__damage-bar';
  bar.innerHTML = `<i style="width:${maxDamage > 0 ? (army.damageDealt / maxDamage) * 100 : 0}%"></i>`;
  const details = document.createElement('details');
  details.className = 'battle-debrief__details';
  const summary = document.createElement('summary');
  summary.textContent = 'Detailed army statistics';
  details.append(summary, stats);
  const output = document.createElement('div');
  output.className = 'battle-debrief__army-output';
  output.innerHTML = `<span>Damage dealt <b>${formatNumber(army.damageDealt)}</b></span><span>Units destroyed / lost <b>${army.unitKills} / ${army.unitLosses}</b></span><span>Harvested <b>$${formatNumber(army.income)}</b></span>`;
  root.append(header, output, bar, details);
  return root;
}

/** Names the player on their own debrief once they have an identity worth naming. */
function commanderLine(win: boolean): string {
  const base = win ? 'OPERATION COMPLETE · BATTLE DEBRIEF' : 'OPERATION FAILED · COMMAND REVIEW';
  const commander = currentCommander();
  return commander ? `${base} · COMMANDER ${commander.name.toUpperCase()}` : base;
}

export function showOutcomeScreen(options: OutcomeScreenOptions): void {
  document.getElementById('battle-debrief')?.remove();
  const win = options.outcome === 'victory';
  const local = options.snapshot.armies.find((army) => army.isLocal) ?? options.snapshot.armies[0];
  const enemies = options.snapshot.armies.filter((army) => army.side !== local.side);
  const maxDamage = Math.max(1, ...options.snapshot.armies.map((army) => army.damageDealt));


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
      <small>${options.settings.campaign ? 'OPERATION FIRST LIGHT' : 'BATTLE DEBRIEF'}</small>
      <h1>${options.settings.campaign ? win ? 'MISSION COMPLETE' : 'MISSION FAILED' : win ? 'VICTORY' : 'DEFEAT'}</h1>
      <p>${options.settings.campaign ? win ? 'Both missile launchers are destroyed. Command HQ is secure. The base is safe.' : 'Command HQ has fallen. Rebuild your missile shield and try Operation First Light again.' : win ? 'Every hostile command yard has fallen. The battlefield is under your control.' : 'Your command network has collapsed. Review the battle data and return stronger.'}</p>
    </div>
    <div class="battle-debrief__operation">
      <span>AFTER ACTION REPORT</span>
      <strong>${MAP_PRESETS[options.settings.mapId].shortLabel}</strong>
      <small>${MAP_SIZE_PRESETS[options.settings.mapSize].label} · SEED ${options.settings.seed}</small>
    </div>`;

  header.querySelector('.battle-debrief__result-copy > small')!.textContent = commanderLine(win);

  const highlights = document.createElement('div');
  highlights.className = 'battle-debrief__highlights';
  highlights.append(
    metric('TIME IN BATTLE', formatDuration(options.snapshot.elapsedSeconds), 'simulated match time'),
    metric('UNITS DESTROYED', `${local.unitKills}`, `${local.buildingKills} structures also destroyed`),
    metric('YOUR UNIT LOSSES', `${local.unitLosses}`, `${local.unitsSurviving} remained from ${local.unitsDeployed} deployed`),
    metric('ORE HARVESTED', `$${formatNumber(local.income)}`, options.snapshot.elapsedSeconds >= 60 ? `$${formatNumber(local.income / (options.snapshot.elapsedSeconds / 60))} per minute` : 'total collected during this match'),
  );

  const body = document.createElement('div');
  body.className = 'battle-debrief__body';
  const comparison = document.createElement('div');
  comparison.className = 'battle-debrief__comparison';
  const comparisonTitle = document.createElement('div');
  comparisonTitle.className = 'battle-debrief__section-title';
  comparisonTitle.innerHTML = '<span>01</span><div><strong>ARMY PERFORMANCE</strong><small>DAMAGE BARS SHARE THE SAME SCALE · EXPAND FOR DETAILS</small></div>';
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
  assessmentTitle.innerHTML = '<span>02</span><div><strong>BATTLEFIELD FINDINGS</strong><small>THE STORY BEHIND THE NUMBERS</small></div>';
  const assessments = document.createElement('div');
  assessments.className = 'battle-debrief__assessments';
  for (const item of debriefInsights(local, enemies, options.snapshot.elapsedSeconds)) {
    const card = document.createElement('div');
    card.className = `battle-debrief__assessment is-${item.tone}`;
    card.innerHTML = `<i></i><div><strong></strong><p></p></div>`;
    card.querySelector('strong')!.textContent = item.title;
    card.querySelector('p')!.textContent = item.text;
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
  hint.innerHTML = '<strong>AFTER ACTION REPORT</strong><span>Totals include starting forces. Damage includes units and structures; splash can hit multiple targets.</span>';
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
