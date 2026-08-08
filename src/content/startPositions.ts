export type StartTeam = 1 | 2 | 3 | 4;

/** Normalised offset from map centre, as a fraction of map size. */
export type SpawnPoint = { x: number; z: number };
export type ArmySpawnPoints = [SpawnPoint, SpawnPoint, SpawnPoint, SpawnPoint];

const START_FACTORS: Record<StartTeam, SpawnPoint> = {
  1: { x: -0.34, z: -0.34 },
  2: { x: 0.34, z: 0.34 },
  3: { x: 0.34, z: -0.34 },
  4: { x: -0.34, z: 0.34 },
};

/**
 * Keeps a base clear of the map edge. A command yard plus its starting
 * structures needs room on every side.
 */
export const SPAWN_EDGE_LIMIT = 0.44;
/** Drag positions land on this grid, as a fraction of map size. */
export const SPAWN_GRID = 0.02;
/** Closest two armies may start to each other, as a fraction of map size. */
export const SPAWN_MIN_SEPARATION = 0.24;

export function startPosition(size: number, team: number): { x: number; z: number } {
  const factor = START_FACTORS[clampStartTeam(team)];
  return { x: size * factor.x, z: size * factor.z };
}

export function startMusterPosition(size: number, team: number): { x: number; z: number } {
  const base = startPosition(size, team);
  const inward = size * 0.025;
  const factor = START_FACTORS[clampStartTeam(team)];
  return {
    x: base.x - Math.sign(factor.x) * inward,
    z: base.z - Math.sign(factor.z) * inward,
  };
}

/** World position for an army, honouring a dragged spawn point when present. */
export function armyStartPosition(size: number, team: number, points?: ArmySpawnPoints): { x: number; z: number } {
  const point = points?.[clampStartTeam(team) - 1];
  if (!point) return startPosition(size, team);
  return { x: size * point.x, z: size * point.z };
}

export function defaultSpawnPoints(): ArmySpawnPoints {
  return [
    { ...START_FACTORS[1] },
    { ...START_FACTORS[2] },
    { ...START_FACTORS[3] },
    { ...START_FACTORS[4] },
  ];
}

/** Spawn points laid out by a slot assignment, the pre-drag corner behaviour. */
export function spawnPointsFromSlots(slots: readonly number[]): ArmySpawnPoints {
  return [0, 1, 2, 3].map((index) => ({
    ...START_FACTORS[clampStartTeam(slots[index] ?? index + 1)],
  })) as ArmySpawnPoints;
}

export function snapSpawnPoint(point: SpawnPoint): SpawnPoint {
  return {
    x: clampSpawnAxis(Math.round(point.x / SPAWN_GRID) * SPAWN_GRID),
    z: clampSpawnAxis(Math.round(point.z / SPAWN_GRID) * SPAWN_GRID),
  };
}

export function sanitizeSpawnPoints(value: unknown): ArmySpawnPoints | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const fallback = defaultSpawnPoints();
  return [0, 1, 2, 3].map((index) => {
    const raw = value[index] as Partial<SpawnPoint> | undefined;
    const x = Number(raw?.x);
    const z = Number(raw?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return fallback[index];
    return snapSpawnPoint({ x, z });
  }) as ArmySpawnPoints;
}

/** True when two armies would start too close together to be a fair match. */
export function spawnPointsTooClose(a: SpawnPoint, b: SpawnPoint): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < SPAWN_MIN_SEPARATION;
}

function clampSpawnAxis(value: number): number {
  return Math.max(-SPAWN_EDGE_LIMIT, Math.min(SPAWN_EDGE_LIMIT, value));
}

function clampStartTeam(team: number): StartTeam {
  return team === 2 || team === 3 || team === 4 ? team : 1;
}
