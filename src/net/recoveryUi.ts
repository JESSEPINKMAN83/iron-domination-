import type { MultiplayerSession } from './multiplayer';
import './recoveryUi.css';

/** A failed attempt leaves this dialog open; only explicit dismissal exits it. */
export function promptToRejoin(
  roomCode: string,
  join: (signal: AbortSignal) => Promise<MultiplayerSession>,
  forget: () => void,
): Promise<MultiplayerSession | undefined> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'multiplayer-rejoin';
    const title = document.createElement('h2'); title.textContent = 'Return to your battle?';
    const description = document.createElement('p'); description.textContent = `Your multiplayer game in room ${roomCode} may still be running. Rejoin as the same player and recover the current battlefield.`;
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.className = 'multiplayer-rejoin__status';
    const actions = document.createElement('div'); actions.className = 'multiplayer-rejoin__actions';
    const rejoin = document.createElement('button'); rejoin.textContent = 'Rejoin game';
    const later = document.createElement('button'); later.textContent = 'Not now';
    const leave = document.createElement('button'); leave.textContent = 'Forget this game';
    let busy = false, disposed = false;
    let attempt: AbortController | undefined;
    const finish = (session?: MultiplayerSession): void => { disposed = true; if (!session) attempt?.abort(); dialog.close(); dialog.remove(); resolve(session); };
    rejoin.onclick = async () => {
      if (busy) return;
      busy = true; rejoin.disabled = true; later.textContent = 'Cancel';
      attempt = new AbortController();
      status.textContent = 'Connecting to your room…';
      try {
        const session = await join(attempt.signal);
        if (!disposed) finish(session);
      } catch {
        if (disposed) return;
        status.textContent = 'Could not reconnect yet. Your place is saved. Check the connection and retry; if the host has left or the room expired, it may no longer be available.';
        rejoin.textContent = 'Retry rejoining';
      } finally {
        busy = false; rejoin.disabled = false; later.textContent = 'Not now';
      }
    };
    later.onclick = () => finish();
    leave.onclick = () => { forget(); finish(); };
    dialog.oncancel = event => { event.preventDefault(); finish(); };
    actions.append(rejoin, later, leave); dialog.append(title, description, status, actions); document.body.append(dialog); dialog.showModal();
  });
}

/** Independent of the simulation/render pause: recovery buttons always respond. */
export function createConnectionRecovery(retry: () => void, home: () => void): { update: (message: string, paused: boolean) => void } {
  const panel = document.createElement('section'); panel.className = 'multiplayer-recovery'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Multiplayer connection recovery');
  const title = document.createElement('strong'); title.textContent = 'Connection interrupted · battle paused';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const hint = document.createElement('p'); hint.textContent = 'Reconnecting automatically. Your game stays paused while players synchronize.';
  const retryButton = document.createElement('button'); retryButton.textContent = 'Retry connection'; retryButton.onclick = () => retry();
  const homeButton = document.createElement('button'); homeButton.textContent = 'Home · rejoin later'; homeButton.onclick = home;
  panel.append(title, status, hint, retryButton, homeButton); document.body.append(panel);
  return { update: (message, paused) => {
    status.textContent = message; panel.hidden = !paused;
    const ended = /room closed|room expired|reconnect period expired/i.test(message);
    retryButton.disabled = ended;
    hint.textContent = ended ? 'The room is unavailable. Return home to check your saved game or start another battle.' : /could not recover/i.test(message) ? 'Automatic retry paused. Retry the connection or return home to rejoin your saved game.' : 'Reconnecting automatically. Your game stays paused while players synchronize.';
  } };
}
