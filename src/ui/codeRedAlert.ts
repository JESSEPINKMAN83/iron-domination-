// "Code Red" (צבע אדום) incoming-threat banner. One calm banner per salvo:
// threat, origin, a countdown to the earliest impact and how many were
// intercepted. It replaces the generic red callout for strategic threats.

const STYLE_ID = 'code-red-alert-style';
const LINGER_AFTER_IMPACT_MS = 2200;

interface ActiveThreat {
  impactAt: number;
}

function installStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.code-red-alert{position:fixed;left:50%;top:64px;z-index:17;pointer-events:none;
  transform:translate(-50%,-14px);opacity:0;transition:opacity 180ms ease,transform 180ms ease;
  min-width:280px;max-width:calc(100vw - 32px);padding:9px 16px 10px;text-align:center;
  font:11px/1.35 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:#ffd9d4;
  background:linear-gradient(180deg,rgba(74,10,10,.94),rgba(30,6,7,.92));
  border:1px solid rgba(255,96,82,.85);border-radius:4px;
  box-shadow:0 10px 26px rgba(0,0,0,.4),inset 0 0 0 1px rgba(255,255,255,.05);}
.code-red-alert.is-visible{opacity:1;transform:translate(-50%,0);}
.code-red-alert__title{display:flex;align-items:center;justify-content:center;gap:10px;
  font-size:15px;font-weight:900;letter-spacing:.14em;color:#ff6b5c;}
.code-red-alert__dot{width:9px;height:9px;border-radius:50%;background:#ff4d3d;
  box-shadow:0 0 10px #ff4d3d;animation:code-red-pulse 1s ease-in-out infinite;}
.code-red-alert__he{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0;font-size:16px;}
.code-red-alert__detail{margin-top:3px;color:#ffc4bc;}
.code-red-alert__status{margin-top:4px;font-size:10px;color:#9de5c4;min-height:13px;}
@keyframes code-red-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.code-red-alert__dot{animation:none}}
`;
  document.head.appendChild(style);
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export class CodeRedAlert {
  private readonly root: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private threats: ActiveThreat[] = [];
  private missiles = 0;
  private drones = 0;
  private readonly origins = new Set<string>();
  private readonly bearings = new Set<string>();
  private intercepted = 0;
  private launched = 0;
  private lastInterceptor = '';
  private hideAt = 0;

  constructor(container: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.className = 'code-red-alert';
    this.root.setAttribute('role', 'alert');
    const title = document.createElement('div');
    title.className = 'code-red-alert__title';
    title.innerHTML = '<span class="code-red-alert__dot"></span><span class="code-red-alert__he" lang="he" dir="rtl">צבע אדום</span><span>CODE RED</span>';
    this.detail = document.createElement('div');
    this.detail.className = 'code-red-alert__detail';
    this.status = document.createElement('div');
    this.status.className = 'code-red-alert__status';
    this.root.append(title, this.detail, this.status);
    container.appendChild(this.root);
  }

  /** Returns true when this starts a new alert (the caller plays the chime once). */
  warn(threat: 'missile' | 'drone', origin: string, count: number, etaSeconds: number, nowMs: number, bearing?: string): boolean {
    const fresh = this.threats.length === 0;
    if (fresh) {
      this.intercepted = 0;
      this.launched = 0;
      this.missiles = 0;
      this.drones = 0;
      this.origins.clear();
      this.bearings.clear();
      this.lastInterceptor = '';
    }
    if (threat === 'missile') this.missiles += Math.max(1, count);
    else this.drones += Math.max(1, count);
    this.origins.add(origin);
    if (bearing) this.bearings.add(bearing);
    this.launched += Math.max(1, count);
    const impactAt = nowMs + Math.max(0, etaSeconds) * 1000;
    for (let i = 0; i < Math.max(1, count); i++) this.threats.push({ impactAt });
    this.root.classList.add('is-visible');
    this.render(nowMs);
    return fresh;
  }

  intercept(interceptorLabel: string | undefined, nowMs: number): void {
    if (this.threats.length === 0) return;
    this.intercepted = Math.min(this.launched, this.intercepted + 1);
    if (interceptorLabel) this.lastInterceptor = interceptorLabel;
    // Drop the soonest pending impact; it will not land.
    this.threats.sort((a, b) => a.impactAt - b.impactAt).shift();
    if (this.threats.length === 0) this.hideAt = nowMs + LINGER_AFTER_IMPACT_MS;
    this.render(nowMs);
  }

  update(nowMs: number): void {
    if (!this.root.classList.contains('is-visible')) return;
    if (this.threats.length > 0 && this.threats.every((threat) => threat.impactAt <= nowMs)) {
      this.threats = [];
      this.hideAt = nowMs + LINGER_AFTER_IMPACT_MS;
    }
    if (this.threats.length === 0 && nowMs >= this.hideAt) {
      this.root.classList.remove('is-visible');
      return;
    }
    this.render(nowMs);
  }

  private threatLabel(): string {
    const missiles = this.missiles > 0 ? `FATTAH MISSILE${this.missiles > 1 ? `S ×${this.missiles}` : ''}` : '';
    const drones = this.drones > 0 ? `SHAHED DRONE${this.drones > 1 ? `S ×${this.drones}` : ''}` : '';
    return [missiles, drones].filter(Boolean).join(' + ');
  }

  private render(nowMs: number): void {
    const pending = this.threats.filter((threat) => threat.impactAt > nowMs);
    const label = this.threatLabel();
    if (pending.length > 0) {
      const seconds = Math.ceil((Math.min(...pending.map((threat) => threat.impactAt)) - nowMs) / 1000);
      setText(this.detail, `${label} · ${this.bearings.size ? 'APPROACHING FROM THE '+[...this.bearings].join(' / ') : 'INCOMING'} · ${[...this.origins].join(' + ')} · IMPACT ${seconds}s`);
    } else {
      setText(this.detail, this.intercepted >= this.launched ? `${label} · ALL INTERCEPTED` : `${label} · IMPACT`);
    }
    setText(this.status, this.intercepted > 0
      ? `INTERCEPTED ${this.intercepted}/${this.launched}${this.lastInterceptor ? ` · ${this.lastInterceptor.toUpperCase()}` : ''}`
      : '');
  }
}
