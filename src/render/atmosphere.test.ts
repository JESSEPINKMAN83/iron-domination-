import { describe, expect, it } from 'vitest';
import { MAP_PRESETS } from '../content/maps';
import { createCloudLayout } from './atmosphere';

describe('battlefield atmosphere cloud layout', () => {
  it('is deterministic for a map seed', () => {
    const preset = MAP_PRESETS.highlands.atmosphere.lowClouds;
    const first = createCloudLayout(1024, 4242, preset, 17);
    const second = createCloudLayout(1024, 4242, preset, 17);
    const changed = createCloudLayout(1024, 4243, preset, 17);

    expect(second).toEqual(first);
    expect(changed).not.toEqual(first);
  });

  it('places Highlands low clouds inside the flyable aircraft envelope', () => {
    const preset = MAP_PRESETS.highlands.atmosphere.lowClouds;
    const clouds = createCloudLayout(1024, 4242, preset, 17);

    expect(clouds).toHaveLength(preset.clusters);
    expect(clouds.every((cloud) => cloud.y >= 46 && cloud.y <= 70)).toBe(true);
    expect(clouds.some((cloud) => cloud.y < 60)).toBe(true);
    expect(clouds.every((cloud) => cloud.puffs.length === preset.puffsPerCluster)).toBe(true);
  });

  it('gives each biome a meaningfully different cloud profile', () => {
    const highlands = MAP_PRESETS.highlands.atmosphere;
    const desert = MAP_PRESETS['crater-oasis'].atmosphere;
    const frost = MAP_PRESETS['frostbite-pass'].atmosphere;

    expect(desert.lowClouds.clusters).toBeLessThan(highlands.lowClouds.clusters);
    expect(frost.lowClouds.clusters).toBeGreaterThan(highlands.lowClouds.clusters);
    expect(frost.lowClouds.opacity).toBeGreaterThan(desert.lowClouds.opacity);
    expect(highlands.cloudSoftness).toBeGreaterThan(frost.cloudSoftness);
    expect(highlands.lowClouds.opacity).toBeLessThan(frost.lowClouds.opacity);
    expect(new Set([highlands.skyZenith, desert.skyZenith, frost.skyZenith]).size).toBe(3);
  });

  it('reduces cloud geometry for the mobile-safe rendering path', () => {
    const preset = MAP_PRESETS['frostbite-pass'].atmosphere.lowClouds;
    const desktop = createCloudLayout(1024, 4242, preset, 17, 1);
    const mobile = createCloudLayout(1024, 4242, preset, 17, 0.55);
    const puffs = (clouds: typeof desktop) => clouds.reduce((sum, cloud) => sum + cloud.puffs.length, 0);

    expect(mobile.length).toBeLessThan(desktop.length);
    expect(puffs(mobile)).toBeLessThan(puffs(desktop));
  });
});
