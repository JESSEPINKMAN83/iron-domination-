import type { EnemyCommander } from '../ai/commander';
import type { Entity } from '../sim/components';
import type { EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import { areTeamsHostile, spawnTankAt, spawnScoutTankAt, spawnSiegeTankAt, spawnVultureAt, spawnHammerheadAt, spawnWaspAt, type GameSim } from '../sim/world';

interface PreviewArmy {
  team: number;
  base: Entity;
  economy: EconomyState;
  commander?: EnemyCommander;
}

/** Local-only ready-made battle. Unit stats and commander decisions are unmodified. */
export function stageCoordinationPreview(sim: GameSim, hf: Heightfield, armies: PreviewArmy[], localTeam: number) {
  const player = armies.find((army) => army.team === localTeam)!;
  const enemy = armies.find((army) => areTeamsHostile(sim, localTeam, army.team));
  const units: Entity[] = [];
  const origin = player.base.transform;
  const dx = (enemy?.base.transform.x ?? 0) - origin.x;
  const dz = (enemy?.base.transform.z ?? 0) - origin.z;
  const distance = Math.max(1, Math.hypot(dx, dz));
  const forward = { x: dx / distance, z: dz / distance };
  const point = (advance: number, side: number) => ({
    x: origin.x + forward.x * advance - forward.z * side,
    z: origin.z + forward.z * advance + forward.x * side,
  });
  const spawnGround = (army: PreviewArmy, advance: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const p = point(advance + Math.floor(i / 5) * 14, (i % 5 - 2) * 18);
      const cell = sim.nav.nearestWalkableCellGlobal(p.x, p.z);
      if (!cell) continue;
      const pos = sim.nav.cellCenter(cell.x, cell.y);
      units.push([spawnTankAt, spawnTankAt, spawnScoutTankAt, spawnTankAt, spawnSiegeTankAt][i % 5](sim, pos.x, pos.z, `${['M-17', 'M-17', 'Jackal', 'M-17', 'Mauler'][i % 5]} ${army.team}-${i}`, army.team));
    }
  };
  const spawnAir = (army: PreviewArmy, advance: number, count: number) => {
    if(army.economy.doctrine!=='iron-legion') return;
    for (let i = 0; i < count; i++) {
      const p = point(advance, (i - (count - 1) / 2) * 20);
      units.push([spawnWaspAt, spawnVultureAt, spawnHammerheadAt][i % 3](sim, hf, p.x, p.z, `${['Wasp','Vulture','Hammerhead'][i%3]} support ${army.team}-${i}`, army.team));
    }
  };
  for (const army of armies) army.economy.credits = 22000;
  spawnGround(player, 80, 10);
  spawnAir(player, 70, 3);
  if (enemy) {
    spawnGround(enemy, Math.min(330, distance * 0.55), 18);
    spawnAir(enemy, Math.min(350, distance * 0.59), 6);
    spawnGround(enemy, distance - 65, 6);
  }
  return { units, forward, focus: point(150, 0) };
}
