import type { Entity } from './components';

export const ARTILLERY_DEPLOY_SECONDS = 10;
export const ARTILLERY_PACK_SECONDS = 5;

export function artilleryCanMove(entity:Entity):boolean {
  return !entity.artillery || !entity.artillery.deploy || entity.artillery.phase==='mobile';
}

export function setArtilleryDeployment(entity: Entity, deploy: boolean): void {
  if (!entity.artillery || entity.destroyed) return;
  entity.artillery.deploy = deploy;
  if (deploy && entity.mover) {
    entity.mover.target = undefined; entity.mover.flow = undefined; entity.mover.engage = undefined;
    entity.mover.tactic = undefined;
  }
}

/** A braced gun stays locked in place until explicitly packed. */
export function stepArtillery(entity: Entity, dt: number): boolean {
  const gun = entity.artillery;
  if (!gun || entity.destroyed) return false;
  const moving = Boolean(entity.mover?.target || Math.abs(entity.playerControlled?.throttle ?? 0) > 0.01);
  if (entity.mover) entity.mover.engage = undefined;
  if (gun.phase === 'deployed' && !gun.deploy) { gun.phase='packing'; gun.elapsed=0; }
  if (gun.phase === 'deploying' && !gun.deploy) { gun.phase='mobile'; gun.elapsed=0; }
  if (gun.deploy && (gun.phase==='deploying' || gun.phase==='deployed') && entity.mover) {
    entity.mover.target=undefined; entity.mover.flow=undefined; entity.mover.tactic=undefined;
  }
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
  if (gun.phase==='deployed') return 'DEPLOYED · POSITION LOCKED';
  if (gun.phase==='mobile') return 'MOBILE · GUN STOWED';
  const duration=gun.phase==='deploying' ? ARTILLERY_DEPLOY_SECONDS : ARTILLERY_PACK_SECONDS;
  return `${gun.phase==='deploying'?'DEPLOYING':'PACKING'} · ${Math.max(0,duration-gun.elapsed).toFixed(1)}s`;
}
