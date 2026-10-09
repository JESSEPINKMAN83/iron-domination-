import { areTeamsHostile, entityById, type GameSim } from '../sim/world';

/** Radar warnings expose incoming ordnance, without exposing its firing unit. */
export function incomingMissileContacts(sim: GameSim, team: number): Array<{ x: number; z: number }> {
  const bases = Array.from(sim.world.entities).filter((entity) => entity.team?.id === team && entity.building && !entity.destroyed);
  const contacts: Array<{ x: number; z: number }> = [];
  for (const projectile of sim.projectiles) {
    if (!areTeamsHostile(sim, team, projectile.teamId) || projectile.strategicInterceptor || (projectile.launchDelay ?? 0) > 0) continue;
    if (!projectile.strategic && !/missile|rocket/i.test(projectile.weaponKind ?? projectile.kind)) continue;
    const targetId = projectile.homing?.targetId ?? projectile.directTargetId;
    const target = targetId === undefined ? undefined : entityById(sim, targetId);
    const targetsBase = target?.team?.id === team && !!target.building && !target.destroyed;
    const approachesBase = bases.some((base) => {
      const radius = (base.collider?.radius ?? 15) + 60;
      return (projectile.toX - base.transform.x) ** 2 + (projectile.toZ - base.transform.z) ** 2 <= radius ** 2;
    });
    if (!targetsBase && !approachesBase && projectile.strategicTargetTeamId !== team) continue;
    const t = Math.max(0, Math.min(1, projectile.elapsed / Math.max(0.001, projectile.duration)));
    contacts.push({
      x: projectile.x ?? projectile.fromX + (projectile.toX - projectile.fromX) * t,
      z: projectile.z ?? projectile.fromZ + (projectile.toZ - projectile.fromZ) * t,
    });
  }
  return contacts;
}
