import { describe, expect, it } from 'vitest';
import { controlGuideSections, guideMarkup } from './howToPlay';

describe('How to Play platform instructions', () => {
  it('shows keyboard and mouse controls on desktop', () => {
    const guide = JSON.stringify(controlGuideSections(false));
    expect(guide).toContain('Ctrl/Cmd + 0–9');
    expect(guide).toContain('WASD / arrows');
    expect(guide).toContain('V / Escape');
    expect(guide).toContain('use the wheel for optical zoom');
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


describe('current-game field guide', () => {
  it('explains both doctrines, route behavior, and paid building repairs', () => {
    const guide = guideMarkup(false);
    for (const text of ['Aegis Coalition', 'Vesper Republic', 'no strategic missile program', 'no Helipads or aircraft production', 'Attack as you move', '10 credits per second', '20 paid seconds', 'Flashing red dots']) expect(guide).toContain(text);
    expect((guide.match(/TACTICAL ILLUSTRATION/g) ?? []).length).toBe(5);
    expect(guide).toContain('Formation variation');
  });
  it('has a destination for every chapter link and touch controls on mobile', () => {
    const guide = guideMarkup(true);
    for (const id of ['guide-start', 'guide-armies', 'guide-tactics', 'guide-care', 'guide-controls']) {
      expect(guide).toContain(`href="#${id}"`);
      expect(guide).toContain(`id="${id}"`);
    }
    expect(guide).toContain('Two fingers');
    expect(guide).not.toContain('WASD / arrows');
  });
});
