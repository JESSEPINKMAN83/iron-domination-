export type TacticalFormationKind = 'staggered-column' | 'wedge' | 'battle-line';
export type FormationPreset = 'tight' | 'spread' | 'wedge';

/** Stable slots shared by every leg, so aircraft never converge on one waypoint. */
export function presetFormationOffsets(count: number, spacing: number, preset: FormationPreset): FormationOffset[] {
  const unitCount = Math.max(0, Math.floor(count));
  const safeSpacing = Math.max(1, spacing);
  // Even Tight has breathing room. Spread is a broad, staggered screen;
  // Wedge has a clear point and swept-back wings rather than another grid.
  const gap = safeSpacing * (preset === 'tight' ? 1.6 : preset === 'spread' ? 2.8 : 1.9);
  const desiredColumns = preset === 'tight'
    ? Math.max(1, Math.ceil(Math.sqrt(unitCount) * 0.75))
    : Math.max(1, Math.ceil(Math.sqrt(unitCount) * 1.7));
  const columns = preset === 'spread'
    ? Math.max(1, Math.ceil(unitCount / Math.max(1, Math.ceil(unitCount / desiredColumns))))
    : desiredColumns;
  const wingLength = Math.max(1, Math.ceil(Math.sqrt(unitCount)));
  const chevronSize = wingLength * 2 + 1;
  const offsets = Array.from({ length: unitCount }, (_, i) => {
    if (preset === 'wedge') {
      const wingIndex = i % chevronSize;
      const rank = Math.ceil(wingIndex / 2);
      const side = wingIndex === 0 ? 0 : wingIndex % 2 ? -1 : 1;
      const wave = Math.floor(i / chevronSize);
      return { x: rank * side * gap, z: (rank * 0.9 + wave * 2.4) * gap };
    }
    const row = Math.floor(i / columns);
    const col = i % columns;
    const rowCount = Math.min(columns, unitCount - row * columns);
    return {
      x: (col - (rowCount - 1) / 2 + (row % 2 ? 0.25 : -0.25)) * gap,
      z: row * gap * (preset === 'spread' ? 1.15 : 1),
    };
  });
  if (offsets.length) centerOffsets(offsets);
  return offsets;
}

export interface FormationOffset {
  x: number;
  z: number;
}

export interface TacticalFormationLayout {
  kind: TacticalFormationKind;
  offsets: FormationOffset[];
  columns: number;
  rows: number;
  spacing: number;
  width: number;
  depth: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Builds a local-space combat formation. Positive Z is behind the facing direction.
 * A short drag produces a compact staggered column, a medium drag a wedge, and a
 * long drag a shallow multi-rank battle line.
 */
export function tacticalFormationLayout(
  count: number,
  baseSpacing: number,
  requestedSpread: number,
): TacticalFormationLayout {
  const unitCount = Math.max(1, Math.floor(count));
  const safeSpacing = Math.max(1, baseSpacing);
  if (unitCount === 1) {
    return {
      kind: 'staggered-column',
      offsets: [{ x: 0, z: 0 }],
      columns: 1,
      rows: 1,
      spacing: safeSpacing,
      width: 0,
      depth: 0,
    };
  }

  const minimumColumns = unitCount <= 3 ? Math.min(2, unitCount) : 2;
  // Larger groups retain at least two ranks even at maximum spread. This keeps
  // the order readable and avoids recreating the old single-file-wide line.
  const maximumColumns = unitCount <= 4
    ? unitCount
    : Math.min(unitCount - 1, Math.max(3, Math.ceil(unitCount * 0.65)));
  const spread = Math.max(safeSpacing * 1.25, requestedSpread);
  const desiredColumns = Math.ceil(spread / (safeSpacing * 1.3)) + 1;
  const columns = clamp(desiredColumns, minimumColumns, maximumColumns);
  const compactLimit = Math.max(2, Math.floor(Math.sqrt(unitCount) * 0.72));
  const kind: TacticalFormationKind = columns <= compactLimit
    ? 'staggered-column'
    : columns >= maximumColumns
      ? 'battle-line'
      : 'wedge';
  const spacing = clamp(spread / Math.max(1, columns - 1), safeSpacing, safeSpacing * 2.4);
  const offsets = kind === 'wedge'
    ? wedgeOffsets(unitCount, columns, spacing)
    : rankedOffsets(unitCount, columns, spacing, safeSpacing, kind === 'staggered-column');
  centerOffsets(offsets);

  const xs = offsets.map((offset) => offset.x);
  const zs = offsets.map((offset) => offset.z);
  const width = Math.max(...xs) - Math.min(...xs);
  const depth = Math.max(...zs) - Math.min(...zs);
  return {
    kind,
    offsets,
    columns,
    rows: distinctRows(offsets),
    spacing,
    width,
    depth,
  };
}

export function rotateFormationOffset(offset: FormationOffset, faceYaw: number): FormationOffset {
  const rightX = Math.cos(faceYaw);
  const rightZ = -Math.sin(faceYaw);
  const backX = -Math.sin(faceYaw);
  const backZ = -Math.cos(faceYaw);
  return {
    x: rightX * offset.x + backX * offset.z,
    z: rightZ * offset.x + backZ * offset.z,
  };
}

function rankedOffsets(count: number, columns: number, spacing: number, baseSpacing: number, staggered: boolean): FormationOffset[] {
  const offsets: FormationOffset[] = [];
  const depthSpacing = staggered ? spacing * 1.06 : baseSpacing * 1.05;
  const rows = Math.ceil(count / columns);
  for (let row = 0; row < rows; row++) {
    const rowCount = Math.min(columns, count - offsets.length);
    const stagger = staggered && rows > 1 ? (row % 2 === 0 ? -0.18 : 0.18) * spacing : 0;
    for (let col = 0; col < rowCount; col++) {
      offsets.push({
        x: (col - (rowCount - 1) / 2) * spacing + stagger,
        z: row * depthSpacing,
      });
    }
  }
  return offsets;
}

function wedgeOffsets(count: number, columns: number, spacing: number): FormationOffset[] {
  const offsets: FormationOffset[] = [];
  let row = 0;
  while (offsets.length < count) {
    const desiredInRow = Math.min(columns, row * 2 + 1);
    const rowCount = Math.min(desiredInRow, count - offsets.length);
    for (let col = 0; col < rowCount; col++) {
      offsets.push({
        x: (col - (rowCount - 1) / 2) * spacing,
        z: row * spacing,
      });
    }
    row++;
  }
  return offsets;
}

function centerOffsets(offsets: FormationOffset[]): void {
  const centerX = offsets.reduce((sum, offset) => sum + offset.x, 0) / offsets.length;
  const centerZ = offsets.reduce((sum, offset) => sum + offset.z, 0) / offsets.length;
  for (const offset of offsets) {
    offset.x -= centerX;
    offset.z -= centerZ;
  }
}

function distinctRows(offsets: FormationOffset[]): number {
  return new Set(offsets.map((offset) => offset.z.toFixed(4))).size;
}
