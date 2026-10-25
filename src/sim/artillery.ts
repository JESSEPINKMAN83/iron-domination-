import type { Entity } from './components';

export const ARTILLERY_DEPLOY_SECONDS = 15;
export const ARTILLERY_PACK_SECONDS = 5;

export function setArtilleryDeployment(entity: Entity, deploy: boolean): void {
  if (!entity.artillery || entity.destroyed) return;
  entity.artillery.deploy = deploy;
  if (deploy && entity.mover) {
    entity.mover.target = undefined; entity.mover.flow = undefined; entity.mover.engage = undefined;
    entity.mover.tactic = undefined;
  }
}

/** Movement orders pack a braced gun; an idle gun deploys at its destination. */
export function stepArtillery(entity: Entity, dt: number): boolean {
  const gun = entity.artillery;
  if (!gun || entity.destroyed) return false;
  const moving = Boolean(entity.mover?.target || Math.abs(entity.playerControlled?.throttle ?? 0) > 0.01);
  if (entity.mover) entity.mover.engage = undefined;
  if (gun.phase === 'deployed' && (moving || !gun.deploy)) { gun.phase='packing'; gun.elapsed=0; }
  if (gun.phase === 'deploying' && (moving || !gun.deploy)) { gun.phase='mobile'; gun.elapsed=0; }
  if (gun.phase === 'mobile' && gun.deploy && !moving) { gun.phase='deploying'; gun.elapsed=0; }
  if (gun.phase === 'deploying' || gun.phase === 'packing') {
    gun.elapsed += dt;
    const duration = gun.phase === 'deploying' ? ARTILLERY_DEPLOY_SECONDS : ARTILLERY_PACK_SECONDS;
    if (gun.elapsed + 1e-8 >= duration) { gun.phase=gun.phase === 'deploying' ? 'deployed' : 'mobile'; gun.elapsed=0; }
  }
  return gun.phase !== 'mobile';
}

export function artilleryStatus(entity: Entity): string {
  const gun=entity.artillery;
  if (!gun) return '';
  if (gun.phase==='deployed') return `DEPLOYED · reload ${Math.max(0,entity.weapon?.cooldown ?? 0).toFixed(1)}s`;
  if (gun.phase==='mobile') return 'MOBILE · F to deploy';
  const duration=gun.phase==='deploying' ? ARTILLERY_DEPLOY_SECONDS : ARTILLERY_PACK_SECONDS;
  return `${gun.phase==='deploying'?'DEPLOYING':'PACKING'} · ${Math.max(0,duration-gun.elapsed).toFixed(1)}s`;
}
