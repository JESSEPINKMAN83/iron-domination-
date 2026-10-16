/** Active foreground time, rather than wall time, governs attempts to restore effects.
 * Smooth frames with effects disabled do not prove the higher tier is affordable.
 */
export class QualityRecoveryGate {
  private seconds = 0;
  private readonly retryAt = [30, 30, 30];
  private readonly failures = [0, 0, 0];
  private probe?: { tier: number; started: number };

  advance(dt: number): void { if (Number.isFinite(dt) && dt > 0) this.seconds += Math.min(dt, 0.1); }

  canRecoverTo(tier: number): boolean { return this.seconds >= this.retryAt[tier]; }

  changed(from: number, to: number): void {
    if (to < from) {
      this.probe = { tier: to, started: this.seconds };
      return;
    }
    // A failed promotion must not be retried as soon as the lean tier runs fast.
    if (this.probe?.tier === from && this.seconds - this.probe.started < 25) {
      this.failures[from] = Math.min(4, this.failures[from] + 1);
    } else this.failures[from] = 0;
    this.retryAt[from] = this.seconds + Math.min(300, 30 * 2 ** this.failures[from]);
    this.probe = undefined;
  }
}
