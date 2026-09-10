"use client";
// ── WHAT YOU HAVE ALREADY PUT IN THE TROLLEY. Local, and local ON PURPOSE.
//
// Ticking an item off happens in an aisle, which is where signal is worst — so this must work
// with the radio off, with no request, and survive the tab being killed while the phone is in a
// pocket. `localStorage` is written synchronously and read synchronously; there is no state here
// that can be "syncing".
//
// ── THERE IS NOTHING TO SYNC TO, AND THAT IS A DELIBERATE ANSWER, not an omission.
//
// The brief asks for "syncs when connection returns". Measured: `GroceryList` and
// `GroceryListItem` are declared in the schema and written by NOTHING — the only writer is the
// Postgres migration. Lists live in the browser, and `/confidentialitate` says so in as many
// words: "Nu le trimitem nicăieri și nu avem o copie."
//
// So there is no server-side list for a tick to sync WITH. Building a sync would mean building
// server-side lists first, which would make a published privacy claim false — see the note on
// `GroceryList` in schema.prisma. The honest implementation of "works offline and syncs later"
// for data that never leaves the device is: it works offline, and there is nothing to send.
//
// If server-side lists are ever built, this is the module that gains a queue, and the privacy
// policy changes in the same commit.

export type TickState = Record<string, number>; // slug -> ticked-at epoch ms

const KEY = "cosmic_ticked_v1";
export const TICK_EVENT = "cosmic-ticked";

/** Ticks older than this belong to a previous shopping trip and are cleared on read. */
export const TRIP_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function read(): TickState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    return typeof v === "object" && v !== null ? (v as TickState) : {};
  } catch {
    return {};
  }
}

function write(v: TickState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* a full or disabled store must not break the aisle */
  }
  window.dispatchEvent(new Event(TICK_EVENT));
}

/**
 * Everything still ticked from THIS trip.
 *
 * A tick from yesterday is not a fact about today's shopping. Expiring on read rather than on a
 * timer means the state is correct the moment it is looked at, with no background work and no
 * dependency on the tab having been open.
 */
export function getTicked(now = Date.now()): TickState {
  const all = read();
  const fresh: TickState = {};
  let changed = false;
  for (const [slug, at] of Object.entries(all)) {
    if (now - at < TRIP_MAX_AGE_MS) fresh[slug] = at;
    else changed = true;
  }
  if (changed) write(fresh);
  return fresh;
}

export function isTicked(slug: string, state?: TickState): boolean {
  return (state ?? getTicked())[slug] !== undefined;
}

export function toggleTick(slug: string, now = Date.now()): void {
  const s = getTicked(now);
  if (s[slug] === undefined) s[slug] = now;
  else delete s[slug];
  write(s);
}

/** Start of a new trip. */
export function clearTicks(): void {
  write({});
}
