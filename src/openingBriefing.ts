const OPENING_BRIEFING_STORAGE_KEY = 'iron-dominion.opening-briefing-seen.v1';

type BriefingStorage = Pick<Storage, 'getItem' | 'setItem'>;

function memberStorageKey(memberId: string): string {
  return `${OPENING_BRIEFING_STORAGE_KEY}.${encodeURIComponent(memberId)}`;
}

function viewerStorageKey(memberId?: string): string {
  return memberId
    ? memberStorageKey(memberId)
    : `${OPENING_BRIEFING_STORAGE_KEY}.anonymous-device`;
}

/** Every member, or the anonymous browser itself, receives the intro once. */
export function shouldShowOpeningBriefing(
  storage: BriefingStorage,
  memberId?: string,
): boolean {
  try {
    return storage.getItem(viewerStorageKey(memberId)) !== '1';
  } catch {
    return true;
  }
}

/** Persist the intro for an identified member or once for this anonymous device. */
export function markOpeningBriefingSeen(
  storage: BriefingStorage,
  memberId?: string,
): void {
  try {
    storage.setItem(viewerStorageKey(memberId), '1');
  } catch {
    // Storage may be disabled; failing open is safer than blocking the match.
  }
}
