import { setCommandPortrait } from '../render/buildingPortraits';
import { Vector3, type Camera } from 'three';
import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity } from '../sim/components';
import {
  MAX_EMBER_DRONE_QUANTITY_LEVEL,
  MAX_EMBER_DRONE_WARHEAD_LEVEL,
  MAX_STRATEGIC_ACCURACY_LEVEL,
  MAX_STRATEGIC_MISSILE_LEVEL,
  canUpgradeEmberDroneQuantity,
  canUpgradeEmberDroneWarhead,
  canUpgradeStrategicAccuracy,
  canUpgradeStrategicMissile,
  type EconomyState,
} from '../sim/economy';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import {
  EMBER_DRONE_COOLDOWN,
  STRATEGIC_MISSILE_COOLDOWN,
  emberLaunchReadiness,
  emberDroneLaunchCost,
  emberDroneSalvoSize,
  emberScatterRadius,
  emberWarhead,
  strategicAccuracy,
  strategicLaunchReadiness,
  strategicMissileLaunchCost,
  strategicWarhead,
} from '../sim/strategicWarfare';
import { areTeamsHostile, selectedEntities, type GameSim } from '../sim/world';
import {
  hasUnitUpgrade,
  unitKindForUpgrade,
  upgradeOptionsForKind,
  type UnitUpgradeId,
  type UpgradePurchaseResult,
} from '../sim/upgrades';
import { unitDisplayName } from './unitDisplayName';
import { FACTION, factionId } from '../render/palette';

interface SelectionGroup {
  key: string;
  kind: string;
  label: string;
  type: string;
  entities: Entity[];
  healthPct?: number;
  unitKind?: UnitKind;
}

export class SelectionBar {
  private readonly root: HTMLDivElement;
  private readonly worldOverlay: HTMLDivElement;
  private readonly worldButtons = new Map<number, HTMLButtonElement>();
  private readonly projectedAnchor = new Vector3();
  private worldPopover?: HTMLDivElement;
  private worldPopoverEntityId?: number;
  private lastKey = '';
  private visible = true;
  private strategicEnemyTeam?: number;

