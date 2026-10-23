// The precomputed "seo-index": one compact JSON row (jobs id 'seo-index') written once per catalog refresh,
// plus the pure functions that turn it into the /grants pages at request time (spec §4 rule 2).
// Pure module, relative imports only, so tests can transpile it.
import { isOpenGrant, effectiveDeadline, deadlineView, formatLastUpdatedEt, refreshFreshness } from './listing';
import { seeds, type Grant } from './grants';
import { SITE_NAME, SITE_ORIGIN } from './site';
import {
  SEO_CATEGORIES, CATEGORY_BY_SLUG, STATE_BY_SLUG, SEO_THRESHOLD, SEO_JACCARD_CUTOFF, SEO_MAX_ITEMS,
  SEO_NATIONWIDE_SAMPLE, SEO_HUB_SOONEST, SEO_REVIEW_HOLD, categoriesFor, jaccard, seoPath, stateSlug, resolveSeoRoute,
} from './seo-taxonomy';

export const SEO_INDEX_JOB_ID = 'seo-index';
export const SEO_INDEX_VERSION = 1;

export type SeoListing = {
  id: string; title: string; funder: string; url: string;
  amount: number | null; deadline: string | null; deadlineLabel?: string;
  status?: string; live?: boolean; sourceMode?: string; kind: string;
  states: string[]; nationwide: boolean; checked: string; source?: string; attribution?: string;
  cats: string[];
};
export type SeoPageType = 'state' | 'category' | 'stateCategory';
export type SeoPageStatus = 'indexable' | 'thin' | 'duplicate' | 'review';
export type SeoPageSummary = { path: string; kind: SeoPageType; state?: string; category?: string; count: number; status: SeoPageStatus; ids: string[] };
export type SeoIndex = {
  version: number;
  builtAt: string;
  refresh: { checkedAt: string } | null;
  pages: SeoPageSummary[];
  listings: Record<string, SeoListing>;
};

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à',
  acirc: 'â', oacute: 'ó', ocirc: 'ô', uacute: 'ú', iacute: 'í', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä',
  reg: '®', copy: '©', trade: '™', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…',
};
/** Decodes HTML entities once (no double decoding). Unknown named entities are left as written. */
export function decodeEntities(value: string): string {
  return (value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

const NATIONWIDE_COUNTRIES = new Set(['United States', 'Worldwide', 'Unspecified']);
/** True when the listing has no state restriction and is open across the U.S. (national, worldwide or unspecified). */
export function isNationwide(g: Pick<Grant, 'states' | 'countries'>): boolean {
  if ((g.states || []).length) return false;
  const countries = g.countries || [];
  return !countries.length || countries.some(c => NATIONWIDE_COUNTRIES.has(c));
}

const httpUrl = (u: string) => /^https?:\/\//i.test(u || '');

/** Same merge rule as allGrants(): catalog rows win over built-in seeds with the same id. */
export function mergeWithSeeds(records: Grant[]): Grant[] {
  const ids = new Set(records.map(g => g.id));
  return [...seeds.filter(g => !ids.has(g.id)), ...records];
}

export function compactListing(g: Grant): SeoListing {
  const l: SeoListing = {
    id: g.id, title: decodeEntities(g.title), funder: decodeEntities(g.funder || ''), url: g.url,
    amount: typeof g.amount === 'number' && g.amount > 0 ? g.amount : null,
    deadline: g.deadline || null, kind: g.kind, states: g.states || [], nationwide: isNationwide(g),
    checked: g.checked, cats: categoriesFor(g),
  };
  if (g.deadlineLabel) l.deadlineLabel = g.deadlineLabel;
  if (g.status) l.status = g.status;
  if (g.live != null) l.live = !!g.live;
  if (g.sourceMode) l.sourceMode = g.sourceMode;
  if (g.source) l.source = g.source;
  if (g.attribution) l.attribution = g.attribution;
  return l;
}

/** Builds the stored row. Only listings open at build time (and with an http(s) link) are kept. */
export function buildSeoIndex(grants: Grant[], refresh: { checkedAt?: string } | null, now = new Date()): SeoIndex {
  const listings: Record<string, SeoListing> = {};
  for (const g of grants) if (g && g.id && httpUrl(g.url) && isOpenGrant(g, now)) listings[g.id] = compactListing(g);
  const index: SeoIndex = {
    version: SEO_INDEX_VERSION, builtAt: now.toISOString(),
    refresh: refresh?.checkedAt ? { checkedAt: refresh.checkedAt } : null, pages: [], listings,
  };
  index.pages = [...computeSeoSite(index, now).pages.values()].map(p => ({
    path: p.path, kind: p.type, state: p.stateName, category: p.category, count: p.count, status: p.status, ids: p.ids,
  }));
  return index;
}

export function isSeoIndex(value: any): value is SeoIndex {
  return !!value && value.version === SEO_INDEX_VERSION && typeof value.builtAt === 'string' && value.listings && typeof value.listings === 'object';
}

export type SeoPage = {
  path: string; type: SeoPageType; state?: string; stateName?: string; category?: string;
  /** Open listings specific to this page (state-restricted ones for state pages). */
  ids: string[]; count: number; status: SeoPageStatus; dupOf?: string;
};
export type SeoSite = {
  now: Date; builtAt: string; refreshedAt: string | null;
  open: SeoListing[]; byId: Map<string, SeoListing>;
  pages: Map<string, SeoPage>;
  nationwideIds: string[];
};

/** Request-time view: re-applies isOpenGrant, then derives every page and its index status. */
export function computeSeoSite(index: SeoIndex, now = new Date()): SeoSite {
  const open = Object.values(index.listings).filter(l => isOpenGrant(l, now));
  const byId = new Map(open.map(l => [l.id, l]));
  const pages = new Map<string, SeoPage>();
  const catSets = new Map<string, Set<string>>();
  for (const c of SEO_CATEGORIES) catSets.set(c.slug, new Set(open.filter(l => l.cats.includes(c.slug)).map(l => l.id)));

  const kept: { slug: string; set: Set<string> }[] = [];
  for (const c of SEO_CATEGORIES) {
    const set = catSets.get(c.slug)!;
    if (!set.size) continue;
    let status: SeoPageStatus = 'indexable'; let dupOf: string | undefined;
    if (set.size < SEO_THRESHOLD) status = 'thin';
    else { const dup = kept.find(k => jaccard(k.set, set) >= SEO_JACCARD_CUTOFF); if (dup) { status = 'duplicate'; dupOf = seoPath.category(dup.slug); } }
    if (status === 'indexable') kept.push({ slug: c.slug, set });
    const path = seoPath.category(c.slug);
    pages.set(path, { path, type: 'category', category: c.slug, ids: [...set], count: set.size, status: SEO_REVIEW_HOLD.has(path) && status === 'indexable' ? 'review' : status, dupOf });
  }
  const keptSlugs = new Set(kept.map(k => k.slug));

  for (const [slug, st] of STATE_BY_SLUG) {
    const set = new Set(open.filter(l => l.states.includes(st.name)).map(l => l.id));
    if (!set.size) continue;
    const path = seoPath.state(slug);
    const stateOk = set.size >= SEO_THRESHOLD;
    pages.set(path, { path, type: 'state', state: slug, stateName: st.name, ids: [...set], count: set.size, status: !stateOk ? 'thin' : SEO_REVIEW_HOLD.has(path) ? 'review' : 'indexable' });
    for (const c of SEO_CATEGORIES) {
      const sub = new Set([...set].filter(id => catSets.get(c.slug)!.has(id)));
      if (!sub.size) continue;
      const cpath = seoPath.stateCategory(slug, c.slug);
      let status: SeoPageStatus = 'indexable'; let dupOf: string | undefined;
      if (sub.size < SEO_THRESHOLD || !stateOk || !keptSlugs.has(c.slug)) status = 'thin';
      else if (jaccard(set, sub) >= SEO_JACCARD_CUTOFF) { status = 'duplicate'; dupOf = path; }
      else if (SEO_REVIEW_HOLD.has(cpath)) status = 'review';
      pages.set(cpath, { path: cpath, type: 'stateCategory', state: slug, stateName: st.name, category: c.slug, ids: [...sub], count: sub.size, status, dupOf });
    }
  }
  const nationwideIds = open.filter(l => l.nationwide).map(l => l.id);
  return { now, builtAt: index.builtAt, refreshedAt: index.refresh?.checkedAt || null, open, byId, pages, nationwideIds };
}

export const isIndexable = (p: SeoPage | undefined | null) => !!p && p.status === 'indexable';
export function indexablePages(site: SeoSite): SeoPage[] {
  const order: Record<SeoPageType, number> = { category: 0, state: 1, stateCategory: 2 };
  const prio = new Map(SEO_CATEGORIES.map((c, i) => [c.slug, i]));
  return [...site.pages.values()].filter(isIndexable).sort((a, b) =>
    order[a.type] - order[b.type] || (a.state || '').localeCompare(b.state || '') || (a.type === 'category' ? b.count - a.count : 0) || (prio.get(a.category || '') ?? 0) - (prio.get(b.category || '') ?? 0));
}

/** Fixed deadlines soonest first, then rolling/unconfirmed, then most recently checked. */
export function sortListings(list: SeoListing[], now = new Date()): SeoListing[] {
  return [...list].sort((a, b) => {
    const da = effectiveDeadline(a.deadline, now), db = effectiveDeadline(b.deadline, now);
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return (b.checked || '').localeCompare(a.checked || '') || a.title.localeCompare(b.title);
  });
}

const ET_MONTH = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', year: 'numeric' });
const ET_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
export const monthEt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : ET_MONTH.format(d); };
export const dayEt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : ET_DAY.format(d); };
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
function listJoin(items: string[]): string { return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }

