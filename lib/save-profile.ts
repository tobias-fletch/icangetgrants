// "Save your profile" hand-off (spec §5.2). Pure helpers shared by the dashboard and tests.
// A guest's temporary beta-search profile survives the sign-in redirect in sessionStorage (same-origin, no cookie)
// and is cleared after use. Nothing here saves anything: the user still has to press "Save profile".
import type { Profile } from './grants';
import { CATEGORY_BY_SLUG } from './seo-taxonomy';
import { STATES } from './source-parsers';

export const BETA_PROFILE_STORAGE_KEY = 'icgg:beta-profile';
const TYPES = ['Small business', 'Freelancer', 'Student', 'Individual', 'Nonprofit'];
const LEVEL_BY_CATEGORY: Record<string, string> = { graduate: 'Graduate', undergraduate: 'Undergraduate', 'high-school': 'High school', vocational: 'Vocational / certificate' };
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const stateName = (v: string) => {
  const t = v.trim().toLowerCase();
  const hit = Object.entries(STATES).find(([code, name]) => code.toLowerCase() === t || name.toLowerCase() === t);
  return hit ? hit[1] : '';
};

/** "/?save=1&state=…&type=…&cat=…" for the home-page CTA, built from the guest's beta search. */
export function homeSaveReturn(beta: Pick<Profile, 'state' | 'type'> | null): string {
  const q = new URLSearchParams({ save: '1' });
  const st = beta ? stateName(beta.state || '') : '';
  if (st) q.set('state', st);
  if (beta && TYPES.includes(beta.type)) q.set('type', beta.type);
  return '/?' + q.toString();
}

/**
 * Editor prefill after sign-in. Starts from `base` (an empty profile), applies the query (state/type/cat),
 * then a stored beta-search profile if there is one. Always country United States and alerts on.
 * Returns null when the URL is not a save hand-off.
 */
export function saveProfilePrefill(search: string, stored: string | null, base: Profile): Profile | null {
  const q = new URLSearchParams(search);
  if (q.get('save') !== '1') return null;
  const p: Profile = { ...base, id: '', country: 'United States', alerts: true };
  const st = stateName(q.get('state') || '');
  if (st) p.state = st;
  const type = q.get('type') || '';
  if (TYPES.includes(type)) p.type = type;
  const cat = CATEGORY_BY_SLUG.get(q.get('cat') || '');
  if (cat?.keywords) p.keywords = cat.keywords;
  if (cat && LEVEL_BY_CATEGORY[cat.slug]) { p.type = 'Student'; p.education = LEVEL_BY_CATEGORY[cat.slug]; }
  if (stored) {
    try {
      const b = JSON.parse(stored);
      const bState = stateName(clean(b?.state, 100));
      if (bState) p.state = bState;
      if (TYPES.includes(b?.type)) p.type = b.type;
      const kw = clean(b?.keywords, 500);
      if (kw) p.keywords = kw;
      const edu = clean(b?.education, 60);
      if (edu) p.education = edu;
    } catch { /* ignore a corrupt value */ }
  }
  if (!p.name) p.name = [p.state, p.type].filter(Boolean).join(' ') + ' profile';
  return p;
}
