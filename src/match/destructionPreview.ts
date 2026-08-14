import type { Entity } from '../sim/components';

export const DESTRUCTION_PREVIEW_QUERY = 'destruction-preview';

export const DESTRUCTION_STAGES = [
  'Intact',
  'Scorch',
  'Cracks',
  'Smoke',
  'Panel loss',
  'Breach',
  'Open hole',
  'Fire',
  'Corner lean',
  'Ruin',
  'Collapse',
] as const;

export interface DestructionPreviewScene {
  units: Entity[];
  targets: Entity[];
  focus: { x: number; z: number };
  forward: { x: number; z: number };
  right: { x: number; z: number };
}

export function isDestructionPreviewQuery(params: URLSearchParams): boolean {
  const value = params.get(DESTRUCTION_PREVIEW_QUERY);
  return value === '1' || value === 'auto';
}

export function destructionStageFromHealth(current: number, max: number, destroyed: boolean): { level: number; label: string } {
  if (destroyed || current <= 0) return { level: 10, label: DESTRUCTION_STAGES[10] };
  if (max <= 0) return { level: 0, label: DESTRUCTION_STAGES[0] };
  const level = Math.max(0, Math.min(10, Math.ceil(10 * (1 - current / max))));
  return { level, label: DESTRUCTION_STAGES[level] ?? DESTRUCTION_STAGES[0] };
}

export function nextLivingBuilding(targets: readonly Entity[], current?: Entity): Entity | undefined {
  const living = targets.filter((entity) => entity.building && !entity.destroyed && (entity.health?.current ?? 0) > 0);
  if (living.length === 0) return undefined;
  if (!current) return living[0];
  if (living.includes(current)) return current;
  const order = targets.filter((entity) => living.includes(entity));
  const previousIndex = targets.indexOf(current);
  return order.find((entity) => targets.indexOf(entity) > previousIndex) ?? order[0];
}

export function livingPreviewAttackers(units: readonly Entity[]): Entity[] {
  return units.filter((entity) => !entity.destroyed && entity.mover && (entity.weapon || entity.weapons));
}

export interface DestructionPreviewDriver {
  simTick(tick: number): void;
  update(): void;
}

export function createDestructionPreviewPanel(
  scene: DestructionPreviewScene,
  options: {
    attack: (units: Entity[], target: Entity) => void;
    focus: (target: Entity) => void;
    select: (units: Entity[]) => void;
  },
): DestructionPreviewDriver {
  let auto = true;
  let target = nextLivingBuilding(scene.targets);
  let lastIssueTick = -999;
  if (target) {
    options.select(livingPreviewAttackers(scene.units));
    options.focus(target);
  }

  const panel = document.createElement('aside');
  panel.className = 'durability-lab';
  panel.setAttribute('aria-label', 'Building destruction preview controls');
  panel.innerHTML = `
    <header class="durability-lab__header">
      <div class="durability-lab__eyebrow">LOCAL QA RANGE · LIVE MISSILES</div>
      <h2>BUILDING DESTRUCTION</h2>
      <p>Tanks keep firing the selected building from one face so you can watch scorch, holes, fire, then collapse.</p>
    </header>
  `;

  const controls = document.createElement('div');
  controls.className = 'durability-lab__controls';
  const autoButton = document.createElement('button');
  autoButton.type = 'button';
  autoButton.textContent = 'AUTO FIRE';
  autoButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    auto = !auto;
    if (auto && target) options.attack(livingPreviewAttackers(scene.units), target);
    update();
  };
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.textContent = 'NEXT BUILDING';
  nextButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const living = scene.targets.filter((entity) => entity.building && !entity.destroyed && (entity.health?.current ?? 0) > 0);
    if (living.length === 0) return;
    const index = target ? living.indexOf(target) : -1;
    target = living[(index + 1) % living.length];
    options.focus(target);
    options.attack(livingPreviewAttackers(scene.units), target);
    update();
  };
  controls.append(autoButton, nextButton);
  panel.appendChild(controls);

  const status = document.createElement('div');
  status.className = 'durability-lab__stage';
  panel.appendChild(status);

  const targets = document.createElement('div');
  targets.className = 'durability-lab__targets';
  const targetRows = scene.targets.map((candidate) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'durability-lab__target';
    const name = document.createElement('span');
    name.className = 'durability-lab__target-name';
    name.textContent = candidate.building?.label ?? candidate.name ?? 'Building';
    const hp = document.createElement('span');
    hp.className = 'durability-lab__target-hp';
    const bar = document.createElement('span');
    bar.className = 'durability-lab__bar';
    const fill = document.createElement('span');
    fill.className = 'durability-lab__bar-fill';
    bar.appendChild(fill);
    const estimate = document.createElement('span');
    estimate.className = 'durability-lab__estimate';
    row.append(name, hp, bar, estimate);
    row.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (candidate.destroyed || (candidate.health?.current ?? 0) <= 0) return;
      target = candidate;
      options.focus(candidate);
      options.attack(livingPreviewAttackers(scene.units), candidate);
      update();
    };
    targets.appendChild(row);
    return { candidate, row, hp, fill, estimate };
  });
  panel.appendChild(targets);

  const footer = document.createElement('footer');
  footer.className = 'durability-lab__footer';
  const hint = document.createElement('span');
  hint.textContent = 'Watch the struck face. Hover a building to see its health bar.';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'durability-lab__reset';
  reset.textContent = 'RESET RANGE';
  reset.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    location.reload();
  };
  footer.append(hint, reset);
  panel.appendChild(footer);
  panel.onpointerdown = (event) => event.stopPropagation();
  panel.onwheel = (event) => event.stopPropagation();
  document.body.appendChild(panel);

  const issueAttack = (tick: number): void => {
    const attackers = livingPreviewAttackers(scene.units);
    target = nextLivingBuilding(scene.targets, target);
    if (!target || attackers.length === 0) return;
    if (tick - lastIssueTick < 18) return;
    lastIssueTick = tick;
    options.select(attackers);
    options.attack(attackers, target);
  };

  const update = (): void => {
    autoButton.classList.toggle('is-active', auto);
    autoButton.textContent = auto ? 'AUTO FIRE ON' : 'AUTO FIRE OFF';
    const stage = target
      ? destructionStageFromHealth(target.health?.current ?? 0, target.health?.max ?? 1, Boolean(target.destroyed))
      : undefined;
    status.textContent = target
      ? `${target.building?.label ?? target.name ?? 'Building'} · L${stage?.level} ${stage?.label?.toUpperCase()}`
      : 'Range clear — reset to watch it again';
    for (const item of targetRows) {
      const health = item.candidate.health;
      const current = Math.max(0, Math.ceil(health?.current ?? 0));
      const max = Math.max(1, Math.ceil(health?.max ?? 1));
      const destroyed = Boolean(item.candidate.destroyed) || current <= 0;
      const rowStage = destructionStageFromHealth(current, max, destroyed);
      item.row.classList.toggle('is-destroyed', destroyed);
      item.row.classList.toggle('is-active', item.candidate === target);
      item.hp.textContent = destroyed ? 'DESTROYED' : `${current} / ${max} HP`;
      item.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, current / max))})`;
      item.estimate.textContent = destroyed ? 'Rubble mound until despawn' : `Visual stage L${rowStage.level} · ${rowStage.label}`;
    }
  };

  const simTick = (tick: number): void => {
    if (auto) issueAttack(tick);
    update();
  };

  update();
  return { simTick, update };
}
