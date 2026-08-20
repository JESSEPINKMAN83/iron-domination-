import type { Entity } from '../sim/components';
import { unitKindForUpgrade } from '../sim/upgrades';
import { UNIT_ARSENALS, type WeaponHudFamily } from '../content/unitArsenal';
import { WEAPONS, type WeaponKind } from '../content/phase4';

// Debug HUD: performance stats (top-left) and controls help (bottom-left).
// pointer-events: none so it never blocks edge panning.
export interface HudStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  renderScale: number;
  visualQuality: string;
  simHz: number;
  instances: number;
  zoom: number;
  yawDeg: number;
  pitchDeg: number;
  units: number;
  selected: number;
  mode: string;
}

const PANEL_CSS =
  'position:fixed;padding:10px 12px;font:11px/1.6 ui-monospace,Menlo,monospace;color:#cfd8e3;' +
  'background:rgba(8,12,16,.72);border:1px solid rgba(255,255,255,.08);border-radius:4px;' +
  'pointer-events:none;white-space:pre;z-index:10;';

export class Hud {
  private readonly stats: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly reticle: HTMLDivElement;
  private readonly modeBanner: HTMLDivElement;
  private readonly fortressFrame: HTMLDivElement;
  private readonly weaponFrame: HTMLDivElement;
  private readonly multiplayer: HTMLDivElement;
  private readonly multiplayerDetail: HTMLDivElement;
  private readonly tacticalCallout: HTMLDivElement;
  private infoVisible = false;
  private lastUpdate = 0;
  private tacticalTimer?: number;
  private reticleFlashTimer?: number;
  private fortressMode = false;
  private reticleFamily: WeaponHudFamily = 'rifle';
  private firstPersonEntity?: Entity;
  private lastWeaponUpdate = 0;

  constructor(container: HTMLElement) {
    this.stats = document.createElement('div');
    this.stats.style.cssText = PANEL_CSS + 'top:12px;left:12px;display:none;';
    container.appendChild(this.stats);

    this.help = document.createElement('div');
    this.help.style.cssText = PANEL_CSS + 'bottom:12px;left:12px;display:none;';
    this.help.textContent = [
      'IRON DOMINION — Phase 6',
      'Default: Command Yard + small escort · ?start=test all tech · ?start=battle-test staged battle',
      'AI opts   ?ai=easy|normal|hard  ?ai-style=turtle|rusher|balanced',
      'Pan       W A S D / arrows / screen edge',
      'Grab pan  hold Space + drag mouse button',
      'Look      Cmd/Ctrl + left-drag; empty right-drag',
      'Zoom      mouse wheel (28–280)',
      'Rotate    Q / E (90°)',
      'Build     sidebar queues structure, READY then left-click terrain',
      'Cancel    right-click sidebar icon; Escape returns READY placement',
      'Factory   select producer, set PRIMARY, right-click map for rally',
      'Attack    A, then right-click destination',
      'Stop      X stops selected units (S remains camera movement)',
      'Ground    Cmd + right-click makes selected units fire at that point',
      'Form      right-click hold + drag: column → wedge → battle line',
      'Possess   select unit, press V',
      'Chase     W/S drive, A/D turn, Shift boost, mouse aim',
      'V camera  wheel zoom, Cmd + left-drag orbit',
      'Sniper V  right-click scope toggle, wheel zoom, left-click fire',
      'Squad V   select group, V controls one, Tab swaps leader',
      'Vulture   W/S thrust, Shift boost, A/D yaw, Q/E hard turn, Space up, C down',
      'Fire      left-click primary, right-click secondary',
      'Audio     M mute/unmute',
      'Counters  Rifles infantry · Grenades buildings · Rockets armor/air',
      'Air       Wasp intercepts · Vulture suppresses · Hammerhead hunts air/ground',
      'Exit      V again or Escape',
      'Overlay   F3 walkability · F4 fog debug',
      'Help      F1 show/hide',
    ].join('\n');
    container.appendChild(this.help);

    this.reticle = document.createElement('div');
    this.reticle.style.cssText =
      'position:fixed;left:50%;top:50%;width:22px;height:22px;transform:translate(-50%,-50%);z-index:11;pointer-events:none;display:none;' +
      'border:1px solid rgba(210,230,210,.58);border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.45),0 0 12px rgba(125,242,125,.16);';
    this.reticle.innerHTML =
      '<span style="position:absolute;left:50%;top:-9px;width:1px;height:7px;background:rgba(210,230,210,.7)"></span>' +
      '<span style="position:absolute;left:50%;bottom:-9px;width:1px;height:7px;background:rgba(210,230,210,.7)"></span>' +
      '<span style="position:absolute;top:50%;left:-9px;width:7px;height:1px;background:rgba(210,230,210,.7)"></span>' +
      '<span style="position:absolute;top:50%;right:-9px;width:7px;height:1px;background:rgba(210,230,210,.7)"></span>';
    container.appendChild(this.reticle);

    this.modeBanner = document.createElement('div');
    this.modeBanner.className = 'game-mode-banner';
    this.modeBanner.style.cssText =
      'position:fixed;left:50%;top:12px;transform:translate(-50%,-135%);opacity:0;z-index:13;pointer-events:none;' +
      'min-width:260px;padding:10px 18px;text-align:center;font:12px/1.25 ui-monospace,Menlo,monospace;color:#f0f3e8;' +
      'background:linear-gradient(180deg,rgba(30,40,40,.94),rgba(8,12,13,.88));border:1px solid rgba(240,213,106,.58);border-radius:4px;' +
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.06),0 10px 28px rgba(0,0,0,.42),0 0 18px rgba(240,213,106,.16);' +
      'transition:transform 260ms cubic-bezier(.2,.8,.2,1),opacity 180ms ease;';
    const mobileTouch = typeof document !== 'undefined' && document.documentElement.classList.contains('mobile-touch-device');
    this.modeBanner.innerHTML =
      '<div style="font-size:13px;color:#f0d56a;letter-spacing:.08em;">FIRST-PERSON VIEW</div>' +
      `<div style="margin-top:3px;font-size:10px;color:#b9c7c0;">${mobileTouch ? 'Use the left arrows to move and drag the right side to aim' : 'Press V or Escape to return to command view'}</div>`;
    container.appendChild(this.modeBanner);

