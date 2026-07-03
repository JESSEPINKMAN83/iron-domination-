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
}

const PANEL_CSS =
  'position:fixed;padding:10px 12px;font:11px/1.6 ui-monospace,Menlo,monospace;color:#cfd8e3;' +
  'background:rgba(8,12,16,.72);border:1px solid rgba(255,255,255,.08);border-radius:6px;' +
  'pointer-events:none;white-space:pre;z-index:10;';

export class Hud {
  private readonly stats: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private lastUpdate = 0;

  constructor(container: HTMLElement) {
    this.stats = document.createElement('div');
    this.stats.style.cssText = PANEL_CSS + 'top:12px;left:12px;';
    container.appendChild(this.stats);

    this.help = document.createElement('div');
    this.help.style.cssText = PANEL_CSS + 'bottom:12px;left:12px;';
    this.help.textContent = [
      'IRON DOMINION — Phase 1',
      'Pan       W A S D / arrows / screen edge',
      'Grab pan  right-drag or hold Space + move',
      'Zoom      mouse wheel (28–140)',
      'Rotate    Q / E (90°)',
      'Overlay   F3 walkability debug',
      'Help      F1 show/hide',
    ].join('\n');
    container.appendChild(this.help);
  }

  toggleHelp(): void {
    this.help.style.display = this.help.style.display === 'none' ? 'block' : 'none';
  }

  update(nowMs: number, s: HudStats): void {
    if (nowMs - this.lastUpdate < 250) return;
    this.lastUpdate = nowMs;
    const tris = s.triangles >= 1e6 ? `${(s.triangles / 1e6).toFixed(2)}M` : `${(s.triangles / 1e3).toFixed(0)}k`;
    this.stats.textContent = [
      `FPS ${s.fps.toFixed(1)}  (${s.frameMs.toFixed(1)} ms)`,
      `draw calls ${s.drawCalls} · tris ${tris}`,
      `sim ${s.simHz} Hz · instances ${s.instances}`,
      `zoom ${s.zoom.toFixed(1)} · yaw ${Math.round(s.yawDeg)}°`,
    ].join('\n');
  }
}
