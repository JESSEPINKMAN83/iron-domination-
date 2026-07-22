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
  'background:rgba(8,12,16,.72);border:1px solid rgba(255,255,255,.08);border-radius:6px;' +
  'pointer-events:none;white-space:pre;z-index:10;';

export class Hud {
  private readonly stats: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly reticle: HTMLDivElement;
  private readonly modeBanner: HTMLDivElement;
  private readonly multiplayer: HTMLDivElement;
  private readonly multiplayerDetail: HTMLDivElement;
  private readonly tacticalCallout: HTMLDivElement;
  private infoVisible = false;
  private lastUpdate = 0;
  private tacticalTimer?: number;

  constructor(container: HTMLElement) {
    this.stats = document.createElement('div');
    this.stats.style.cssText = PANEL_CSS + 'top:12px;left:12px;display:none;';
    container.appendChild(this.stats);

    this.help = document.createElement('div');
    this.help.style.cssText = PANEL_CSS + 'bottom:12px;left:12px;display:none;';
    this.help.textContent = [
      'IRON DOMINION — Phase 6',
      'Default: Command Yard + small escort · ?start=test all tech · ?start=armies stress battle',
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
      'Face      right-click hold + drag: facing line, length sets spread',
      'Possess   select unit, press V',
      'Chase     W/S drive, A/D turn, Shift boost, mouse aim',
      'V camera  wheel zoom, Cmd + left-drag orbit',
      'Sniper V  right-click scope toggle, wheel zoom, left-click fire',
      'Squad V   select group, V controls one, Tab swaps leader',
      'Vulture   W/S thrust, Shift boost, A/D yaw, Q/E hard turn, Space up, C down',
      'Fire      left-click primary, right-click secondary',
      'Audio     M mute/unmute',
      'Counters  Rifles infantry · Grenades buildings · Rockets armor/air',
      'Air       Wasp intercepts · Vulture/Hammerhead hit ground',
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
      'background:linear-gradient(180deg,rgba(30,40,40,.94),rgba(8,12,13,.88));border:1px solid rgba(240,213,106,.58);border-radius:3px;' +
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.06),0 10px 28px rgba(0,0,0,.42),0 0 18px rgba(240,213,106,.16);' +
      'transition:transform 260ms cubic-bezier(.2,.8,.2,1),opacity 180ms ease;';
    const mobileTouch = typeof document !== 'undefined' && document.documentElement.classList.contains('mobile-touch-device');
    this.modeBanner.innerHTML =
      '<div style="font-size:13px;color:#f0d56a;letter-spacing:.08em;">FIRST-PERSON VIEW</div>' +
      `<div style="margin-top:3px;font-size:10px;color:#b9c7c0;">${mobileTouch ? 'Use the left arrows to move and drag the right side to aim' : 'Press V or Escape to return to command view'}</div>`;
    container.appendChild(this.modeBanner);

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

  setFirstPerson(active: boolean): void {
    this.reticle.style.display = active ? 'block' : 'none';
    this.modeBanner.style.opacity = active ? '1' : '0';
    this.modeBanner.style.transform = active ? 'translate(-50%,0)' : 'translate(-50%,-135%)';
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
    this.tacticalCallout.style.transform = 'translate(-50%,0)';
    if (this.tacticalTimer !== undefined) window.clearTimeout(this.tacticalTimer);
    this.tacticalTimer = window.setTimeout(() => {
      this.tacticalCallout.style.opacity = '0';
      this.tacticalCallout.style.transform = 'translate(-50%,-16px)';
    }, 4200);
  }

  update(nowMs: number, s: HudStats): void {
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
}
