import { afterEach, describe, expect, it } from 'vitest';
import {
  applyArmyFactionColors,
  ARMY_COLOR_FAMILIES,
  armyFactionPalettes,
  factionCamoColors,
  FACTION,
} from './palette';

describe('army faction colors', () => {
  afterEach(() => applyArmyFactionColors(['iron-legion', 'missile-command'], [1, 2]));

  it('uses Aegis blue and Vesper red regardless of army order', () => {
    const defaultMatch = armyFactionPalettes(['iron-legion', 'missile-command'], [1, 2]);
    expect(defaultMatch[0]).toEqual(ARMY_COLOR_FAMILIES.aegisBlue);
    expect(defaultMatch[1]).toEqual(ARMY_COLOR_FAMILIES.vesperRed);

    const swappedMatch = armyFactionPalettes(['missile-command', 'iron-legion'], [1, 2]);
    expect(swappedMatch[0]).toEqual(ARMY_COLOR_FAMILIES.vesperRed);
    expect(swappedMatch[1]).toEqual(ARMY_COLOR_FAMILIES.aegisBlue);
  });

  it('shares one color across allies and gives every additional hostile side a distinct color', () => {
    const allies = armyFactionPalettes(['iron-legion', 'iron-legion', 'missile-command'], [1, 1, 2]);
    expect(allies[0]).toEqual(allies[1]);
    expect(allies[0]).toEqual(ARMY_COLOR_FAMILIES.aegisBlue);
    expect(allies[2]).toEqual(ARMY_COLOR_FAMILIES.vesperRed);

    const fourSides = armyFactionPalettes(
      ['iron-legion', 'iron-legion', 'iron-legion', 'iron-legion'],
      [1, 2, 3, 4],
    );
    expect(new Set(fourSides.map((palette) => palette.accent)).size).toBe(4);
  });

  it('drives the complete world and camouflage palette, not only the accent stripe', () => {
    applyArmyFactionColors(['missile-command', 'iron-legion'], [1, 2]);
    expect(FACTION[1]).toEqual(ARMY_COLOR_FAMILIES.vesperRed);
    expect(FACTION[2]).toEqual(ARMY_COLOR_FAMILIES.aegisBlue);
    expect(factionCamoColors(1)).not.toEqual(factionCamoColors(2));
    expect(factionCamoColors(1)[0]).toBe('#643b3a');
    expect(factionCamoColors(2)[0]).toBe('#315977');
  });
});