    this.fortressFrame = document.createElement('div');
    this.fortressFrame.style.cssText =
      'position:fixed;inset:18px;display:none;pointer-events:none;z-index:12;color:#f3ce69;' +
      'border:1px solid rgba(232,190,72,.28);box-shadow:inset 0 0 60px rgba(210,155,35,.035);' +
      'font:700 9px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-shadow:0 1px 2px #000;';
    this.fortressFrame.innerHTML =
      '<div style="position:absolute;left:-1px;top:-1px;width:74px;height:22px;border-left:3px solid #e7bd4d;border-top:3px solid #e7bd4d"></div>' +
      '<div style="position:absolute;right:-1px;top:-1px;width:74px;height:22px;border-right:3px solid #e7bd4d;border-top:3px solid #e7bd4d"></div>' +
      '<div style="position:absolute;left:-1px;bottom:-1px;width:74px;height:22px;border-left:3px solid #e7bd4d;border-bottom:3px solid #e7bd4d"></div>' +
      '<div style="position:absolute;right:-1px;bottom:-1px;width:74px;height:22px;border-right:3px solid #e7bd4d;border-bottom:3px solid #e7bd4d"></div>' +
      '<div style="position:absolute;left:15px;top:14px"><span style="color:#fff0b0">FORTRESS FIRE CONTROL</span><br><span style="color:#9d8d64">HOLD T // EXPAND SCAN · RELEASE // LOCK TARGET</span></div>' +
      '<div style="position:absolute;right:15px;top:14px;color:#9d8d64;text-align:right">MOUSE WHEEL // OPTICAL ZOOM</div>' +
      '<div style="position:absolute;left:15px;bottom:12px;color:#9d8d64">DUAL HEAVY INTERCEPTOR // ONLINE</div>' +
      '<div style="position:absolute;right:15px;bottom:12px;color:#9d8d64">TACTICAL WARHEAD INTERLOCK // ARMED</div>';
    container.appendChild(this.fortressFrame);

