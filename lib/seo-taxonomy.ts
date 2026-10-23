// SEO taxonomy for the /grants landing pages: category rules, slugs, thresholds and URL rules.
// Pages, the sitemap and tests all read from this one module (spec §1.3, §2.2–2.4).
// Pure module, relative imports only, so tests can transpile it.
import { STATES } from './source-parsers';
import type { Grant } from './grants';

/** A page needs at least this many open listings that are specific to it. */
export const SEO_THRESHOLD = 3;
/** A page whose listing set overlaps a higher-priority page this much (Jaccard) is not generated. */
export const SEO_JACCARD_CUTOFF = 0.75;
/** Pages render at most this many listings. */
export const SEO_MAX_ITEMS = 100;
/** State pages show this many nationwide items in "Also open nationwide". */
export const SEO_NATIONWIDE_SAMPLE = 10;
/** The hub shows this many soonest deadlines. */
export const SEO_HUB_SOONEST = 20;
/**
 * Pages that qualify by the rules but stay noindex until a person reviews them.
 * louisiana/science-research: its matches come from CareerOneStop search-keyword tags (spec §7).
 */
export const SEO_REVIEW_HOLD: ReadonlySet<string> = new Set(['/grants/louisiana/science-research']);

type GrantLike = Pick<Grant, 'id' | 'title' | 'kind' | 'types' | 'tags' | 'studyLevels'>;

export type SeoCategory = {
  slug: string;
  label: string;
  /** Used where the label is not a plural noun ("Women" → "listings for women"). */
  noun: string;
  /** Prefill for the profile editor when a visitor saves a profile from this page. */
  profileType: 'Student' | 'Individual' | 'Freelancer' | 'Small business' | 'Nonprofit' | null;
  keywords: string;
  rule: (g: GrantLike) => boolean;
};

const tagText = (g: GrantLike) => (g.tags || []).join(' ').toLowerCase();
const levels = (g: GrantLike) => g.studyLevels || [];
const types = (g: GrantLike) => g.types || [];

/** Listed in priority order, highest first (spec §2.2 rule 3). */
export const SEO_CATEGORIES: readonly SeoCategory[] = [
  { slug: 'scholarships', label: 'Scholarships', noun: 'scholarships', profileType: 'Student', keywords: 'scholarship', rule: g => g.kind === 'Scholarship' },
  { slug: 'small-business', label: 'Small business grants', noun: 'small business grants', profileType: 'Small business', keywords: 'small business',
    rule: g => g.kind === 'Business grant' || (g.kind === 'Microgrant' && types(g).includes('Small business')) || /^(chamber|nase|amber)/.test(g.id) || /^state-..-business-/.test(g.id) || (g.kind === 'Private grant' && /\b(business|entrepreneurship|startup)\b/.test(tagText(g))) },
  { slug: 'arts-writing', label: 'Arts & writing grants', noun: 'arts & writing grants', profileType: 'Individual', keywords: 'arts, writing',
    rule: g => /\b(creative|writing|literature|poetry|fiction|arts?|nonfiction|translation)\b/.test(tagText(g)) || /^state-..-arts-/.test(g.id) },
  { slug: 'nonprofit', label: 'Grants for nonprofits', noun: 'grants for nonprofits', profileType: 'Nonprofit', keywords: '', rule: g => types(g).includes('Nonprofit') },
  { slug: 'science-research', label: 'Science & research', noun: 'science & research listings', profileType: null, keywords: 'science, research',
    rule: g => /\b(science|engineering|research and development|technology)\b/.test(tagText(g)) },
  { slug: 'student-aid', label: 'Student aid', noun: 'student aid listings', profileType: 'Student', keywords: '', rule: g => g.kind === 'Student aid' },
  { slug: 'graduate', label: 'Graduate & doctoral', noun: 'graduate & doctoral listings', profileType: 'Student', keywords: '', rule: g => levels(g).some(l => l === 'Graduate' || l === 'Doctoral') },
  { slug: 'undergraduate', label: 'Undergraduate', noun: 'undergraduate listings', profileType: 'Student', keywords: '', rule: g => levels(g).includes('Undergraduate') },
  { slug: 'high-school', label: 'High school students', noun: 'listings for high school students', profileType: 'Student', keywords: '', rule: g => levels(g).includes('High school') },
  { slug: 'vocational', label: 'Vocational & certificate', noun: 'vocational & certificate listings', profileType: 'Student', keywords: '', rule: g => levels(g).includes('Vocational / certificate') },
  { slug: 'health', label: 'Health & nursing', noun: 'health & nursing listings', profileType: null, keywords: 'health, nursing', rule: g => /\b(health|nursing|food and nutrition)\b/.test(tagText(g)) },
  { slug: 'women', label: 'Women', noun: 'listings for women', profileType: null, keywords: 'women', rule: g => /\bwomen\b/.test(tagText(g)) || /\bwomen\b/i.test(g.title || '') },
  { slug: 'fellowships', label: 'Fellowships', noun: 'fellowships', profileType: 'Individual', keywords: 'fellowship', rule: g => g.kind === 'Fellowship' },
  { slug: 'federal', label: 'Federal grants', noun: 'federal grants', profileType: 'Nonprofit', keywords: '', rule: g => g.kind === 'Federal grant' },
  { slug: 'awards-competitions', label: 'Awards & competitions', noun: 'awards & competitions', profileType: 'Individual', keywords: 'award', rule: g => g.kind === 'Award / competition' },
];