  constructor(
    private readonly sim: GameSim,
    private readonly actions: {
      selectEntities: (entities: Entity[]) => void;
      credits: () => number;
      purchaseUpgrade: (ids: number[], upgradeId: UnitUpgradeId) => UpgradePurchaseResult;
      openTacticPlanner?: (entities: Entity[]) => void;
      strategic?: {
        economy: EconomyState;
        upgradeAccuracy: () => boolean;
        upgradeWarhead: () => boolean;
        upgradeEmberQuantity: () => boolean;
        upgradeEmberWarhead: () => boolean;
        beginTargeting: (weapon: 'missile' | 'ember', enemyTeam: number, color: number) => { ok: boolean; reason: string };
        cancelTargeting: () => void;
        activeTargeting: () => 'missile' | 'ember' | undefined;
      };
    },
    private readonly localTeam = 1,
    private readonly camera?: Camera,
    private readonly hf?: Heightfield,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'game-selection-bar';
    this.root.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:13;display:none;' +
      'width:min(720px,calc(100vw - 36px));pointer-events:auto;color:#e0e7dd;font:12px/1.35 ui-monospace,Menlo,monospace;' +
      'background:linear-gradient(180deg,rgba(24,31,31,.94),rgba(8,12,12,.9));border:2px solid #1b1f20;border-top-color:#596260;border-left-color:#596260;' +
      'border-radius:3px;padding:9px 10px;box-shadow:inset 0 0 0 1px rgba(210,177,95,.25),0 12px 30px rgba(0,0,0,.38);';
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
    this.worldOverlay = document.createElement('div');
    this.worldOverlay.className = 'game-world-upgrades';
    this.worldOverlay.style.cssText = 'position:fixed;inset:0;z-index:14;pointer-events:none;overflow:hidden;';
    document.body.appendChild(this.root);
    document.body.appendChild(this.worldOverlay);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.worldOverlay.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this.root.style.display = 'none';
      this.closeWorldPopover();
    }
    else this.lastKey = '';
  }

  update(): void {
    if (!this.visible) return;
    const selected = selectedEntities(this.sim, this.localTeam).filter((entity) => !entity.destroyed);
    if (selected.length === 0) {
      this.lastKey = '';
      this.root.style.display = 'none';
      this.syncWorldUpgradeButtons([]);
      return;
    }
    this.syncWorldUpgradeButtons(selected);
    const groups = selectionGroups(selected);
    const siloSelected = selected.length === 1 && selected[0].building?.kind === 'strategic-silo' && this.actions.strategic;
    const key = groups
      .map((group) => `${group.key}:${group.entities.map((entity) => `${entity.id}.${entity.unitUpgrades?.ids.join('+') ?? ''}`).join(',')}:${group.healthPct ?? ''}`)
      .join('|') + (siloSelected ? `|strategic:${this.strategicStateKey()}` : '');
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (siloSelected) this.renderStrategicSilo(groups[0], selected[0]);
    else this.render(groups, selected.length);
  }

  updateWorldAnchors(): void {
    if (!this.visible || !this.camera || !this.hf) return;
    const selectedIds = new Set(selectedEntities(this.sim, this.localTeam).filter((entity) => !entity.destroyed).map((entity) => entity.id));
    for (const [id, button] of this.worldButtons) {
      const entity = this.sim.byId.get(id);
      if (!entity || !selectedIds.has(id)) {
        button.style.display = 'none';
        continue;
      }
      const anchor = this.projectUpgradeAnchor(entity);
      button.style.display = anchor.visible ? 'grid' : 'none';
      if (!anchor.visible) {
        if (this.worldPopoverEntityId === id) this.closeWorldPopover();
        continue;
      }
      button.style.left = `${anchor.x}px`;
      button.style.top = `${anchor.y}px`;
      if (this.worldPopoverEntityId === id) this.positionWorldPopover(entity, anchor.x, anchor.y);
    }
  }

  private render(groups: SelectionGroup[], selectedCount: number): void {
    this.root.replaceChildren();
    this.root.style.left = '50%';
    this.root.style.transform = 'translateX(-50%)';
    this.root.style.width = 'min(720px,calc(100vw - 36px))';
    this.root.style.display = 'grid';
    this.root.style.gap = '8px';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
    const title = document.createElement('div');
    title.textContent = 'SELECTED FORCE';
    title.style.cssText = 'font-size:12px;color:#d2b15f;letter-spacing:.08em;';
    const count = document.createElement('div');
    count.textContent = `${selectedCount} ${selectedCount === 1 ? 'ITEM' : 'ITEMS'}`;
    count.style.cssText = 'font-size:12px;color:#f0f3e8;text-align:right;';
    header.append(title, count);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;gap:8px;overflow-x:auto;padding-bottom:1px;';
    for (const group of groups) grid.appendChild(this.groupButton(group, selectedCount));

    this.root.append(header, grid);
    const tacticalUnits = groups
      .flatMap((group) => group.entities)
      .filter((entity) => entity.mover && !entity.building && !entity.harvester);
    if (tacticalUnits.length > 0 && this.actions.openTacticPlanner) {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;';
      const tacticBtn = document.createElement('button');
      tacticBtn.type = 'button';
      tacticBtn.textContent = 'Define Tactic';
      tacticBtn.title = 'Plan a multi-point path for the selected units';
      tacticBtn.style.cssText =
        'padding:7px 12px;border:1px solid #d2b15f;border-radius:2px;cursor:pointer;' +
        'background:linear-gradient(180deg,#4f4728,#1d2018);color:#f0d56a;font:700 11px ui-monospace,Menlo,monospace;' +
        'letter-spacing:.08em;text-transform:uppercase;';
      tacticBtn.onpointerdown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      tacticBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.actions.openTacticPlanner?.(tacticalUnits);
      };
      actions.appendChild(tacticBtn);
      this.root.appendChild(actions);
    }
  }

  private renderStrategicSilo(group: SelectionGroup, silo: Entity): void {
    const controls = this.actions.strategic!;
    const economy = controls.economy;
    const enemyTeams = Array.from(new Set(
      Array.from(this.sim.buildingsQuery)
        .filter((entity) => entity.team?.id !== undefined && !entity.destroyed && areTeamsHostile(this.sim, this.localTeam, entity.team.id))
        .map((entity) => entity.team!.id),
    )).sort((a, b) => a - b);
    if (!this.strategicEnemyTeam || !enemyTeams.includes(this.strategicEnemyTeam)) this.strategicEnemyTeam = enemyTeams.length === 1 ? enemyTeams[0] : undefined;

    this.root.replaceChildren();
    this.root.style.display = 'grid';
    this.root.style.gap = '8px';
    this.root.style.left = '50%';
    this.root.style.transform = 'translateX(-50%)';
    this.root.style.width = 'min(1380px,calc(100vw - 220px))';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
    header.innerHTML = '<span style="font-size:12px;color:#d2b15f;letter-spacing:.08em">SELECTED FORCE</span><span style="font-size:10px;color:#93a29c;letter-spacing:.06em">MISSILE SILO CONTROL</span>';

    const layout = document.createElement('div');
    layout.style.cssText = 'display:grid;grid-template-columns:minmax(150px,190px) minmax(0,1fr);gap:16px;align-items:stretch;';
    const card = this.groupButton(group, 1);
    card.style.width = 'auto';
    card.style.minHeight = '118px';
    card.style.gridTemplateRows = '72px auto';
    card.title = 'Selected Missile Silo';

    const attack = document.createElement('div');
    attack.style.cssText = 'min-width:0;display:grid;gap:9px;align-content:start;';
    const attackHeader = document.createElement('div');
    attackHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:25px;';
    const attackTitle = document.createElement('div');
    attackTitle.textContent = 'ATTACK OPTIONS';
    attackTitle.style.cssText = 'font:700 12px/1.2 ui-monospace,Menlo,monospace;color:#f3f5ed;letter-spacing:.06em;';
    const targetPicker = document.createElement('div');
    targetPicker.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap;';
    if (enemyTeams.length === 0) {
      targetPicker.innerHTML = '<span style="color:#ff8d78;font-size:10px">NO ENEMY ARMIES</span>';
    } else {
      const label = document.createElement('span');
      label.textContent = 'TARGET';
      label.style.cssText = 'color:#93a29c;font-size:9px;letter-spacing:.08em;margin-right:2px;';
      targetPicker.appendChild(label);
      for (const team of enemyTeams) {
        const accent = factionAccent(team);
        const active = team === this.strategicEnemyTeam;
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = `ARMY ${team}`;
        option.setAttribute('aria-pressed', String(active));
        option.style.cssText =
          `min-height:24px;padding:4px 9px;border:1px solid ${accent};border-radius:4px;` +
          `background:${active ? accent : `${accent}24`};color:${active ? '#0b0e0d' : '#f4f6ef'};` +
          'font:800 9px ui-monospace,Menlo,monospace;letter-spacing:.05em;cursor:pointer;';
        option.onclick = () => {
          controls.cancelTargeting();
          this.strategicEnemyTeam = team;
          this.lastKey = '';
          this.update();
        };
        targetPicker.appendChild(option);
      }
    }
    attackHeader.append(attackTitle, targetPicker);

    const weaponGrid = document.createElement('div');
    weaponGrid.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;';
    const enemyTeam = this.strategicEnemyTeam;
    const accent = enemyTeam ? factionAccent(enemyTeam) : '#d2b15f';
    weaponGrid.append(
      this.strategicWeaponColumn('missile', enemyTeam, accent, silo),
      this.strategicWeaponColumn('ember', enemyTeam, '#ef995d', silo),
    );
    attack.append(attackHeader, weaponGrid);
    layout.append(card, attack);
    this.root.append(header, layout);
  }

  private strategicWeaponColumn(
    weapon: 'missile' | 'ember',
    enemyTeam: number | undefined,
    accent: string,
    _silo: Entity,
  ): HTMLDivElement {
    const controls = this.actions.strategic!;
    const economy = controls.economy;
    const missile = weapon === 'missile';
    const readiness = missile ? strategicLaunchReadiness(this.sim, economy) : emberLaunchReadiness(this.sim, economy);
    const cooldownMax = missile ? STRATEGIC_MISSILE_COOLDOWN : EMBER_DRONE_COOLDOWN;
    const readinessFill = readiness.cooldown > 0 ? Math.max(0, 1 - readiness.cooldown / cooldownMax) : readiness.ready ? 1 : 0;
    const targeting = controls.activeTargeting() === weapon;
    const canLaunch = enemyTeam !== undefined && (targeting || readiness.ready);

    const column = document.createElement('div');
    column.style.cssText = 'min-width:0;display:grid;gap:9px;';
    const launch = document.createElement('button');
    launch.type = 'button';
    launch.disabled = !canLaunch;
    launch.title = targeting
      ? 'Cancel impact-point selection'
      : enemyTeam === undefined
        ? 'Choose an enemy army first'
        : readiness.ready
          ? 'Choose an impact point on the battlefield'
          : readiness.reason;
    launch.style.cssText =
      `position:relative;isolation:isolate;min-height:58px;padding:0;overflow:hidden;border:2px solid ${targeting ? '#f5e078' : `${accent}c8`};border-radius:4px;` +
      `background:#242827;color:#fff;cursor:${canLaunch ? 'pointer' : 'default'};opacity:${enemyTeam === undefined ? '.62' : '1'};text-align:left;` +
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 5px 12px rgba(0,0,0,.22);';
    const fill = document.createElement('span');
    fill.style.cssText =
      `position:absolute;z-index:-1;left:0;top:0;bottom:0;width:${Math.round(readinessFill * 100)}%;` +
      `background:linear-gradient(90deg,${accent}52,${accent}94);transition:width .2s linear;`;
    const copy = document.createElement('span');
    copy.style.cssText = 'position:relative;display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;min-height:54px;padding:0 16px;';
    const name = document.createElement('strong');
    name.textContent = targeting ? 'CANCEL TARGETING' : missile ? 'LAUNCH MISSILE' : 'LAUNCH DRONE';
    name.style.cssText = 'font:900 18px/1 ui-monospace,Menlo,monospace;letter-spacing:.015em;white-space:nowrap;';
    const state = document.createElement('span');
    const salvoSize = emberDroneSalvoSize(economy);
    const launchCost = missile ? strategicMissileLaunchCost(economy) : emberDroneLaunchCost(economy);
    const launchPrice = missile ? `$${launchCost}` : `${salvoSize}× · $${launchCost}`;
    state.textContent = targeting ? 'MARKING' : readiness.cooldown > 0 ? `${launchPrice} · ${Math.ceil(readiness.cooldown)}S` : launchPrice;
    state.style.cssText = `font:800 13px/1 ui-monospace,Menlo,monospace;color:${readiness.ready || targeting ? '#fff3b0' : '#c7d0cc'};white-space:nowrap;`;
    copy.append(name, state);
    launch.append(fill, copy);
    launch.onclick = () => {
      if (targeting) controls.cancelTargeting();
      else if (enemyTeam !== undefined) controls.beginTargeting(weapon, enemyTeam, Number.parseInt(accent.slice(1), 16));
      this.lastKey = '';
      this.update();
    };

    const upgradeRows = document.createElement('div');
    upgradeRows.style.cssText = 'display:grid;gap:6px;';
    const upgradeRow = (
      label: string,
      level: number,
      max: number,
      upgrade: { ok: boolean; reason: string; cost: number },
      title: string,
      onUpgrade: () => boolean,
    ): HTMLDivElement => {
      const progress = document.createElement('div');
      progress.style.cssText = 'display:grid;grid-template-columns:minmax(88px,auto) minmax(70px,1fr) auto;gap:7px;align-items:center;min-height:32px;';
      const levelLabel = document.createElement('span');
      levelLabel.textContent = `${label} ${level}/${max}`;
      levelLabel.title = title;
      levelLabel.style.cssText = 'font:800 9px/1 ui-monospace,Menlo,monospace;color:#eef2eb;white-space:nowrap;';
      const track = document.createElement('div');
      track.style.cssText = 'height:13px;overflow:hidden;border:1px solid #6b706e;border-radius:4px;background:#d8d9d7;box-shadow:inset 0 1px 2px rgba(0,0,0,.45);';
      const bar = document.createElement('div');
      bar.style.cssText = `height:100%;width:${Math.max(0, Math.min(100, level / max * 100))}%;background:linear-gradient(90deg,#3f8e49,#63bf68);transition:width .2s ease;`;
      track.appendChild(bar);
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.disabled = !upgrade.ok;
      buy.textContent = upgrade.cost > 0 ? `↑ $${upgrade.cost}` : 'MAX';
      buy.title = upgrade.ok ? title : upgrade.reason;
      buy.style.cssText =
        `min-width:68px;min-height:32px;padding:5px 8px;border:1px solid ${upgrade.ok ? '#e3c663' : '#4d5552'};border-radius:4px;` +
        `background:${upgrade.ok ? 'linear-gradient(180deg,#d9bd59,#9a7930)' : '#242a28'};color:${upgrade.ok ? '#111513' : '#818b87'};` +
        `font:900 9px ui-monospace,Menlo,monospace;cursor:${upgrade.ok ? 'pointer' : 'default'};white-space:nowrap;`;
      const activateUpgrade = (): void => {
        if (buy.disabled) return;
        onUpgrade();
        this.lastKey = '';
        this.update();
      };
      // The strategic panel refreshes as its cooldown changes. Committing on
      // pointer-down prevents a refresh between press and release from
      // replacing the button and swallowing an otherwise valid click.
      buy.onpointerdown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activateUpgrade();
      };
      buy.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Pointer activation is handled above; detail 0 keeps keyboard and
        // assistive-technology activation working normally.
        if (event.detail === 0) activateUpgrade();
      };
      progress.append(levelLabel, track, buy);
      return progress;
    };

    const missileWarhead = strategicWarhead(economy.strategicMissileLevel);
    const missileAccuracy = strategicAccuracy(economy.strategicAccuracyLevel);
    const droneWarhead = emberWarhead(economy.emberDroneWarheadLevel);
    if (missile) {
      upgradeRows.append(
        upgradeRow(
          'WARHEAD',
          economy.strategicMissileLevel,
          MAX_STRATEGIC_MISSILE_LEVEL,
          canUpgradeStrategicMissile(this.sim, economy),
          'Increase missile damage, blast radius, and survivability',
          controls.upgradeWarhead,
        ),
        upgradeRow(
          'ACCURACY',
          economy.strategicAccuracyLevel,
          MAX_STRATEGIC_ACCURACY_LEVEL,
          canUpgradeStrategicAccuracy(this.sim, economy),
          'Reduce only the strategic missile impact scatter',
          controls.upgradeAccuracy,
        ),
      );
    } else {
      upgradeRows.append(
        upgradeRow(
          'QUANTITY',
          economy.emberDroneQuantityLevel,
          MAX_EMBER_DRONE_QUANTITY_LEVEL,
          canUpgradeEmberDroneQuantity(this.sim, economy),
          'Add one drone to every Ember salvo, up to ten',
          controls.upgradeEmberQuantity,
        ),
        upgradeRow(
          'WARHEAD',
          economy.emberDroneWarheadLevel,
          MAX_EMBER_DRONE_WARHEAD_LEVEL,
          canUpgradeEmberDroneWarhead(this.sim, economy),
          'Increase each Ember drone’s impact and damage',
          controls.upgradeEmberWarhead,
        ),
      );
    }

    const detail = document.createElement('div');
    detail.style.cssText = 'font:700 8px/1.2 ui-monospace,Menlo,monospace;color:#8f9b97;letter-spacing:.035em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    detail.textContent = missile
      ? `${missileWarhead.label} · ${missileWarhead.damageScale.toFixed(2)}× POWER · ${missileAccuracy.radius}M AIM`
      : `${salvoSize} DRONE${salvoSize === 1 ? '' : 'S'} · ${droneWarhead.label} · ${droneWarhead.damageScale.toFixed(2)}× POWER · ${emberScatterRadius()}M SCATTER`;
    column.append(launch, upgradeRows, detail);
    return column;
  }

  private strategicStateKey(): string {
    const controls = this.actions.strategic!;
    const economy = controls.economy;
    return [
      economy.strategicMissileLevel,
      economy.strategicAccuracyLevel,
      economy.emberDroneQuantityLevel,
      economy.emberDroneWarheadLevel,
      Math.ceil(economy.strategicMissileCooldown),
      Math.ceil(economy.emberDroneCooldown),
      Math.floor(economy.credits),
      economy.powerProduced,
      economy.powerUsed,
      controls.activeTargeting() ?? '',
      this.strategicEnemyTeam ?? '',
    ].join(':');
  }

  private groupButton(group: SelectionGroup, selectedCount: number): HTMLDivElement {
    const active = group.entities.length === selectedCount;
    const button = document.createElement('div');
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.title = `Select ${group.entities.length} ${group.label}`;
    button.setAttribute('aria-label', `Select ${group.entities.length} ${group.label}`);
    button.style.cssText =
      'flex:0 0 136px;min-height:92px;text-align:left;padding:5px;display:grid;grid-template-rows:48px auto;gap:4px;align-items:stretch;' +
      'border-radius:2px;border:1px solid #4b5552;border-top-color:#757f7a;border-left-color:#757f7a;' +
      `background:${active ? 'linear-gradient(180deg,#4f4728,#1d2018)' : 'linear-gradient(180deg,#26302f,#121817)'};` +
      'color:#eef3e9;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.48);';
    button.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.actions.selectEntities(group.entities);
      this.lastKey = '';
      this.update();
    };
    button.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.actions.selectEntities(group.entities);
      this.lastKey = '';
      this.update();
    };
    button.oncontextmenu = (event) => event.preventDefault();

    const icon = document.createElement('div');
    icon.style.cssText =
      'position:relative;min-height:48px;border:1px solid #111;background:#111615;overflow:hidden;' +
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),inset 0 -18px 18px rgba(0,0,0,.35);';
    const fallback = document.createElement('div');
    fallback.style.cssText =
      'position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(180deg,#252b2d,#0d1112);color:#d2b15f;font-size:15px;z-index:1;';
    fallback.textContent = initials(group.label);
    const img = document.createElement('img');
    setCommandPortrait(img, group.kind, group.entities[0]?.team?.id);
    img.alt = '';
    img.style.cssText = 'position:relative;z-index:2;width:100%;height:100%;object-fit:cover;display:block;';
    img.onerror = () => img.remove();
    icon.append(fallback, img, badge(`×${group.entities.length}`, active));
    const topRank = Math.max(0, ...group.entities.map((entity) => entity.combatRank?.rank ?? 0));
    if (topRank > 0) icon.appendChild(rankChevronBadge(topRank));
    if (group.unitKind) icon.appendChild(this.upgradeButton(group));

    const copy = document.createElement('div');
    copy.style.cssText = 'display:grid;gap:2px;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:11px;color:#f0f3e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1;';
    name.textContent = group.label;
    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:10px;color:#aebbc4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1;';
    const health = group.healthPct === undefined ? '' : ` · ${group.healthPct}% HP`;
    const rankLabel = topRank > 0 ? ` · ${['', 'Veteran', 'Elite', 'Ace'][topRank]}` : '';
    meta.textContent = `${group.type}${health}${rankLabel}`;
    copy.append(name, meta);
    button.append(icon, copy);
    return button;
  }

  private upgradeButton(group: SelectionGroup): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '↑';
    button.title = `Upgrade ${group.label}`;
    button.setAttribute('aria-label', `Upgrade ${group.label}`);
    button.style.cssText =
      'position:absolute;left:3px;top:3px;z-index:6;width:24px;height:24px;padding:0;display:grid;place-items:center;' +
      'border:1px solid #d2b15f;background:#101716;color:#f0d56a;font:bold 18px/1 ui-monospace,Menlo,monospace;cursor:pointer;' +
      'box-shadow:0 2px 6px rgba(0,0,0,.55);';
    button.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openUpgradePopover(group, button);
    };
    button.onkeydown = (event) => event.stopPropagation();
    return button;
  }

  private openUpgradePopover(group: SelectionGroup, anchor: HTMLElement): void {
    this.closeAllUpgradePopovers();
    if (!group.unitKind) return;
    const popover = document.createElement('div');
    popover.dataset.upgradePopover = 'true';
    popover.style.cssText =
      'position:absolute;left:50%;bottom:calc(100% + 9px);transform:translateX(-50%);width:min(440px,calc(100vw - 40px));' +
      'display:grid;gap:8px;padding:10px;background:linear-gradient(180deg,#1d2625,#0b1110);border:1px solid #717b74;' +
      'box-shadow:0 16px 36px rgba(0,0,0,.55),inset 0 0 0 1px rgba(210,177,95,.18);z-index:20;';
    popover.onpointerdown = (event) => event.stopPropagation();
    this.populateUpgradePopover(popover, group, () => popover.remove());
    this.root.appendChild(popover);
    anchor.blur();
  }

  private populateUpgradePopover(popover: HTMLDivElement, group: SelectionGroup, closePopover: () => void): void {
    if (!group.unitKind) return;

    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;color:#f0d56a;font-size:12px;';
    const ownedSummary = group.entities.reduce((sum, entity) => sum + (entity.unitUpgrades?.ids.length ?? 0), 0);
    heading.innerHTML = `<span>UPGRADE ${escapeHtml(group.label.toUpperCase())}</span><span style="color:#b8c3bf">$${Math.floor(this.actions.credits())} · ${ownedSummary} INSTALLED</span>`;
    popover.appendChild(heading);

    for (const def of upgradeOptionsForKind(group.unitKind)) {
      const owned = group.entities.filter((entity) => hasUnitUpgrade(entity, def.id)).length;
      const missing = group.entities.length - owned;
      const totalCost = missing * def.cost;
      const affordable = this.actions.credits() >= totalCost;
      const row = document.createElement('button');
      row.type = 'button';
      row.disabled = missing === 0 || !affordable;
      row.style.cssText =
        'width:100%;display:grid;grid-template-columns:1fr auto;gap:7px 12px;text-align:left;padding:9px;border:1px solid #46514e;' +
        `background:${missing === 0 ? '#18211b' : affordable ? '#202a28' : '#241b19'};color:#eef3e9;cursor:${row.disabled ? 'default' : 'pointer'};opacity:${missing === 0 ? '.72' : '1'};`;
      const state = missing === 0 ? 'INSTALLED' : `$${totalCost}`;
      const stateColor = missing === 0 ? '#78df8b' : affordable ? '#f0d56a' : '#ff7d67';
      row.innerHTML =
        `<strong style="font-size:12px">${escapeHtml(def.label)}${def.hotkey ? ` <span style="color:#72e6d0">[${def.hotkey}]</span>` : ''}</strong>` +
        `<strong style="font-size:12px;color:${stateColor}">${state}</strong>` +
        `<span style="grid-column:1/-1;color:#aebbc4;font-size:10px;line-height:1.35">${escapeHtml(def.description)}</span>` +
        `<span style="grid-column:1/-1;color:#76847f;font-size:9px">${owned}/${group.entities.length} OWN THIS · $${def.cost} PER UNIT</span>`;
      row.onclick = () => {
        const result = this.actions.purchaseUpgrade(group.entities.map((entity) => entity.id), def.id);
        if (result.ok) {
          popover.replaceChildren();
          this.populateUpgradePopover(popover, group, closePopover);
        }
        this.showPurchaseResult(popover, result);
        this.lastKey = '';
      };
      popover.appendChild(row);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'CLOSE';
    close.style.cssText = 'justify-self:end;padding:4px 8px;border:1px solid #46514e;background:#111817;color:#b8c3bf;cursor:pointer;font:10px ui-monospace,Menlo,monospace;';
    close.onclick = closePopover;
    popover.appendChild(close);
  }

  private showPurchaseResult(popover: HTMLElement, result: UpgradePurchaseResult): void {
    const existing = popover.querySelector('[data-purchase-result]');
    existing?.remove();
    const status = document.createElement('div');
    status.dataset.purchaseResult = 'true';
    status.textContent = result.reason;
    status.style.cssText = `font-size:10px;color:${result.ok ? '#78df8b' : '#ff7d67'};`;
    popover.appendChild(status);
    if (result.ok) setTimeout(() => this.update(), 0);
  }

  private syncWorldUpgradeButtons(selected: Entity[]): void {
    const upgradeable = selected.filter((entity) => unitKindForUpgrade(entity) !== undefined);
    const activeIds = new Set(upgradeable.map((entity) => entity.id));
    for (const [id, button] of this.worldButtons) {
      if (activeIds.has(id)) continue;
      button.remove();
      this.worldButtons.delete(id);
      if (this.worldPopoverEntityId === id) this.closeWorldPopover();
    }
    for (const entity of upgradeable) {
      let button = this.worldButtons.get(entity.id);
      const kind = unitKindForUpgrade(entity)!;
      const options = upgradeOptionsForKind(kind);
      const missing = options.filter((def) => !hasUnitUpgrade(entity, def.id)).length;
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.worldUpgradeId = String(entity.id);
        button.style.cssText =
          'position:fixed;display:grid;place-items:center;width:25px;height:25px;padding:0;transform:translate(-50%,-100%);' +
          'pointer-events:auto;border:1px solid #f0d56a;border-radius:50%;background:rgba(8,14,13,.94);color:#f6dc72;' +
          'font:900 17px/1 ui-monospace,Menlo,monospace;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.62),0 0 0 2px rgba(8,14,13,.55),0 0 12px rgba(240,213,106,.24);';
        button.onpointerdown = (event) => {
          event.preventDefault();
          event.stopPropagation();
        };
        button.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const current = this.sim.byId.get(entity.id);
          if (current) this.openWorldUpgradePopover(current);
        };
        button.oncontextmenu = (event) => event.preventDefault();
        this.worldButtons.set(entity.id, button);
        this.worldOverlay.appendChild(button);
      }
      button.textContent = missing > 0 ? '↑' : '✓';
      button.style.borderColor = missing > 0 ? '#f0d56a' : '#70db87';
      button.style.color = missing > 0 ? '#f6dc72' : '#70db87';
      button.title = missing > 0 ? `${missing} upgrades available for ${unitDisplayName(entity)}` : `${unitDisplayName(entity)} fully upgraded`;
      button.setAttribute('aria-label', button.title);
    }
    this.updateWorldAnchors();
  }

  private openWorldUpgradePopover(entity: Entity): void {
    const unitKind = unitKindForUpgrade(entity);
    if (!unitKind) return;
    this.closeAllUpgradePopovers();
    const descriptor = selectionDescriptor(entity);
    const group: SelectionGroup = { ...descriptor, entities: [entity], healthPct: averageHealthPct([entity]) };
    const popover = document.createElement('div');
    popover.dataset.upgradePopover = 'true';
    popover.dataset.worldUpgradePopover = String(entity.id);
    popover.style.cssText =
      'position:fixed;width:min(330px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow-y:auto;display:grid;gap:7px;padding:9px;pointer-events:auto;' +
      'background:linear-gradient(180deg,rgba(29,38,37,.98),rgba(8,14,13,.98));border:1px solid #7a826f;' +
      'box-shadow:0 14px 34px rgba(0,0,0,.62),inset 0 0 0 1px rgba(210,177,95,.2);z-index:30;';
    popover.onpointerdown = (event) => event.stopPropagation();
    popover.oncontextmenu = (event) => event.preventDefault();
    this.worldPopover = popover;
    this.worldPopoverEntityId = entity.id;
    this.populateUpgradePopover(popover, group, () => this.closeWorldPopover());
    this.worldOverlay.appendChild(popover);
    const anchor = this.projectUpgradeAnchor(entity);
    this.positionWorldPopover(entity, anchor.x, anchor.y);
  }

  private projectUpgradeAnchor(entity: Entity): { x: number; y: number; visible: boolean } {
    if (!this.camera || !this.hf) return { x: 0, y: 0, visible: false };
    const terrainY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
    const baseY = entity.flight ? entity.transform.y ?? terrainY + 24 : terrainY;
    const lift = entity.flight ? 5.5 : entity.selectable?.type === 'infantry' ? 3.25 : 5.2;
    this.projectedAnchor.set(entity.transform.x, baseY + lift, entity.transform.z).project(this.camera);
    const x = (this.projectedAnchor.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this.projectedAnchor.y * 0.5 + 0.5) * window.innerHeight;
    return {
      x,
      y,
      visible: this.projectedAnchor.z >= -1 && this.projectedAnchor.z <= 1 && x > 10 && x < window.innerWidth - 10 && y > 10 && y < window.innerHeight - 10,
    };
  }

  private positionWorldPopover(_entity: Entity, anchorX: number, anchorY: number): void {
    if (!this.worldPopover) return;
    const halfWidth = Math.min(165, Math.max(100, window.innerWidth / 2 - 12));
    const x = Math.max(halfWidth + 8, Math.min(window.innerWidth - halfWidth - 8, anchorX));
    const height = this.worldPopover.offsetHeight || 245;
    let y = anchorY - height - 36;
    if (y < 12) y = anchorY + 12;
    y = Math.max(12, Math.min(window.innerHeight - height - 12, y));
    this.worldPopover.style.left = `${x}px`;
    this.worldPopover.style.top = `${y}px`;
    this.worldPopover.style.bottom = 'auto';
    this.worldPopover.style.transform = 'translateX(-50%)';
  }

  private closeAllUpgradePopovers(): void {
    this.root.querySelector('[data-upgrade-popover]')?.remove();
    this.closeWorldPopover();
  }

  private closeWorldPopover(): void {
    this.worldPopover?.remove();
    this.worldPopover = undefined;
    this.worldPopoverEntityId = undefined;
  }
}