    this.weaponFrame = document.createElement('div');
    this.weaponFrame.style.cssText =
      'position:fixed;inset:26px;display:none;pointer-events:none;z-index:10;color:#bfe8c9;' +
      'font:700 9px/1.45 ui-monospace,Menlo,monospace;letter-spacing:.13em;text-shadow:0 1px 2px #000;';
    container.appendChild(this.weaponFrame);

    this.multiplayer = document.createElement('div');
    this.multiplayer.style.cssText =
      'position:fixed;left:50%;top:62px;transform:translateX(-50%);z-index:14;display:none;pointer-events:none;' +
      'min-width:300px;max-width:min(520px,calc(100vw - 32px));padding:8px 14px;text-align:center;' +
      'font:11px/1.35 ui-monospace,Menlo,monospace;color:#dce8df;background:linear-gradient(180deg,rgba(22,30,30,.9),rgba(8,12,13,.82));' +
      'border:1px solid rgba(93,220,147,.48);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),0 10px 24px rgba(0,0,0,.35);';
    this.multiplayerDetail = document.createElement('div');
    this.multiplayerDetail.style.cssText = 'margin-top:2px;color:#aebbc4;font-size:10px;';
    this.multiplayer.append(document.createElement('div'), this.multiplayerDetail);
    container.appendChild(this.multiplayer);

