// Fixed-timestep game loop: simulation ticks at exactly 30 Hz, rendering runs
// uncapped and receives an interpolation alpha between the last two sim ticks.
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

export interface LoopCallbacks {
  /** Called 0..n times per frame with a fixed dt of 1/30 s. */
  simTick: (dt: number, tick: number) => void;
  /** Called once per frame. alpha ∈ [0,1) = fraction into the next sim tick. */
  render: (alpha: number, frameDt: number, timeSeconds: number) => void;
}

export class GameLoop {
  private accumulator = 0;
  private last = 0;
  private tickCount = 0;
  private rafId = 0;
  running = false;

  constructor(private readonly callbacks: LoopCallbacks) {}

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
      this.accumulator += frameDt;
      while (this.accumulator >= SIM_DT) {
        this.callbacks.simTick(SIM_DT, this.tickCount++);
        this.accumulator -= SIM_DT;
      }
      this.callbacks.render(this.accumulator / SIM_DT, frameDt, now / 1000);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
