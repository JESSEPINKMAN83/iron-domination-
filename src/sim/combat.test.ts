import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { damageForArmor, manualFireAt, stepCombat } from './combat';
import { createEconomy, createInitialBase, placeStructure, startStructureBuild, stepEconomy, updatePlacement } from './economy';
import { generateHeightfield, sampleHeight } from './heightfield';
import { createGameSim, hashSim, spawnTankAt, spawnVultureAt } from './world';

const settle = (sim: ReturnType<typeof createGameSim>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) stepCombat(sim, 1 / 30);
};

describe('phase 4 combat simulation', () => {
  it('applies weapon damage matrix values', () => {
    expect(damageForArmor('rifle', 'heavy')).toBeCloseTo(2.2);
    expect(damageForArmor('cannon', 'heavy')).toBeCloseTo(5.76);
    expect(damageForArmor('bomb', 'heavy')).toBeCloseTo(15.08);
    expect(damageForArmor('bomb', 'building')).toBeCloseTo(7.8);
  });

  it('resolves a deterministic tank engagement and records combat events', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const a = spawnTankAt(sim, -20, -20, 'A');
      const b = spawnTankAt(sim, 18, -20, 'B', 2);
      settle(sim, 8);
      return { sim, aHp: a.health?.current ?? 0, bHp: b.health?.current ?? 0, events: sim.events.length, hash: hashSim(sim) };
    };

    const first = run();
    const second = run();
    expect(first.hash).toBe(second.hash);
    expect(first.events).toBeGreaterThan(0);
    expect(first.aHp).toBeLessThan(100);
    expect(first.bHp).toBeLessThan(100);
  });

  it('gates direct fire on turret traverse — misaligned turret holds fire', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    const target = spawnTankAt(sim, 18, -20, 'B', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    attacker.turret!.yaw = -Math.PI / 2; // pointing away

    expect(manualFireAt(sim, attacker, 42, -20)).toBe(false);
    expect(target.health?.current).toBe(100);

    attacker.turret!.yaw = Math.PI / 2; // traversed onto the shot line
    expect(manualFireAt(sim, attacker, 42, -20)).toBe(true);
    expect(target.health?.current).toBeLessThan(100);
    const event = sim.events.at(-1);
    expect(event?.sourceTeamId).toBe(1);
    expect(event?.targetId).toBe(target.id);
    expect(event?.targetLabel).toBe('B');
    expect(event?.targetHealth).toBe(target.health?.current);
    expect(event?.targetMaxHealth).toBe(100);
    expect(attacker.weapons?.primary.cooldown).toBeGreaterThan(0);
  });

  it('fires ballistic bombs that damage on impact, with splash falloff', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    const primary = spawnTankAt(sim, 18, -20, 'B', 2);
    const nearby = spawnTankAt(sim, 22, -20, 'C', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, primary.transform.x, primary.transform.z, 'secondary');
    const firedAgain = manualFireAt(sim, attacker, primary.transform.x, primary.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(firedAgain).toBe(false);
    expect(sim.projectiles).toHaveLength(1);
    expect(sim.events.at(-1)?.kind).toBe('bomb');
    // no damage until the bomb lands
    expect(primary.health?.current).toBe(100);

    settle(sim, 1.5);
    const impact = sim.events.find((event) => event.kind === 'bomb-impact');
    expect(sim.projectiles).toHaveLength(0);
    expect(impact).toBeDefined();
    expect(impact?.sourceTeamId).toBe(1);
    expect(impact?.targetId).toBeDefined();
    expect(impact?.targetHealth).toBeLessThan(100);
    expect(impact?.targetMaxHealth).toBe(100);
    expect(primary.health?.current).toBeLessThan(100);
    expect(nearby.health?.current).toBeLessThan(100);
    expect(nearby.health?.current).toBeGreaterThan(90);
  });

  it('lets player-controlled bombs fire beyond normal range with deterministic scatter', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, 360, -20, 'secondary');

    expect(fired).toBe(true);
    expect(sim.events).toHaveLength(1);
    expect(Math.hypot(sim.events[0].toX - attacker.transform.x, sim.events[0].toZ - attacker.transform.z)).toBeGreaterThan(152);
    expect(sim.events[0].toX).not.toBeCloseTo(360);
    expect(sim.events[0].kind).toBe('bomb');
  });

  it('keeps a manually fired bomb safely away from the firing tank', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, attacker.transform.x, attacker.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(Math.hypot(sim.events[0].toX - attacker.transform.x, sim.events[0].toZ - attacker.transform.z)).toBeGreaterThan(40);
    settle(sim, 1.5);
    expect(attacker.health?.current).toBe(100); // own splash never hurts own team
  });

  it('lets a moving possessed tank dodge enemy bombs — and punishes standing still', () => {
    const run = (dodge: boolean) => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const player = spawnTankAt(sim, -20, -20, 'A');
      const enemy = spawnTankAt(sim, -20, 45, 'B', 2);
      player.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
      enemy.weapons!.primary.cooldown = 999; // isolate the bomb
      enemy.turret!.yaw = Math.PI; // facing the player

      stepCombat(sim, 1 / 30);
      expect(sim.events.some((event) => event.kind === 'bomb')).toBe(true);
      if (dodge) {
        player.transform.x += 30; // drove away during the flight
        player.previousTransform.x += 30;
      }
      settle(sim, 2);
      return player.health?.current ?? 0;
    };

    expect(run(true)).toBe(100);
    expect(run(false)).toBeLessThan(100);
  });

  it('lets a player-controlled Vulture fire rockets at ground targets', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -14, -20, 'Vulture 1');
    const enemy = spawnTankAt(sim, 24, 18, 'Target', 2);
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.atan2(enemy.transform.x - vulture.transform.x, enemy.transform.z - vulture.transform.z), climb: 0 };
    if (vulture.turret) vulture.turret.yaw = vulture.playerControlled.aimYaw;

    const fired = manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'primary');

    expect(fired).toBe(true);
    expect(enemy.health?.current).toBeLessThan(100);
    expect(vulture.weapons?.primary.cooldown).toBeGreaterThan(0);
  });

  it('lets a player-controlled Vulture launch the shared ballistic bomb', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -14, -20, 'Vulture 1');
    const enemy = spawnTankAt(sim, 24, 18, 'Target', 2);
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.atan2(enemy.transform.x - vulture.transform.x, enemy.transform.z - vulture.transform.z), climb: 0 };

    const fired = manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(vulture.weapons?.secondary?.kind).toBe('bomb');
    expect(sim.projectiles).toHaveLength(1);
    expect(sim.events.at(-1)?.kind).toBe('bomb');
    expect(sim.events.at(-1)?.fromY).toBeGreaterThan(sampleHeight(hf, vulture.transform.x, vulture.transform.z) + 20);
    expect(enemy.health?.current).toBe(100);

    settle(sim, 1.5);
    expect(enemy.health?.current).toBeLessThan(100);
    expect(vulture.weapons?.secondary?.cooldown).toBeGreaterThan(0);
  });

  it('walls block ground navigation until destroyed', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    let placement = updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z);
    expect(placeStructure(sim, hf, economy, placement)).toBeDefined();

    expect(startStructureBuild(sim, economy, 'wall')).toBe(true);
    for (let i = 0; i < 30 * 2; i++) stepEconomy(sim, hf, economy, 1 / 30);
    placement = updatePlacement(sim, hf, 'wall', base.transform.x + 22, base.transform.z);
    const wall = placeStructure(sim, hf, economy, placement);
    expect(wall).toBeDefined();
    const cell = sim.nav.worldToCell(wall!.transform.x, wall!.transform.z);
    expect(sim.nav.isWalkableCell(cell.x, cell.y)).toBe(false);

    const attacker = spawnTankAt(sim, wall!.transform.x, wall!.transform.z - 24, 'Breacher', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    attacker.turret!.yaw = 0;
    wall!.health!.current = 1;
    expect(manualFireAt(sim, attacker, wall!.transform.x, wall!.transform.z)).toBe(true);

    expect(wall!.destroyed).toBeDefined();
    expect(sim.nav.isWalkableCell(cell.x, cell.y)).toBe(true);
  });

  it('guard towers automatically fire at nearby enemies', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    let placement = updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z);
    expect(placeStructure(sim, hf, economy, placement)).toBeDefined();

    expect(startStructureBuild(sim, economy, 'guard-tower')).toBe(true);
    for (let i = 0; i < 30 * 7; i++) stepEconomy(sim, hf, economy, 1 / 30);
    placement = updatePlacement(sim, hf, 'guard-tower', base.transform.x + 24, base.transform.z);
    const tower = placeStructure(sim, hf, economy, placement);
    expect(tower?.weapon?.kind).toBe('cannon');

    const enemy = spawnTankAt(sim, tower!.transform.x + 34, tower!.transform.z, 'Raider', 2);
    settle(sim, 4);

    expect(enemy.health?.current).toBeLessThan(100);
    expect(sim.events.some((event) => event.kind === 'cannon')).toBe(true);
  });
});
