import type { EnemyCommander } from '../ai/commander';
import { SIM_DT } from '../engine/loop';
import type { LockstepRuntime } from '../net/commands';
import { stepCombat } from '../sim/combat';
import { stepEconomy, type EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import type { VisibilityGrid } from '../sim/visibility';
import { stepSim, type CombatEvent, type GameSim } from '../sim/world';
import type { Entity } from '../sim/components';

export interface MatchTickRuntime {
  sim: GameSim;
  hf: Heightfield;
  economies: EconomyState[];
  visions: VisibilityGrid[];
  commanders: EnemyCommander[];
  lockstep?: LockstepRuntime;
  autoFire: boolean;
  runCommanders: boolean;
}

export interface MatchTickResult {
  spawned: Entity[];
  events: CombatEvent[];
}

export function advanceTick(match: MatchTickRuntime): MatchTickResult {
  match.lockstep?.tick();
  if (match.runCommanders) {
    for (const commander of match.commanders) commander.step(SIM_DT);
  }

  const spawned = match.economies.flatMap((economy) => stepEconomy(match.sim, match.hf, economy, SIM_DT));
  stepSim(match.sim, match.hf, SIM_DT);
  stepCombat(match.sim, SIM_DT, { autoFire: match.autoFire });
  for (const vision of match.visions) vision.update(match.sim);

  return {
    spawned,
    events: match.sim.events.splice(0),
  };
}
