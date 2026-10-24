/** Local visual preference only: never included in room settings or simulation. */
export type GraphicsPreference = 'auto' | 'performance';
const KEY = 'code-red.graphics.v1';
export const GRAPHICS_CHANGE = 'code-red-graphics-change';
export function readGraphicsPreference(): GraphicsPreference {
  try { return localStorage.getItem(KEY) === 'performance' ? 'performance' : 'auto'; }
  catch { return 'auto'; }
}
export function limitedDesktopHardware(cores?: number, memory?: number): boolean {
  return (Number.isFinite(cores) && Number(cores) > 0 && Number(cores) <= 4)
    || (Number.isFinite(memory) && Number(memory) > 0 && Number(memory) <= 4);
}
export function performanceGraphics(preference: GraphicsPreference, mobile: boolean, cores?: number, memory?: number): boolean {
  return preference === 'performance' || (!mobile && limitedDesktopHardware(cores, memory));
}
export function performanceRenderScale(width: number, height: number, deviceCap: number): number {
  // Bound fill rate on external/high-DPI monitors; HTML controls stay native resolution.
  return Math.min(deviceCap, 0.75, Math.sqrt(900_000 / Math.max(1, width * height)));
}
export function applyGraphicsPreference(preference = readGraphicsPreference()): void {
  const hardware = navigator as Navigator & { deviceMemory?: number };
  document.documentElement.classList.toggle('performance-graphics', performanceGraphics(preference, matchMedia('(pointer: coarse)').matches, hardware.hardwareConcurrency, hardware.deviceMemory));
}
export function createGraphicsControl(): HTMLElement {
  const label = document.createElement('label');
  label.className = 'graphics-preference';
  // The match-menu backdrop cancels pointer defaults; native selects need theirs.
  label.onpointerdown = (event) => event.stopPropagation();
  label.textContent = 'Graphics ';
  label.title = 'Performance reduces local visual effects only. Game rules and multiplayer stay the same.';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Graphics quality');
  for (const [value, text] of [['auto', 'Auto'], ['performance', 'Performance · older laptop']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
  }
  select.value = readGraphicsPreference();
  select.onchange = () => {
    const value: GraphicsPreference = select.value === 'performance' ? 'performance' : 'auto';
    try { localStorage.setItem(KEY, value); } catch { /* Still applies to this match. */ }
    applyGraphicsPreference(value);
    window.dispatchEvent(new CustomEvent(GRAPHICS_CHANGE, { detail: value }));
  };
  label.append(select);
  return label;
}
