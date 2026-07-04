// Debug HUD: performance stats (top-left) and controls help (bottom-left).
// pointer-events: none so it never blocks edge panning.
export interface HudStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
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
  private lastUpdate = 0;

  constructor(container: HTMLElement) {
    this.stats = document.createElement('div');
    this.stats.style.cssText = PANEL_CSS + 'top:12px;left:12px;';
    container.appendChild(this.stats);

    this.help = document.createElement('div');
    this.help.style.cssText = PANEL_CSS + 'bottom:12px;left:12px;';
    this.help.textContent = [
      'IRON DOMINION — Phase 6',
      'Test start all tech unlocked · ?start=normal for build-up',
      'AI opts   ?ai=easy|normal|hard  ?ai-style=turtle|rusher|balanced',
      'Pan       W A S D / arrows / screen edge',
      'Grab pan  hold Space + move/drag',
      'Look      Cmd/Ctrl + left-drag free aim',
      'Zoom      mouse wheel (28–140)',
      'Rotate    Q / E (90°)',
      'Build     sidebar queues structure, READY then left-click terrain',
      'Cancel    right-click sidebar icon; Escape returns READY placement',
      'Factory   select producer, set PRIMARY, right-click map for rally',
      'Attack    A, then right-click destination',
      'Face      right-click hold + drag to move, then face arrow',
      'Possess   select unit, press V',
      'Chase     W/S drive, A/D turn, mouse aim',
      'Vulture   W/S thrust, A/D yaw, Space/Ctrl altitude',
      'Fire      left-click cannon, right-click bomb',
      'Aircraft  left-click rockets, right-click bomb',
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
  }

  toggleHelp(): void {
    this.help.style.display = this.help.style.display === 'none' ? 'block' : 'none';
  }

  setFirstPerson(active: boolean): void {
    this.reticle.style.display = active ? 'block' : 'none';
  }

  update(nowMs: number, s: HudStats): void {
    if (nowMs - this.lastUpdate < 250) return;
    this.lastUpdate = nowMs;
    const tris = s.triangles >= 1e6 ? `${(s.triangles / 1e6).toFixed(2)}M` : `${(s.triangles / 1e3).toFixed(0)}k`;
    this.stats.textContent = [
      `FPS ${s.fps.toFixed(1)}  (${s.frameMs.toFixed(1)} ms)`,
      `draw calls ${s.drawCalls} · tris ${tris}`,
      `sim ${s.simHz} Hz · instances ${s.instances}`,
      `units ${s.units} · selected ${s.selected}`,
      `mode ${s.mode}`,
      `zoom ${s.zoom.toFixed(1)} · yaw ${Math.round(s.yawDeg)}° · pitch ${Math.round(s.pitchDeg)}°`,
    ].join('\n');
  }
}