    this.tacticalCallout = document.createElement('div');
    this.tacticalCallout.style.cssText =
      'position:fixed;left:50%;top:76px;transform:translate(-50%,-16px);opacity:0;pointer-events:none;z-index:16;' +
      'min-width:220px;padding:9px 13px;border:1px solid rgba(240,213,106,.72);background:rgba(11,17,17,.9);' +
      'box-shadow:0 8px 22px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.06);color:#f0d56a;' +
      'font:11px/1.35 ui-monospace,Menlo,monospace;letter-spacing:.05em;text-align:center;transition:opacity 160ms ease,transform 160ms ease;';
    container.appendChild(this.tacticalCallout);
  }

  toggleInfo(): void {
    this.setInfoVisible(!this.infoVisible);
  }

  setInfoVisible(visible: boolean): void {
    this.infoVisible = visible;
    this.stats.style.display = visible ? 'block' : 'none';
    this.help.style.display = visible ? 'block' : 'none';
  }

  getInfoVisible(): boolean {
    return this.infoVisible;
  }

  setFirstPerson(active: boolean, fortress = false, entity?: Entity): void {
    this.fortressMode = active && fortress;
    this.firstPersonEntity = active ? entity : undefined;
    const mobileTouch = typeof document !== 'undefined' && document.documentElement.classList.contains('mobile-touch-device');
    const unitKind = entity ? unitKindForUpgrade(entity) : undefined;
    const arsenal = unitKind ? UNIT_ARSENALS[unitKind] : undefined;
    this.reticleFamily = arsenal?.hud ?? 'rifle';
    const primary = weaponLabel(entity?.weapons?.primary.kind ?? entity?.weapon?.kind);
    const secondary = weaponLabel(entity?.weapons?.secondary?.kind);
    this.modeBanner.innerHTML = this.fortressMode
      ? '<div style="font-size:14px;color:#ffd96a;letter-spacing:.14em;">FORTRESS V-MODE</div>' +
        `<div style="margin-top:4px;font-size:10px;color:#d7c897;letter-spacing:.04em;">${mobileTouch ? 'Drag to aim · Hold SCAN, release to lock · FIRE interceptor · MISSILE barrage' : 'MOUSE AIM · WHEEL OPTICAL ZOOM · HOLD T SCAN · RELEASE TO LOCK · LMB/RMB FIRE · V EXIT'}</div>`
      : `<div style="font-size:13px;color:#f0d56a;letter-spacing:.1em;">${arsenal?.designation ?? 'DIRECT CONTROL'}</div>` +
        `<div style="margin-top:3px;font-size:10px;color:#b9c7c0;">${arsenal?.fireControl ?? 'MANUAL FIRE CONTROL'} · ${mobileTouch ? 'DRAG TO AIM' : 'V / ESC EXIT'}</div>`;
    this.modeBanner.style.minWidth = this.fortressMode ? '520px' : '260px';
    this.modeBanner.style.borderColor = this.fortressMode ? 'rgba(255,199,69,.88)' : 'rgba(240,213,106,.58)';
    this.fortressFrame.style.display = this.fortressMode ? 'block' : 'none';
    this.weaponFrame.style.display = active && !this.fortressMode ? 'block' : 'none';
    this.weaponFrame.innerHTML = active && !this.fortressMode
      ? weaponFrameMarkup(arsenal?.designation ?? 'DIRECT CONTROL', arsenal?.fireControl ?? 'MANUAL FCS', primary, secondary)
      : '';
    this.applyReticleTheme();
    this.reticle.style.display = active ? 'block' : 'none';
    if (!active) this.clearReticleFlash();
    this.modeBanner.style.opacity = active ? '1' : '0';
    this.modeBanner.style.transform = active ? 'translate(-50%,0)' : 'translate(-50%,-135%)';
  }

  /** Brief red punch on the FPS reticle when the possessed unit takes a hit. */
  flashReticle(intensity = 0.7): void {
    if (this.reticle.style.display === 'none') return;
    const force = Math.max(0.2, Math.min(1, intensity));
    const scale = 1.08 + force * 0.28;
    this.reticle.style.borderColor = `rgba(255,${Math.round(90 + (1 - force) * 80)},${Math.round(70 + (1 - force) * 60)},.95)`;
    this.reticle.style.boxShadow =
      `0 0 0 1px rgba(0,0,0,.55),0 0 ${14 + force * 22}px rgba(255,80,50,${0.35 + force * 0.45})`;
    this.reticle.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(3)})`;
    if (this.reticleFlashTimer !== undefined) window.clearTimeout(this.reticleFlashTimer);
    this.reticleFlashTimer = window.setTimeout(() => this.clearReticleFlash(), 160 + force * 140);
  }

  private clearReticleFlash(): void {
    if (this.reticleFlashTimer !== undefined) {
      window.clearTimeout(this.reticleFlashTimer);
      this.reticleFlashTimer = undefined;
    }
    this.applyReticleTheme();
    this.reticle.style.transform = 'translate(-50%,-50%)';
  }

  private applyReticleTheme(): void {
    const profile = reticleVisual(this.fortressMode ? 'fortress' : this.reticleFamily);
    this.reticle.style.width = `${profile.size}px`;
    this.reticle.style.height = `${profile.size}px`;
    this.reticle.style.borderRadius = profile.radius;
    this.reticle.style.borderColor = profile.color;
    this.reticle.style.color = profile.color;
    this.reticle.style.borderStyle = profile.border;
    this.reticle.innerHTML = profile.markup + reticleReloadMarkup();
    this.reticle.style.boxShadow = this.fortressMode
      ? '0 0 0 1px rgba(0,0,0,.7),0 0 20px rgba(255,183,48,.3),inset 0 0 12px rgba(255,199,62,.1)'
      : `0 0 0 1px rgba(0,0,0,.55),0 0 16px ${profile.glow}`;
    this.updateReticleWeaponReadiness();
  }

  setMultiplayerStatus(message: string, bad = false, paused = false): void {
    const title = this.multiplayer.firstElementChild as HTMLDivElement | null;
    if (!title) return;
    this.multiplayer.style.display = 'block';
    this.multiplayer.style.borderColor = bad ? 'rgba(255,118,102,.68)' : 'rgba(93,220,147,.48)';
    this.multiplayer.style.boxShadow = bad
      ? 'inset 0 0 0 1px rgba(255,255,255,.05),0 10px 24px rgba(0,0,0,.35),0 0 20px rgba(255,118,102,.2)'
      : 'inset 0 0 0 1px rgba(255,255,255,.05),0 10px 24px rgba(0,0,0,.35)';
    title.textContent = bad ? 'MULTIPLAYER WARNING' : 'MULTIPLAYER ONLINE';
    title.style.color = bad ? '#ff8a72' : '#7df27d';
    this.multiplayerDetail.textContent = paused ? `${message} · simulation paused` : message;
  }

  hideMultiplayerStatus(): void {
    this.multiplayer.style.display = 'none';
  }

  showTacticalPing(name: string, kind: 'attack' | 'help' | 'defend' | 'good-game'): void {
    const label = kind === 'good-game' ? 'GOOD GAME' : kind.toUpperCase();
    this.tacticalCallout.textContent = `${name.toUpperCase()}: ${label} HERE`;
    this.tacticalCallout.style.opacity = '1';
    this.tacticalCallout.style.borderColor = 'rgba(240,213,106,.72)';
    this.tacticalCallout.style.color = '#f0d56a';
    this.tacticalCallout.style.transform = 'translate(-50%,0)';
    if (this.tacticalTimer !== undefined) window.clearTimeout(this.tacticalTimer);
    this.tacticalTimer = window.setTimeout(() => {
      this.tacticalCallout.style.opacity = '0';
      this.tacticalCallout.style.transform = 'translate(-50%,-16px)';
    }, 4200);
  }

  showBaseUnderAttack(label: string, critical = false): void {
    this.tacticalCallout.textContent = critical
      ? `${label.toUpperCase()} CRITICAL`
      : `BASE UNDER ATTACK · ${label.toUpperCase()}`;
    this.tacticalCallout.style.opacity = '1';
    this.tacticalCallout.style.borderColor = 'rgba(255,109,94,.82)';
    this.tacticalCallout.style.color = '#ff816d';
    this.tacticalCallout.style.transform = 'translate(-50%,0)';
    if (this.tacticalTimer !== undefined) window.clearTimeout(this.tacticalTimer);
    this.tacticalTimer = window.setTimeout(() => {
      this.tacticalCallout.style.opacity = '0';
      this.tacticalCallout.style.transform = 'translate(-50%,-16px)';
    }, 4500);
  }

  update(nowMs: number, s: HudStats): void {
    this.updateWeaponReadiness(nowMs);
    if (nowMs - this.lastUpdate < 250) return;
    this.lastUpdate = nowMs;
    const tris = s.triangles >= 1e6 ? `${(s.triangles / 1e6).toFixed(2)}M` : `${(s.triangles / 1e3).toFixed(0)}k`;
    this.stats.textContent = [
      `FPS ${s.fps.toFixed(1)}  (${s.frameMs.toFixed(1)} ms)`,
      `draw calls ${s.drawCalls} · tris ${tris}`,
      `render scale ${s.renderScale.toFixed(2)}x · ${s.visualQuality}`,
      `sim ${s.simHz} Hz · instances ${s.instances}`,
      `units ${s.units} · selected ${s.selected}`,
      `mode ${s.mode}`,
      `zoom ${s.zoom.toFixed(1)} · yaw ${Math.round(s.yawDeg)}° · pitch ${Math.round(s.pitchDeg)}°`,
    ].join('\n');
  }

  private updateWeaponReadiness(nowMs: number): void {
    if (!this.firstPersonEntity || nowMs - this.lastWeaponUpdate < 50) return;
    this.lastWeaponUpdate = nowMs;
    const primary = this.firstPersonEntity.weapons?.primary ?? this.firstPersonEntity.weapon;
    const secondary = this.firstPersonEntity.weapons?.secondary;
    if (!this.fortressMode) {
      updateReloadNode(this.weaponFrame, 'primary', primary?.kind, primary?.cooldown ?? 0);
      updateReloadNode(this.weaponFrame, 'secondary', secondary?.kind, secondary?.cooldown ?? 0);
    }
    updateReticleReloadNode(this.reticle, 'primary', primary?.kind, primary?.cooldown ?? 0);
    updateReticleReloadNode(this.reticle, 'secondary', secondary?.kind, secondary?.cooldown ?? 0);
  }

  private updateReticleWeaponReadiness(): void {
    const primary = this.firstPersonEntity?.weapons?.primary ?? this.firstPersonEntity?.weapon;
    const secondary = this.firstPersonEntity?.weapons?.secondary;
    updateReticleReloadNode(this.reticle, 'primary', primary?.kind, primary?.cooldown ?? 0);
    updateReticleReloadNode(this.reticle, 'secondary', secondary?.kind, secondary?.cooldown ?? 0);
  }
}

function weaponLabel(kind: string | undefined): string {
  return kind && kind in WEAPONS ? WEAPONS[kind as WeaponKind].label.toUpperCase() : 'NONE';
}

function weaponFrameMarkup(designation: string, fireControl: string, primary: string, secondary: string): string {
  return `
    <div style="position:absolute;left:0;top:0;width:66px;height:18px;border-left:2px solid currentColor;border-top:2px solid currentColor"></div>
    <div style="position:absolute;right:0;top:0;width:66px;height:18px;border-right:2px solid currentColor;border-top:2px solid currentColor"></div>
    <div style="position:absolute;left:0;bottom:0;width:66px;height:18px;border-left:2px solid currentColor;border-bottom:2px solid currentColor"></div>
    <div style="position:absolute;right:0;bottom:0;width:66px;height:18px;border-right:2px solid currentColor;border-bottom:2px solid currentColor"></div>
    <div style="position:absolute;left:10px;top:8px"><span style="color:#f4dda0">${designation}</span><br><span style="color:#78968a">${fireControl}</span></div>
    <div style="position:absolute;right:10px;top:8px;text-align:right">
      <span style="color:#f4dda0">LMB // ${primary}</span> <b data-reload-label="primary" style="color:#8ee6a5">READY</b>
      <span style="display:inline-block;width:74px;height:3px;margin-left:7px;background:rgba(80,105,91,.38);vertical-align:middle"><i data-reload-bar="primary" style="display:block;width:100%;height:100%;background:#8ee6a5"></i></span><br>
      <span style="color:#78968a">RMB // ${secondary}</span> <b data-reload-label="secondary" style="color:#8ee6a5">READY</b>
      <span style="display:inline-block;width:74px;height:3px;margin-left:7px;background:rgba(80,105,91,.38);vertical-align:middle"><i data-reload-bar="secondary" style="display:block;width:100%;height:100%;background:#8ee6a5"></i></span>
    </div>
    <div style="position:absolute;left:10px;bottom:7px;color:#78968a">STABILIZATION // ACTIVE</div>
    <div style="position:absolute;right:10px;bottom:7px;color:#78968a">CENTER RETICLE // BORE AXIS</div>`;
}