export const CATEGORY_BY_SLUG: ReadonlyMap<string, SeoCategory> = new Map(SEO_CATEGORIES.map(c => [c.slug, c]));

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** 50 states + DC, keyed by slug ("new-york"). */
export const STATE_BY_SLUG: ReadonlyMap<string, { name: string; code: string }> = new Map(
  Object.entries(STATES).map(([code, name]) => [slugify(name), { name, code }]),
);
const STATE_SLUG_BY_CODE = new Map(Object.entries(STATES).map(([code, name]) => [code.toLowerCase(), slugify(name)]));

export function stateSlug(name: string): string { return slugify(name); }

export function categoriesFor(g: GrantLike): string[] {
  return SEO_CATEGORIES.filter(c => c.rule(g)).map(c => c.slug);
}

export const seoPath = {
  hub: () => '/grants',
  state: (state: string) => `/grants/${state}`,
  category: (category: string) => `/grants/${category}`,
  stateCategory: (state: string, category: string) => `/grants/${state}/${category}`,
};

export type SeoRoute =
  | { type: 'state'; state: string; stateName: string }
  | { type: 'category'; category: string }
  | { type: 'stateCategory'; state: string; stateName: string; category: string };

/** Resolves /grants/<a>[/<b>] against known slugs only. Unknown slugs → null (404). */
export function resolveSeoRoute(segments: string[]): SeoRoute | null {
  if (segments.length === 1) {
    const [a] = segments;
    const st = STATE_BY_SLUG.get(a);
    if (st) return { type: 'state', state: a, stateName: st.name };
    if (CATEGORY_BY_SLUG.has(a)) return { type: 'category', category: a };
    return null;
  }
  if (segments.length === 2) {
    const [a, b] = segments;
    const st = STATE_BY_SLUG.get(a);
    if (st && CATEGORY_BY_SLUG.has(b)) return { type: 'stateCategory', state: a, stateName: st.name, category: b };
  }
  return null;
}

/**
 * Uppercase segments or 2-letter state codes (/grants/NY, /grants/ny, /grants/Louisiana/Graduate)
 * get a 301 to the canonical lowercase slug. Returns null when no redirect applies.
 */
export function seoCanonicalRedirect(pathname: string): string | null {
  const m = /^\/grants\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return null;
  const parts = [m[1], m[2]].filter(Boolean) as string[];
  let fixed = parts.map(p => { try { return decodeURIComponent(p).toLowerCase(); } catch { return p.toLowerCase(); } });
  if (STATE_SLUG_BY_CODE.has(fixed[0]) && !CATEGORY_BY_SLUG.has(fixed[0])) fixed = [STATE_SLUG_BY_CODE.get(fixed[0])!, ...fixed.slice(1)];
  if (!resolveSeoRoute(fixed)) return null;
  const target = '/grants/' + fixed.join('/');
  return target === pathname ? null : target;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
