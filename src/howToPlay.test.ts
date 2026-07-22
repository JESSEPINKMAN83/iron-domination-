import { describe, expect, it } from 'vitest';
import { controlGuideSections } from './howToPlay';

describe('How to Play platform instructions', () => {
  it('shows keyboard and mouse controls on desktop', () => {
    const guide = JSON.stringify(controlGuideSections(false));
    expect(guide).toContain('Ctrl/Cmd + 0–9');
    expect(guide).toContain('WASD / arrows');
    expect(guide).toContain('V / Escape');
    expect(guide).not.toContain('Two fingers');
  });

  it('shows touch and on-screen controls on mobile', () => {
    const guide = JSON.stringify(controlGuideSections(true));
    expect(guide).toContain('Two fingers');
    expect(guide).toContain('CONTROL');
    expect(guide).toContain('FIRE, MISSILE, and SPECIAL');
    expect(guide).not.toContain('WASD / arrows');
  });
});
