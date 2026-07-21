import './missionComms.css';
import type { Entity } from '../sim/components';

export interface MissionOpening {
  multiplayer: boolean;
  ai: string;
  aiStyle: string;
}

interface Transmission {
  eyebrow: string;
  title: string;
  message: string;
  audioSrc: string;
  alert?: boolean;
}

export function firstVisibleHostile(
  entities: Iterable<Entity>,
  isHostile: (team: number | undefined) => boolean,
  isVisible: (x: number, z: number) => boolean,
): Entity | undefined {
  for (const entity of entities) {
    if (entity.destroyed || !isHostile(entity.team?.id)) continue;
    if (!entity.building && !entity.selectable) continue;
    if (isVisible(entity.transform.x, entity.transform.z)) return entity;
  }
  return undefined;
}

export class MissionComms {
  private readonly root: HTMLDivElement;
  private readonly portrait: HTMLImageElement;
  private readonly eyebrow: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private readonly audio: HTMLAudioElement;
  private hideTimer?: number;
  private pendingPlayback = false;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'mission-comms';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');

    this.portrait = document.createElement('img');
    this.portrait.className = 'mission-comms__portrait';
    this.portrait.src = '/assets/comms/field-officer.png';
    this.portrait.alt = 'Field intelligence officer';
    this.portrait.onerror = () => this.root.classList.add('mission-comms--portrait-failed');

    const copy = document.createElement('div');
    copy.className = 'mission-comms__copy';
    this.eyebrow = document.createElement('div');
    this.eyebrow.className = 'mission-comms__eyebrow';
    this.title = document.createElement('div');
    this.title.className = 'mission-comms__title';
    this.message = document.createElement('div');
    this.message.className = 'mission-comms__message';
    copy.append(this.eyebrow, this.title, this.message);
    this.root.append(this.portrait, copy);
    parent.appendChild(this.root);

    this.audio = document.createElement('audio');
    this.audio.hidden = true;
    this.audio.preload = 'auto';
    this.audio.addEventListener('playing', () => {
      this.pendingPlayback = false;
      this.scheduleHide(Number.isFinite(this.audio.duration) ? this.audio.duration * 1_000 + 500 : 45_000);
    });
    this.audio.addEventListener('ended', () => this.scheduleHide(350));
    this.audio.addEventListener('error', () => {
      this.pendingPlayback = false;
      this.scheduleHide(8_000);
    });
    this.root.appendChild(this.audio);

    const retry = () => this.retryPendingPlayback();
    window.addEventListener('pointerdown', retry, { passive: true });
    window.addEventListener('keydown', retry, { passive: true });
  }

  announceOpening(opening: MissionOpening): void {
    const detail = opening.multiplayer
      ? 'Command link synchronized. Establish your base, secure oil, and destroy the hostile command yard.'
      : `${opening.ai} threat profile, ${opening.aiStyle} commander. Establish power and production before advancing.`;
    this.announce({
      eyebrow: opening.multiplayer ? 'SECURE COMMAND CHANNEL' : 'FIELD COMMAND',
      title: 'MISSION ONLINE',
      message: detail,
      audioSrc: '/assets/comms/mission-online.mp3',
    });
  }

  announceFirstContact(entity: Entity): void {
    const type = contactType(entity);
    this.announce({
      eyebrow: 'TACTICAL INTELLIGENCE',
      title: 'ENEMY CONTACT',
      message: `${type} detected inside allied visual range. Weapons free.`,
      audioSrc: '/assets/comms/enemy-contact.mp3',
      alert: true,
    });
  }

  private announce(transmission: Transmission): void {
    if (this.hideTimer !== undefined) window.clearTimeout(this.hideTimer);
    this.eyebrow.textContent = transmission.eyebrow;
    this.title.textContent = transmission.title;
    this.message.textContent = transmission.message;
    this.root.classList.toggle('mission-comms--alert', transmission.alert === true);
    this.root.classList.remove('mission-comms--visible');
    requestAnimationFrame(() => this.root.classList.add('mission-comms--visible'));

    this.audio.pause();
    this.audio.src = transmission.audioSrc;
    this.audio.currentTime = 0;
    this.pendingPlayback = true;
    this.scheduleHide(45_000);
    void this.audio.play().catch(() => {
      this.pendingPlayback = true;
    });
  }

  private scheduleHide(delay: number): void {
    if (this.hideTimer !== undefined) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.root.classList.remove('mission-comms--visible'), delay);
  }

  private retryPendingPlayback(): void {
    if (!this.pendingPlayback || !this.audio.paused) return;
    void this.audio.play().catch(() => {
      this.pendingPlayback = true;
    });
  }
}

function contactType(entity: Entity): string {
  if (entity.building) return 'Enemy structure';
  if (entity.flight) return 'Hostile aircraft';
  if (entity.selectable?.type === 'tank') return 'Hostile armor';
  return 'Enemy infantry';
}
