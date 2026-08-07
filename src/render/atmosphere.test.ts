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

  it('keeps Highlands low clouds above the normal command-camera envelope', () => {
    const preset = MAP_PRESETS.highlands.atmosphere.lowClouds;
    const clouds = createCloudLayout(1024, 4242, preset, 17);

    expect(clouds).toHaveLength(preset.clusters);
    expect(clouds.every((cloud) => cloud.y >= 108 && cloud.y <= 128)).toBe(true);
    expect(clouds.every((cloud) => cloud.y - cloud.thickness >= 96)).toBe(true);
    expect(preset.opacity).toBeLessThanOrEqual(0.24);
    expect(clouds.every((cloud) => cloud.puffs.length === preset.puffsPerCluster)).toBe(true);
  });

  it('builds rounded cloud masses instead of flat stacked discs', () => {
    const preset = MAP_PRESETS.highlands.atmosphere.lowClouds;
    const [cloud] = createCloudLayout(1024, 4242, preset, 17);
    const centralPuff = cloud.puffs[0];
    const edgePuffs = cloud.puffs.slice(Math.ceil(cloud.puffs.length * 0.42));

    expect(centralPuff.offsetY).toBeGreaterThan(0);
    expect(centralPuff.scaleY).toBeGreaterThan(cloud.thickness);
    expect(edgePuffs.some((puff) => puff.scaleY < centralPuff.scaleY)).toBe(true);
    expect(edgePuffs.some((puff) => puff.offsetY < centralPuff.offsetY)).toBe(true);
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