function selectionGroups(entities: Entity[]): SelectionGroup[] {
  const map = new Map<string, SelectionGroup>();
  for (const entity of entities) {
    const descriptor = selectionDescriptor(entity);
    const existing = map.get(descriptor.key);
    if (existing) existing.entities.push(entity);
    else map.set(descriptor.key, { ...descriptor, entities: [entity] });
  }
  for (const group of map.values()) group.healthPct = averageHealthPct(group.entities);
  return Array.from(map.values());
}

function selectionDescriptor(entity: Entity): Omit<SelectionGroup, 'entities' | 'healthPct'> {
  if (entity.building?.kind) {
    const def = STRUCTURES[entity.building.kind as StructureKind];
    return {
      key: `building:${entity.building.kind}`,
      kind: entity.building.kind,
      label: entity.building.label ?? def?.label ?? entity.name ?? 'Building',
      type: 'BUILDING',
    };
  }
  if (entity.harvester) return { key: 'unit:harvester', kind: 'harvester', label: unitDisplayName(entity), type: 'ECONOMY' };
  const unitKind = unitKindForUpgrade(entity);
  if (unitKind) {
    const unit = UNITS[unitKind];
    return { key: `unit:${unitKind}`, kind: unitKind, label: unitDisplayName(entity), type: unit.tab.toUpperCase(), unitKind };
  }
  const type = entity.selectable?.type ?? 'unit';
  return { key: `unit:${type}`, kind: type, label: unitDisplayName(entity), type: type.toUpperCase() };
}

