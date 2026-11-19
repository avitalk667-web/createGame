import { signal } from '@angular/core';

/**
 * A short memory of the admin area's answers, so that going back to a tab within a minute shows what was just read
 * instead of asking the database again (each visit to the dashboard used to read the whole history).
 *
 * Rules, so the admin never sees old data after doing something:
 * - only reads (GET) are kept, for at most ADMIN_CACHE_TTL_MS, and only a call made through `cached()` (entering a tab)
 *   may be answered from here; the refresh button, the filters and every other call always ask the server;
 * - any change (POST, PUT, DELETE) from any admin screen forgets everything, whatever its outcome, and an answer
 *   that was still on its way when a change was made is not kept.
 * It lives in the page's memory only: a reload of the page starts empty.
 */
export const ADMIN_CACHE_TTL_MS = 60_000;

const store = new Map<string, { at: number; data: unknown }>();
let generation = 0;

/** When the data now on the screen was read from the server (the newest answer shown, kept or new). */
export const adminDataAt = signal<number | null>(null);

export const adminCache = {
  /** Forgets every kept answer (after a change, or when the admin asks to refresh). */
  clear() {
    store.clear();
    generation++;
  },

  /** Runs one admin call through the cache rules above. */
  async through<T>(method: string, url: string, preferCache: boolean, send: () => Promise<T>): Promise<T> {
    if (method !== 'GET') {
      try {
        return await send();
      } finally {
        adminCache.clear();
      }
    }
    const kept = store.get(url);
    if (preferCache && kept && Date.now() - kept.at <= ADMIN_CACHE_TTL_MS) {
      adminDataAt.set(kept.at);
      // a copy, so that a screen changing what it shows can never change the kept answer
      return structuredClone(kept.data) as T;
    }
    const started = generation;
    const data = await send();
    const at = Date.now();
    if (started === generation) store.set(url, { at, data: structuredClone(data) });
    adminDataAt.set(at);
    return data;
  },
};

/** A view of an admin API whose reads may come from the last minute (used only when a tab is entered). */
export function cachedView<T extends object>(api: T): T {
  const view = Object.create(api) as T & { preferCache: boolean };
  view.preferCache = true;
  return view;
}
