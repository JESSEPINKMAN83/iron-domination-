import { describe, expect, it } from 'vitest';
import { chooseStrategicSeed, strategicSeedScore } from './strategicSeed';

describe('strategic random map seeds', () => {
  it('chooses the highest-scoring candidate deterministically', () => {
    const options = {
      mapId: 'highlands' as const,
      mapSize: 'medium' as const,
      oreAmount: 100,
      terrainRelief: 100,
    };
    const candidates = [1327, 90210, 619337, 883122];
    const selected = chooseStrategicSeed(options, candidates);
    const selectedScore = strategicSeedScore(options, selected);

    expect(candidates).toContain(selected);
    expect(selectedScore).toBe(Math.max(...candidates.map((seed) => strategicSeedScore(options, seed))));
    expect(chooseStrategicSeed(options, candidates)).toBe(selected);
  });

  it('supports dense ore and extreme terrain settings', () => {
    const selected = chooseStrategicSeed({
      mapId: 'crater-oasis',
      mapSize: 'large',
      oreAmount: 200,
      terrainRelief: 150,
    }, [42, 1337, 240771]);

    expect([42, 1337, 240771]).toContain(selected);
  });
});
