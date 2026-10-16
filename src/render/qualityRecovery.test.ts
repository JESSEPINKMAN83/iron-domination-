import { describe, expect, it } from 'vitest';
import { QualityRecoveryGate } from './qualityRecovery';
const advance = (gate: QualityRecoveryGate, seconds: number) => { for (let i = 0; i < seconds * 10 + 1; i++) gate.advance(.1); };
describe('quality recovery stability', () => {
  it('holds a degraded tier before probing expensive effects', () => {
    const gate = new QualityRecoveryGate();
    gate.changed(0, 1);
    advance(gate, 12);
    expect(gate.canRecoverTo(0)).toBe(false);
    advance(gate, 19);
    expect(gate.canRecoverTo(0)).toBe(true);
  });
  it('backs off repeated failed promotions independently by target tier', () => {
    const gate = new QualityRecoveryGate();
    gate.changed(0, 1); advance(gate, 31);
    gate.changed(1, 0); advance(gate, 5); gate.changed(0, 1);
    advance(gate, 31); expect(gate.canRecoverTo(0)).toBe(false);
    advance(gate, 30); expect(gate.canRecoverTo(0)).toBe(true);
    gate.changed(1, 0); advance(gate, 5); gate.changed(0, 1);
    advance(gate, 61); expect(gate.canRecoverTo(0)).toBe(false);
    advance(gate, 60); expect(gate.canRecoverTo(0)).toBe(true);
  });
  it('does not use a hidden-tab pause to skip the recovery wait', () => {
    const gate = new QualityRecoveryGate(); gate.changed(0, 1);
    gate.advance(600); gate.advance(NaN);
    expect(gate.canRecoverTo(0)).toBe(false);
  });
  it('allows new recovery attempts after a long stable successful promotion', () => {
    const gate = new QualityRecoveryGate(); advance(gate, 31);
    gate.changed(1, 0); advance(gate, 40); gate.changed(0, 1);
    advance(gate, 31); expect(gate.canRecoverTo(0)).toBe(true);
  });
});