function updateReloadNode(frame: HTMLDivElement, slot: 'primary' | 'secondary', kind: string | undefined, cooldown: number): void {
  const label = frame.querySelector<HTMLElement>(`[data-reload-label="${slot}"]`);
  const bar = frame.querySelector<HTMLElement>(`[data-reload-bar="${slot}"]`);
  if (!label || !bar) return;
  if (!kind || !(kind in WEAPONS)) {
    label.textContent = '—';
    label.style.color = '#60756b';
    bar.style.width = '0%';
    return;
  }
  const { progress, ready } = reticleReloadState(kind, cooldown);
  label.textContent = ready ? 'READY' : `RELOAD ${cooldown.toFixed(1)}S`;
  label.style.color = ready ? '#8ee6a5' : '#f2c15b';
  bar.style.width = `${Math.round(progress * 100)}%`;
  bar.style.background = ready ? '#8ee6a5' : '#f2c15b';
  bar.style.boxShadow = ready ? '0 0 7px rgba(105,235,151,.55)' : 'none';
}

function reticleReloadMarkup(): string {
  const track =
    'position:absolute;top:50%;width:3px;height:20px;transform:translateY(-50%);' +
    'overflow:hidden;border-radius:4px;background:rgba(4,9,9,.68);' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.48);transition:opacity 100ms ease;';
  const fill =
    'position:absolute;left:0;right:0;bottom:0;height:100%;border-radius:4px;' +
    'background:currentColor;opacity:.94;transition:height 50ms linear,opacity 100ms ease,box-shadow 100ms ease;';
  return `
    <span data-reticle-reload="primary" aria-hidden="true" style="${track}right:calc(100% + 9px)">
      <i data-reticle-reload-fill="primary" style="${fill}"></i>
    </span>
    <span data-reticle-reload="secondary" aria-hidden="true" style="${track}left:calc(100% + 9px)">
      <i data-reticle-reload-fill="secondary" style="${fill}"></i>
    </span>`;
}

