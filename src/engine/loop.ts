// Render loop plus pluggable fixed-tick drivers. Single-player still uses the
// familiar wall-clock accumulator; networked play can let lockstep decide how
// many sim ticks are safe to advance each rendered frame.
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
const DEFAULT_MAX_TICKS_PER_FRAME = 8;

export interface LoopCallbacks {
  /** Called 0..n times per frame with a fixed dt of 1/30 s. */
  simTick: (dt: number, tick: number) => void;
  /** Called once per frame. alpha ∈ [0,1) = fraction into the next sim tick. */
  render: (alpha: number, frameDt: number, timeSeconds: number) => void;
}

export interface TickFrame {
  ticks: number;
  alpha: number;
}

export interface TickDriver {
  frame(frameDt: number): TickFrame;
}

export class AccumulatorTickDriver implements TickDriver {
  private accumulator = 0;

  constructor(private readonly maxTicksPerFrame = DEFAULT_MAX_TICKS_PER_FRAME) {}

  frame(frameDt: number): TickFrame {
    this.accumulator += frameDt;
    let ticks = 0;
    while (this.accumulator >= SIM_DT && ticks < this.maxTicksPerFrame) {
      ticks++;
      this.accumulator -= SIM_DT;
    }
    if (ticks >= this.maxTicksPerFrame && this.accumulator >= SIM_DT) {
      this.accumulator = Math.min(this.accumulator, SIM_DT * 0.95);
    }
    return { ticks, alpha: this.accumulator / SIM_DT };
  }
}

export class NetworkTickDriver implements TickDriver {
  private accumulator = 0;

  constructor(
    private readonly canAdvance: () => boolean,
    private readonly maxTicksPerFrame = DEFAULT_MAX_TICKS_PER_FRAME,
  ) {}

  frame(frameDt: number): TickFrame {
    this.accumulator = Math.min(this.accumulator + frameDt, SIM_DT * this.maxTicksPerFrame);
    if (!this.canAdvance()) return { ticks: 0, alpha: 0 };
    let ticks = 0;
    while (this.accumulator >= SIM_DT && ticks < this.maxTicksPerFrame) {
      if (!this.canAdvance()) break;
      ticks++;
      this.accumulator -= SIM_DT;
    }
    return { ticks, alpha: this.accumulator / SIM_DT };
  }
}

export class GameLoop {
  private last = 0;
  private tickCount = 0;
  private rafId = 0;
  running = false;

  constructor(
    private readonly callbacks: LoopCallbacks,
    private readonly tickDriver: TickDriver = new AccumulatorTickDriver(),
  ) {}

  get ticks(): number {
    return this.tickCount;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number): void => {
      if (!this.running) return;
      // Clamp to avoid a spiral of death after tab switches / long stalls.
      const frameDt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      const ticks = this.tickDriver.frame(frameDt);
      for (let i = 0; i < ticks.ticks; i++) {
        this.callbacks.simTick(SIM_DT, this.tickCount++);
      }
      this.callbacks.render(ticks.alpha, frameDt, now / 1000);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