function averageHealthPct(entities: Entity[]): number | undefined {
  let sum = 0;
  let count = 0;
  for (const entity of entities) {
    if (!entity.health || entity.health.max <= 0) continue;
    sum += Math.max(0, Math.min(1, entity.health.current / entity.health.max));
    count++;
  }
  return count > 0 ? Math.round((sum / count) * 100) : undefined;
}

function badge(text: string, active: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:absolute;right:3px;top:3px;z-index:4;padding:1px 4px;border:1px solid rgba(0,0,0,.55);font-size:10px;line-height:14px;' +
    `background:${active ? '#d2b15f' : '#111615'};color:${active ? '#151715' : '#f0d56a'};box-shadow:0 1px 4px rgba(0,0,0,.45);`;
  return el;
}

/** Gold chevron stack for Veteran / Elite / Ace on selection cards. */
function rankChevronBadge(rank: number): HTMLDivElement {
  const el = document.createElement('div');
  el.title = rank === 1 ? 'Veteran' : rank === 2 ? 'Elite' : 'Ace';
  el.setAttribute('aria-label', el.title);
  el.style.cssText =
    'position:absolute;left:3px;bottom:3px;z-index:5;display:grid;gap:1px;padding:2px 3px;' +
    'border:1px solid rgba(210,177,95,.55);background:rgba(8,12,10,.82);box-shadow:0 1px 4px rgba(0,0,0,.45);';
  for (let i = 0; i < Math.min(3, rank); i++) {
    const chevron = document.createElement('div');
    chevron.style.cssText =
      'width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;' +
      `border-bottom:6px solid ${rank >= 3 ? '#f4d56a' : '#e0c45a'};margin:0 auto;`;
    el.appendChild(chevron);
  }
  return el;
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function factionAccent(team: number): string {
  return `#${FACTION[factionId(team)].accent.toString(16).padStart(6, '0')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}