function updateReticleReloadNode(reticle: HTMLDivElement, slot: 'primary' | 'secondary', kind: string | undefined, cooldown: number): void {
  const track = reticle.querySelector<HTMLElement>(`[data-reticle-reload="${slot}"]`);
  const fill = reticle.querySelector<HTMLElement>(`[data-reticle-reload-fill="${slot}"]`);
  if (!track || !fill) return;
  const state = reticleReloadState(kind, cooldown);
  track.style.display = state.available ? 'block' : 'none';
  if (!state.available) return;
  fill.style.height = `${Math.round(state.progress * 100)}%`;
  fill.style.opacity = state.ready ? '.98' : '.72';
  fill.style.boxShadow = state.ready ? '0 0 7px currentColor' : 'none';
  track.style.opacity = state.ready ? '.9' : '.62';
}

export function reticleReloadState(kind: string | undefined, cooldown: number): { available: boolean; ready: boolean; progress: number } {
  if (!kind || !(kind in WEAPONS)) return { available: false, ready: false, progress: 0 };
  const total = Math.max(0.01, WEAPONS[kind as WeaponKind].cooldown);
  const ready = cooldown <= 0.01;
  return {
    available: true,
    ready,
    progress: ready ? 1 : Math.max(0, Math.min(1, 1 - cooldown / total)),
  };
}

