import type { Entity } from './components';
import type { EconomyState } from './economy';
import { sampleHeight, type Heightfield } from './heightfield';
import { allianceSide, type GameSim } from './world';

export const CAPTURE_RADIUS = 25;
export const CAPTURE_TICKS = 240;
/** Physical pad plus clearance for ground-unit hulls; the surrounding ring stays open. */
export const OBJECTIVE_FOOTPRINT = { halfWidth: 9, halfDepth: 8 } as const;

export function registerObjectiveBlocker(sim: GameSim, site: Entity): void {
  sim.nav.setBuildingBlocker(site.id,site.transform.x,site.transform.z,OBJECTIVE_FOOTPRINT.halfWidth,OBJECTIVE_FOOTPRINT.halfDepth);
}

export function outsideObjectiveFootprint(unit: Entity, site: Entity): boolean {
  return Math.abs(unit.transform.x-site.transform.x) > OBJECTIVE_FOOTPRINT.halfWidth || Math.abs(unit.transform.z-site.transform.z) > OBJECTIVE_FOOTPRINT.halfDepth;
}
export const OBJECTIVE_INFO = {
  radar: { label: 'Radar station', symbol: 'R', benefit: 'Reveals nearby terrain and enemies' },
  supply: { label: 'Supply depot', symbol: 'S', benefit: 'Repairs parked ground combat units nearby' },
  oil: { label: 'Oil field', symbol: 'O', benefit: '+100 credits every 10 seconds' },
} as const;

/** Public landmarks, never targetable structures or victory-condition assets. */
export function seedObjectives(sim: GameSim, hf: Heightfield, center = { x: 0, z: 0 }, radius = Math.min(150, hf.size * 0.15)): Entity[] {
  if (sim.objectivesQuery.size) return [...sim.objectivesQuery];
  const sites: Entity[] = [];
  for (const [i, kind] of (['radar', 'supply', 'oil'] as const).entries()) {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / 3;
    const cell = sim.nav.nearestWalkableCellGlobal(center.x + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius);
    if (!cell) continue;
    const pos = sim.nav.cellCenter(cell.x, cell.y);
    if (sites.some(site => Math.hypot(site.transform.x-pos.x, site.transform.z-pos.z) < CAPTURE_RADIUS * 2)) continue;
    const transform = { ...pos, y: sampleHeight(hf, pos.x, pos.z), rot: 0 };
    const site = sim.world.add({ id: sim.nextEntityId++, name: OBJECTIVE_INFO[kind].label, transform, previousTransform: { ...transform }, objective: { kind, captureTicks: 0, contested: false, rewardTicks: 0 } });
    sites.push(site);
    registerObjectiveBlocker(sim,site);
  }
  return sites;
}

export function canCapture(entity: Entity): boolean {
  return !!entity.mover && !!entity.team && !!entity.health && entity.health.current > 0 && !entity.destroyed && !entity.flight && !entity.building && !entity.harvester && !!(entity.weapon || entity.weapons);
}

/** Fixed 10 Hz; no random state, per-frame allocations, or extra projectile work. */
export function stepObjectives(sim: GameSim, economies: EconomyState[]): void {
  if (sim.tick % 3 !== 0 || !sim.objectivesQuery.size) return;
  const ground = [...sim.movers].filter(canCapture).sort((a,b) => a.id-b.id);
  for (const site of sim.objectivesQuery) {
    const o = site.objective;
    const present = ground.filter(unit => Math.hypot(unit.transform.x-site.transform.x, unit.transform.z-site.transform.z) <= CAPTURE_RADIUS && outsideObjectiveFootprint(unit,site));
    const sides = new Set(present.map(unit => allianceSide(sim, unit.team!.id)));
    o.contested = sides.size > 1;
    if (o.contested) continue;
    const team = present.length ? Math.min(...present.map(unit => unit.team!.id)) : undefined;
    const friendly = team !== undefined && o.ownerTeam !== undefined && allianceSide(sim, team) === allianceSide(sim, o.ownerTeam);
    if (team !== undefined && !friendly) {
      if (allianceSide(sim, team) !== allianceSide(sim, o.capturingTeam)) o.captureTicks = 0;
      o.capturingTeam = team;
      o.captureTicks += 3;
      if (o.captureTicks >= CAPTURE_TICKS) {
        o.ownerTeam = team;
        site.team = { id: team };
        site.vision = { radius: o.kind === 'radar' ? 180 : 45 };
        o.captureTicks = 0; o.capturingTeam = undefined; o.rewardTicks = 0;
      }
    } else {
      // Capture requires continuous occupation; an abandoned neutral site flies white.
      o.captureTicks = 0;
      o.capturingTeam = undefined;
    }
    if (o.ownerTeam === undefined || o.capturingTeam !== undefined) continue;
    o.rewardTicks += 3;
    if (o.kind === 'oil' && o.rewardTicks >= 300) {
      const economy = economies.find(e => e.team === o.ownerTeam);
      if (economy) { economy.credits += 100; economy.ledger.push({ tick: sim.tick, type: 'income', label: 'Captured oil field', amount: 100 }); }
      o.rewardTicks -= 300;
    }
    if (o.kind === 'supply' && o.rewardTicks >= 30) {
      for (const unit of ground) {
        if (allianceSide(sim, unit.team!.id) !== allianceSide(sim, o.ownerTeam) || unit.mover!.target || Math.hypot(unit.transform.x-site.transform.x, unit.transform.z-site.transform.z) > 36) continue;
        unit.health!.current = Math.min(unit.health!.max, unit.health!.current + unit.health!.max * 0.02);
      }
      o.rewardTicks -= 30;
    }
    if (o.kind === 'radar') o.rewardTicks = 0;
  }
}