/** Display fields for one listing, using the app's existing wording. */
export function listingView(l: SeoListing, now = new Date()) {
  const dv = deadlineView(l, now);
  return {
    amount: l.amount ? 'Up to ' + money(l.amount) : 'Amount varies',
    deadline: dv.iso ? new Date(dv.iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : dv.text.replace(/^\s*·\s*/, '') || 'Check provider',
    deadlineIsFixed: !!dv.iso,
    status: l.live ? l.status || 'Live source listing' : l.status || l.sourceMode || 'Curated · verify current cycle',
    checked: l.checked ? 'Checked ' + dayEt(l.checked) : '',
  };
}

export type Crumb = { name: string; path: string };
export type SeoContent = {
  title: string; description: string; h1: string; intro: string[];
  crumbs: Crumb[]; listings: SeoListing[]; total: number;
  nationwide: { count: number; sample: SeoListing[]; link: string | null } | null;
  related: { path: string; label: string; count: number }[];
  stateCategories: { path: string; label: string; count: number }[];
  refreshedLine: string | null; stale: boolean;
  indexable: boolean; thinNote: string | null;
  ctaReturn: string; ctaLabel: string;
};

export function pageLabel(p: Pick<SeoPage, 'type' | 'stateName' | 'category'>): string {
  const cat = p.category ? CATEGORY_BY_SLUG.get(p.category)!.label : '';
  if (p.type === 'state') return p.stateName!;
  if (p.type === 'category') return cat;
  return `${cat} in ${p.stateName}`;
}

/** First candidate that fits in 60 characters (spec §3.1: drop the month first, then shorten). */
function fitTitle(...candidates: string[]) {
  return candidates.find(t => t.length <= 60) || candidates[candidates.length - 1].replace(/^(.{0,57}).*?( · .*)?$/, (_m, a: string) => a.trimEnd() + '…');
}
function fitDescription(parts: string[], required: number): string {
  const kept = [...parts];
  while (kept.join(' ').length > 155 && kept.length > required) kept.splice(required, 1);
  return kept.join(' ');
}

/** Profile-editor prefill used by "Save your profile" (return_to target after sign-in). */
export function saveProfileReturn(p: Pick<SeoPage, 'stateName' | 'category'> | null): string {
  const q = new URLSearchParams({ save: '1' });
  if (p?.stateName) q.set('state', p.stateName);
  const cat = p?.category ? CATEGORY_BY_SLUG.get(p.category) : undefined;
  if (cat?.profileType) q.set('type', cat.profileType);
  if (cat) q.set('cat', cat.slug);
  return '/?' + q.toString();
}

function topCounts(values: string[], n: number): string[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
}

function dataSentences(list: SeoListing[], now: Date): string[] {
  const today = now.toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const fixed = list.filter(l => effectiveDeadline(l.deadline, now));
  const soon = fixed.filter(l => { const d = effectiveDeadline(l.deadline, now)!; return d >= today && d <= in30; }).length;
  const confirmedOpen = list.filter(l => l.status === 'Open').length;
  const out: string[] = [];
  const rolling = list.length - fixed.length;
  out.push(!fixed.length
    ? `None of them lists a fixed deadline right now, so check dates with each provider.`
    : `${fixed.length} ${fixed.length === 1 ? 'has' : 'have'} a fixed deadline${soon ? ` (${soon} in the next 30 days)` : ''}${rolling ? `; ${rolling} ${rolling === 1 ? 'lists' : 'list'} a rolling or unconfirmed deadline` : ''}.`);
  const funders = topCounts(list.map(l => l.funder), 3);
  if (funders.length) out.push(`Funders that appear most often: ${listJoin(funders).replace(/\.$/, '')}.`);
  out.push(confirmedOpen === list.length
    ? 'Check eligibility and the current cycle on the funder\'s page before applying.'
    : `${confirmedOpen ? `Only ${confirmedOpen} ${confirmedOpen === 1 ? 'is' : 'are'} marked Open by the source; the` : 'The'} others are recurring programs or leads, so confirm the current cycle and eligibility on the funder's page before applying.`);
  return out;
}

export function seoContent(site: SeoSite, page: SeoPage): SeoContent {
  const now = site.now;
  const month = monthEt(site.refreshedAt || site.builtAt);
  const cat = page.category ? CATEGORY_BY_SLUG.get(page.category)! : undefined;
  const specific = sortListings(page.ids.map(id => site.byId.get(id)!).filter(Boolean), now);
  const N = page.count;
  const crumbs: Crumb[] = [{ name: 'Home', path: '/' }, { name: 'Grants', path: seoPath.hub() }];
  let title = '', description = '', h1 = '';
  const intro: string[] = [];
  let nationwide: SeoContent['nationwide'] = null;

  if (page.type === 'category') {
    title = fitTitle(`${cat!.label}: ${N} open listings (${month}) · ${SITE_NAME}`, `${cat!.label}: ${N} open listings · ${SITE_NAME}`, `${cat!.label}: ${N} listings · ${SITE_NAME}`, `${cat!.label} (${N}) · ${SITE_NAME}`);
    description = fitDescription([`Browse ${N} ${cat!.noun} that aren't closed, with deadlines and official links.`, 'Checked daily from public sources.', 'Free to search, no account needed.'], 1);
    h1 = cat!.label;
    const stateSpecific = specific.filter(l => l.states.length).length;
    intro.push(`We found ${N} ${cat!.noun} in the ${SITE_NAME} catalog that aren't closed${stateSpecific ? `, including ${stateSpecific} limited to residents of specific states` : ''}.`);
    crumbs.push({ name: cat!.label, path: page.path });
  } else if (page.type === 'state') {
    title = fitTitle(`${page.stateName} grants & scholarships (${N}) · ${SITE_NAME}`, `${page.stateName} grants (${N}) · ${SITE_NAME}`);
    description = fitDescription([`${N} ${page.stateName}-specific grants, scholarships and student aid leads, plus nationwide options.`, 'Deadlines and official links, checked daily.', 'Free to search.'], 1);
    h1 = `Grants and scholarships in ${page.stateName}`;
    const sources = topCounts(specific.map(l => l.source || l.funder), 2);
    intro.push(`We found ${N} ${page.stateName}-specific grants and scholarships that aren't closed${sources.length ? `, from ${listJoin(sources)}` : ''}.`);
    const nat = sortListings(site.nationwideIds.map(id => site.byId.get(id)!), now);
    nationwide = { count: nat.length, sample: nat.slice(0, SEO_NATIONWIDE_SAMPLE), link: null };
    crumbs.push({ name: page.stateName!, path: page.path });
  } else {
    const lower = cat!.label.toLowerCase();
    title = fitTitle(`${page.stateName} ${lower} (${N}) · ${SITE_NAME}`, `${page.stateName} ${lower} · ${SITE_NAME}`, `${cat!.label} in ${page.stateName} · ${SITE_NAME}`, `${page.stateName} ${cat!.slug.replace(/-/g, ' ')} · ${SITE_NAME}`);
    description = fitDescription([`${N} ${cat!.noun} for ${page.stateName} applicants, with deadlines and official source links.`, 'Updated daily.', 'Free during beta.'], 1);
    h1 = `${cat!.label} in ${page.stateName}`;
    intro.push(`We found ${N} ${cat!.noun} limited to ${page.stateName} residents that aren't closed.`);
    const nat = sortListings(site.nationwideIds.map(id => site.byId.get(id)!).filter(l => l.cats.includes(cat!.slug)), now);
    const catPage = site.pages.get(seoPath.category(cat!.slug));
    nationwide = { count: nat.length, sample: nat.slice(0, SEO_NATIONWIDE_SAMPLE), link: isIndexable(catPage) ? catPage!.path : null };
    crumbs.push({ name: page.stateName!, path: seoPath.state(page.state!) }, { name: cat!.label, path: page.path });
  }
  intro.push(...dataSentences(specific, now));

  // Related: other indexable pages that share the most listings with this one.
  const mine = new Set(page.ids);
  const related = indexablePages(site)
    .filter(p => p.path !== page.path && !(page.type === 'state' && p.type === 'stateCategory' && p.state === page.state))
    .map(p => ({ p, shared: p.ids.reduce((n, id) => n + (mine.has(id) ? 1 : 0), 0) }))
    .filter(x => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || b.p.count - a.p.count)
    .slice(0, 6)
    .map(({ p }) => ({ path: p.path, label: pageLabel(p), count: p.count }));
  const stateCategories = page.type === 'state'
    ? indexablePages(site).filter(p => p.type === 'stateCategory' && p.state === page.state).map(p => ({ path: p.path, label: CATEGORY_BY_SLUG.get(p.category!)!.label, count: p.count }))
    : [];

  const freshness = refreshFreshness(site.refreshedAt, now.getTime());
  const indexable = isIndexable(page);
  let thinNote: string | null = null;
  if (!indexable) {
    const parent = page.type === 'stateCategory' ? seoPath.state(page.state!) : seoPath.hub();
    thinNote = page.status === 'duplicate' && page.dupOf
      ? `This page overlaps heavily with ${page.dupOf}, so we point search engines there instead.`
      : page.status === 'review'
        ? 'This page is waiting for a quality review, so it is hidden from search engines for now.'
        : `There are only a few listings here right now. See ${parent} and the nationwide topic pages for more.`;
  }
  return {
    title, description, h1, intro, crumbs,
    listings: specific.slice(0, SEO_MAX_ITEMS), total: specific.length,
    nationwide, related, stateCategories,
    refreshedLine: site.refreshedAt ? `Catalog last refreshed ${formatLastUpdatedEt(site.refreshedAt)}` : null,
    stale: freshness.stale,
    indexable, thinNote,
    ctaReturn: saveProfileReturn(page),
    ctaLabel: page.stateName ? `Save a ${page.stateName} profile and get new-match alerts` : 'Save your profile and get new-match alerts',
  };
}

export type HubContent = {
  title: string; description: string; h1: string; intro: string[];
  categories: { path: string; label: string; count: number }[];
  states: { path: string; label: string; count: number }[];
  stateCategories: { path: string; label: string; count: number }[];
  soonest: SeoListing[]; openCount: number;
  refreshedLine: string | null; stale: boolean;
};
export function hubContent(site: SeoSite): HubContent {
  const pages = indexablePages(site);
  const toLink = (p: SeoPage) => ({ path: p.path, label: pageLabel(p), count: p.count });
  const soonest = sortListings(site.open.filter(l => effectiveDeadline(l.deadline, site.now)), site.now).slice(0, SEO_HUB_SOONEST);
  const categories = pages.filter(p => p.type === 'category').map(toLink);
  const states = pages.filter(p => p.type === 'state').map(toLink);
  const freshness = refreshFreshness(site.refreshedAt, site.now.getTime());
  return {
    title: `Browse grants by state and category · ${SITE_NAME}`,
    description: 'Find grants, scholarships and student aid by state and category. Live counts, upcoming deadlines and official links.',
    h1: 'Browse grants by state and category',
    intro: [
      `${site.open.length} listings in the ${SITE_NAME} catalog aren't closed right now. Pick a topic or a state to see them with deadlines and links to each funder's page.`,
      `State pages appear only where we have at least ${SEO_THRESHOLD} state-specific listings; right now that is ${states.length ? listJoin(states.map(s => s.label)) : 'no state'}.`,
    ],
    categories, states, stateCategories: pages.filter(p => p.type === 'stateCategory').map(toLink),
    soonest, openCount: site.open.length,
    refreshedLine: site.refreshedAt ? `Catalog last refreshed ${formatLastUpdatedEt(site.refreshedAt)}` : null,
    stale: freshness.stale,
  };
}

/** Looks up a page for /grants/<segments>. null → 404 (unknown slug, or 0 open specific listings). */
export function findSeoPage(site: SeoSite, segments: string[]): SeoPage | null {
  const route = resolveSeoRoute(segments);
  if (!route) return null;
  const path = route.type === 'category' ? seoPath.category(route.category)
    : route.type === 'state' ? seoPath.state(route.state) : seoPath.stateCategory(route.state, route.category);
  return site.pages.get(path) || null;
}

/** CollectionPage + ItemList + BreadcrumbList. No Grant/MonetaryGrant markup (spec §3.2). */
export function seoJsonLd(input: { path: string; name: string; description: string; crumbs: Crumb[]; items: { name: string; url: string }[]; dateModified: string | null }) {
  const url = SITE_ORIGIN + (input.path === '/' ? '' : input.path);
  const breadcrumb = {
    '@type': 'BreadcrumbList', '@id': url + '#breadcrumb',
    itemListElement: input.crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE_ORIGIN + (c.path === '/' ? '/' : c.path) })),
  };
  const itemList = {
    '@type': 'ItemList', '@id': url + '#listings', numberOfItems: Math.min(input.items.length, SEO_MAX_ITEMS),
    itemListElement: input.items.slice(0, SEO_MAX_ITEMS).map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: it.url })),
  };
  const page: Record<string, unknown> = {
    '@type': 'CollectionPage', '@id': url, url, name: input.name, description: input.description,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_ORIGIN }, breadcrumb: { '@id': breadcrumb['@id'] }, mainEntity: { '@id': itemList['@id'] },
  };
  if (input.dateModified) page.dateModified = input.dateModified;
  return { '@context': 'https://schema.org', '@graph': [page, breadcrumb, itemList] };
}

/** Safe for a <script type="application/ld+json"> body. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Sitemap URLs: /grants plus every indexable page (never noindexed ones). */
export function seoSitemapPaths(site: SeoSite | null): string[] {
  if (!site) return [];
  return [seoPath.hub(), ...indexablePages(site).map(p => p.path)];
}

export { stateSlug };