function reticleVisual(family: WeaponHudFamily | 'fortress'): { size: number; radius: string; color: string; glow: string; border: string; markup: string } {
  const color = family === 'aviation' || family === 'strike' ? 'rgba(110,224,255,.88)'
    : family === 'artillery' || family === 'ballistic' ? 'rgba(255,205,91,.88)'
      : family === 'seeker' || family === 'fortress' ? 'rgba(255,218,98,.9)'
        : 'rgba(190,238,202,.8)';
  const cross = '<i style="position:absolute;left:50%;top:-12px;width:1px;height:9px;background:currentColor"></i><i style="position:absolute;left:50%;bottom:-12px;width:1px;height:9px;background:currentColor"></i><i style="position:absolute;top:50%;left:-12px;width:9px;height:1px;background:currentColor"></i><i style="position:absolute;top:50%;right:-12px;width:9px;height:1px;background:currentColor"></i>';
  if (family === 'aviation') return { size: 42, radius: '50%', color, glow: 'rgba(72,205,255,.25)', border: 'solid', markup: `${cross}<b style="position:absolute;left:50%;top:50%;width:72px;height:18px;border:1px solid currentColor;border-top:0;border-radius:0 0 50% 50%;transform:translate(-50%,-22%)"></b>` };
  if (family === 'strike') return { size: 46, radius: '2px', color, glow: 'rgba(72,205,255,.28)', border: 'dashed', markup: `${cross}<b style="position:absolute;inset:9px;border:1px solid currentColor;transform:rotate(45deg)"></b>` };
  if (family === 'artillery') return { size: 50, radius: '50% 50% 4px 4px', color, glow: 'rgba(255,181,48,.28)', border: 'solid', markup: `${cross}<b style="position:absolute;left:50%;top:7px;bottom:7px;border-left:1px dashed currentColor"></b><em style="position:absolute;left:calc(50% + 5px);top:5px;font:7px monospace">8<br>6<br>4<br>2</em>` };
  if (family === 'ballistic') return { size: 34, radius: '50%', color, glow: 'rgba(255,181,48,.22)', border: 'dashed', markup: `${cross}<b style="position:absolute;left:5px;right:5px;bottom:-18px;height:14px;border:1px solid currentColor;border-top:0;border-radius:0 0 50% 50%"></b>` };
  if (family === 'seeker' || family === 'fortress') return { size: family === 'fortress' ? 34 : 48, radius: '2px', color, glow: 'rgba(255,183,48,.3)', border: 'dashed', markup: `${cross}<b style="position:absolute;inset:7px;border:1px solid currentColor"></b>` };
  if (family === 'armor') return { size: 38, radius: '50%', color, glow: 'rgba(125,242,125,.2)', border: 'solid', markup: `${cross}<b style="position:absolute;left:50%;top:50%;width:7px;height:7px;border:1px solid currentColor;transform:translate(-50%,-50%) rotate(45deg)"></b>` };
  if (family === 'precision') return { size: 26, radius: '50%', color, glow: 'rgba(125,242,125,.2)', border: 'solid', markup: `${cross}<b style="position:absolute;left:50%;top:50%;width:3px;height:3px;background:currentColor;border-radius:50%;transform:translate(-50%,-50%)"></b>` };
  return { size: 24, radius: '50%', color, glow: 'rgba(125,242,125,.16)', border: 'solid', markup: cross };
}
