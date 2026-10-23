// Merge-on-link: when a Google account that already has its own 'google:<sub>' workspace is linked to a
// ChatGPT account, its data moves into the ChatGPT workspace. Rules:
//   - profiles: ChatGPT profiles first, then Google profiles appended. Same profile id -> keep the ChatGPT one.
//     A Google profile whose content matches a ChatGPT profile (ignoring id and the monitoring toggle) is dropped
//     in favour of the ChatGPT one, and its saved items are moved onto that ChatGPT profile.
//   - saved: union keyed by profile + grant; the ChatGPT entry (status, notes) wins on overlap.
//   - seen (the "reviewed through" time): union of what was reviewed, i.e. the later valid time.
//   - anything else (preferences): the ChatGPT workspace wins where both have a value.
// Limits match PUT /api/workspace; a merge that would exceed them fails instead of silently dropping data.
import type { Profile, Saved, Workspace } from './grants';

export const MAX_PROFILES = 50;
export const MAX_SAVED = 500;
export const MAX_BYTES = 150000;

export class MergeError extends Error {
  constructor(public reason: 'too_large') { super('Merged workspace would exceed the workspace limits'); }
}

type Loose = Partial<Workspace> & Record<string, unknown>;

function normalize(w: unknown): Loose & Workspace {
  const o = w && typeof w === 'object' ? (w as Loose) : {};
  return { ...o, profiles: Array.isArray(o.profiles) ? o.profiles : [], saved: Array.isArray(o.saved) ? o.saved : [], seen: typeof o.seen === 'string' ? o.seen : '' };
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : v ?? null);

/** Content fingerprint used for "looks identical": every profile field except id and the alerts toggle. */
export function profileFingerprint(p: Profile): string {
  const fields: Record<string, unknown> = { ...p };
  delete fields.id;
  delete fields.alerts;
  return JSON.stringify(Object.keys(fields).sort().map((k) => [k, norm(fields[k])]).filter(([, v]) => v !== null && v !== ''));
}

function without(w: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const o = { ...w };
  for (const k of keys) delete o[k];
  return o;
}

function laterSeen(a: string, b: string): string {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (!Number.isFinite(tb)) return a;
  if (!Number.isFinite(ta)) return b;
  return tb > ta ? b : a;
}

export type MergeResult = { merged: Workspace; profilesAdded: number; profilesMatched: number; savedAdded: number };

/** Merge a Google workspace into a ChatGPT workspace (null = the ChatGPT account has none yet). Pure; no I/O. */
export function mergeWorkspaces(chatgpt: unknown, google: unknown): MergeResult {
  const base = normalize(chatgpt), inc = normalize(google);
  const profiles: Profile[] = [...base.profiles];
  const ids = new Set(profiles.map((p) => p.id));
  const byPrint = new Map(profiles.map((p) => [profileFingerprint(p), p.id] as const));
  const remap = new Map<string, string>();
  let profilesAdded = 0, profilesMatched = 0;
  for (const p of inc.profiles) {
    if (!p || typeof p.id !== 'string') continue;
    if (ids.has(p.id)) { profilesMatched++; continue; }
    const twin = byPrint.get(profileFingerprint(p));
    if (twin) { remap.set(p.id, twin); profilesMatched++; continue; }
    profiles.push(p); ids.add(p.id); byPrint.set(profileFingerprint(p), p.id); profilesAdded++;
  }
  const key = (s: Saved) => `${s.profileId}\u0000${s.grantId}`;
  const saved: Saved[] = [...base.saved];
  const have = new Set(saved.map(key));
  let savedAdded = 0;
  for (const s of inc.saved) {
    if (!s || typeof s !== 'object') continue;
    const moved = { ...s, profileId: remap.get(s.profileId) ?? s.profileId };
    if (have.has(key(moved))) continue;
    saved.push(moved); have.add(key(moved)); savedAdded++;
  }
  const prefs = without(inc, ['profiles', 'saved', 'seen']);
  for (const [k, v] of Object.entries(without(base, ['profiles', 'saved', 'seen']))) if (v !== undefined && v !== null) prefs[k] = v;
  const merged = { ...prefs, profiles, saved, seen: laterSeen(base.seen, inc.seen) } as Workspace;
  if (profiles.length > MAX_PROFILES || saved.length > MAX_SAVED || JSON.stringify(merged).length > MAX_BYTES) throw new MergeError('too_large');
  return { merged, profilesAdded, profilesMatched, savedAdded };
}
