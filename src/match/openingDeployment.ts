export interface OpeningFormationBasis {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
}

export interface OpeningDeploymentObstacle {
  x: number;
  z: number;
  radius: number;
}

export function openingFormationBasis(team: number): OpeningFormationBasis {
  const sx = team === 2 || team === 3 ? -1 : 1;
  const sz = team === 2 || team === 4 ? -1 : 1;
  const len = Math.hypot(sx, sz);
  const forwardX = sx / len;
  const forwardZ = sz / len;
  return {
    forwardX,
    forwardZ,
    rightX: forwardZ,
    rightZ: -forwardX,
  };
}

export function openingFormationPoint(
  baseX: number,
  baseZ: number,
  basis: OpeningFormationBasis,
  side: number,
  depth: number,
): { x: number; z: number } {
  return {
    x: baseX + basis.forwardX * depth + basis.rightX * side,
    z: baseZ + basis.forwardZ * depth + basis.rightZ * side,
  };
}

export function openingStagingDepth(
  baseX: number,
  baseZ: number,
  basis: OpeningFormationBasis,
  obstacles: OpeningDeploymentObstacle[],
  minimumDepth = 29,
  clearance = 9,
): number {
  let depth = minimumDepth;
  for (const obstacle of obstacles) {
    const dx = obstacle.x - baseX;
    const dz = obstacle.z - baseZ;
    const forwardEdge = dx * basis.forwardX + dz * basis.forwardZ + Math.max(0, obstacle.radius);
    depth = Math.max(depth, forwardEdge + clearance);
  }
  return depth;
}
