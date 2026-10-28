// Ongoing catalog sweep: pure helpers for the profile-independent sources (Grants.gov posted + forecasted,
// Washington FundHub), safe retirement, cross-source dedupe, the 30-day hide for scraped listings and the public
// refresh health summary. No Cloudflare or database imports, so every rule here is unit-tested directly.
import type { Grant } from './grants';
import { clean, tidyTitle, explicitDate, easternDay, safeUrl, parsePrivateAwards } from './source-parsers';
import { normalizeLeadUrl } from './state-discovery';

export const DAY_MS = 86400000;
export const HIDE_UNSEEN_AFTER_DAYS = 30;
export const DETAIL_REFRESH_DAYS = 14;
export const HEALTH_STALE_AFTER_MS = 26 * 3600000;
// A fetch that returns fewer than this share of a source's previously active listings is treated as suspect:
// nothing is retired for that source in this run and the source is reported Partial.
export const RETIRE_MIN_SHARE = 0.5;

// ---------- Grants.gov ----------
// Three sweep searches cover every applicant type the site supports. Eligibility codes: 21 individuals,
// 23 small businesses, 12/13 nonprofits, 99 unrestricted. Posted and forecasted grants only (no cooperative
// agreements or loans).
export const GRANTS_GOV_GROUPS = [
  { key: 'individual', eligibilities: '21|99', types: ['Student', 'Individual', 'Freelancer'] },
  { key: 'business', eligibilities: '23|99', types: ['Small business', 'Freelancer'] },
  { key: 'nonprofit', eligibilities: '12|13|99', types: ['Nonprofit'] },
] as const;
export const GRANTS_GOV_ROWS = 2000;
export const grantsGovDetailUrl = (id: string | number) => 'https://www.grants.gov/search-results-detail/' + id;
export function sweepRequest(group: { eligibilities: string }) {
  return { rows: GRANTS_GOV_ROWS, startRecordNum: 0, oppStatuses: 'forecasted|posted', fundingInstruments: 'G', eligibilities: group.eligibilities, sortBy: 'openDate|desc' };
}
export type SweepHit = { id: string; number: string; title: string; agency: string; openDate: string; closeDate: string; oppStatus: string; types: string[] };
export type SweepResult = { hits: Map<string, SweepHit>; complete: boolean; queries: number; errors: string[]; deferred: number };

/** Runs the three sweep searches. complete is false when any search failed, was deferred or returned fewer rows
 *  than its hitCount; then nothing may be retired from Grants.gov this run. */
export async function sweepGrantsGov(search: (body: ReturnType<typeof sweepRequest>) => Promise<any>, isDeferred: (e: unknown) => boolean = () => false): Promise<SweepResult> {
  const hits = new Map<string, SweepHit>(); const errors: string[] = []; let complete = true, queries = 0, deferred = 0;
  for (const group of GRANTS_GOV_GROUPS) {
    try {
      const data = await search(sweepRequest(group)); queries++;
      const rows: any[] = Array.isArray(data?.oppHits) ? data.oppHits : [];
      if (!Array.isArray(data?.oppHits)) throw new Error('Grants.gov returned no result list');
      if (Number(data.hitCount) > rows.length) { complete = false; errors.push(`${group.key} sweep returned ${rows.length} of ${data.hitCount} hits`); }
      for (const h of rows) {
        if (!h?.id || !['posted', 'forecasted'].includes(String(h.oppStatus))) continue;
        const id = String(h.id); const prev = hits.get(id);
        if (prev) { prev.types = [...new Set([...prev.types, ...group.types])]; continue; }
        hits.set(id, { id, number: clean(h.number), title: tidyTitle(h.title), agency: clean(h.agency || h.agencyName), openDate: clean(h.openDate), closeDate: clean(h.closeDate), oppStatus: String(h.oppStatus), types: [...group.types] });
      }
    } catch (e) {
      complete = false;
      if (isDeferred(e)) { deferred++; continue; }
      errors.push(`${group.key} sweep: ${(e as Error).message}`);
    }
  }
  return { hits, complete, queries, errors, deferred };
}

const PLACEHOLDER_REQ = 'Read the full notice for applicant eligibility, cost sharing and other restrictions.';
/** One sweep hit as a catalog record. Enriched detail fields (description, amount, requirements, tags, applicant
 *  codes) from an earlier detail lookup are kept; deadline, title, status and agency come from this run. */
export function grantsGovRecord(hit: SweepHit, prev: Grant | undefined, now: string): Grant {
  const id = 'gov-' + hit.id, forecast = hit.oppStatus === 'forecasted';
  const deadline = forecast ? null : explicitDate(hit.closeDate) || null;
  const closed = !!deadline && deadline < easternDay(now);
  // A forecast that has now been posted gets a fresh detail lookup for the posted notice.
  const enriched = !!prev && !prev.detailPending && !!prev.description && !(prev.status === 'Opens soon' && !forecast);
  const description = enriched ? prev!.description : `${forecast ? 'Forecasted' : 'Posted'} federal grant opportunity ${hit.number} from ${hit.agency || 'a federal agency'}. Open the Grants.gov listing for the full notice, eligibility and award details.`;
  const g: Grant = {
    id, title: hit.title, funder: hit.agency || prev?.funder || 'Federal agency', description,
    types: hit.types, countries: ['United States'], tags: enriched ? prev!.tags : [], amount: enriched ? prev!.amount : null,
    deadline, deadlineLabel: forecast ? (enriched && prev!.deadlineLabel?.startsWith('Forecast') ? prev!.deadlineLabel : 'Forecast: estimated dates on the Grants.gov notice') : hit.closeDate || 'See notice',
    url: grantsGovDetailUrl(hit.id), sourceUrl: grantsGovDetailUrl(hit.id), source: 'Grants.gov',
    requirements: enriched ? prev!.requirements : [PLACEHOLDER_REQ], checked: now, discovered: prev?.discovered || now,
    kind: 'Federal grant', live: true, status: closed ? 'Closed' : forecast ? 'Opens soon' : 'Open',
    opportunityNumber: hit.number || undefined, grantsGovId: hit.id, lastSeen: now,
  };
  if (prev?.applicantCodes) g.applicantCodes = prev.applicantCodes;
  if (prev?.detailChecked) g.detailChecked = prev.detailChecked;
  if (forecast) g.opensOn = enriched ? prev!.opensOn ?? null : null;
  if (!enriched) g.detailPending = true;
  return g;
}

const isoFromStr = (v: unknown) => { const m = String(v || '').match(/^(20\d{2})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const bool = (v: unknown) => v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes';
/** Applies a fetchOpportunity response (synopsis for posted, forecast for forecasted) to a sweep record. */
export function applyGrantsGovDetail(g: Grant, data: any, now: string): Grant {
  const s = data?.synopsis || data?.forecast; const out: Grant = { ...g, detailChecked: now };
  if (!s) return out;
  const desc = clean(s.synopsisDesc || s.forecastDesc).slice(0, 2000);
  if (desc) out.description = desc;
  const ceiling = Number(String(s.awardCeiling ?? '').replace(/[^\d.]/g, ''));
  out.amount = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null;
  out.tags = (s.fundingActivityCategories || []).map((x: any) => clean(x?.description)).filter(Boolean);
  out.applicantCodes = (s.applicantTypes || []).map((a: any) => String(a?.id));
  if (s.agencyName) out.funder = clean(s.agencyName);
  out.requirements = [clean(s.applicantEligibilityDesc) || PLACEHOLDER_REQ, ...(bool(s.costSharing) ? ['Cost sharing or matching funds are required.'] : [])];
  if (data?.forecast && !data?.synopsis) {
    // Agencies often leave stale estimates on old forecasts; an estimate already in the past is not shown.
    const today = easternDay(now), est = (v: unknown) => { const d = isoFromStr(v); return d && d >= today ? d : null; };
    const opens = est(s.estSynopsisPostingDateStr), due = est(s.estApplicationResponseDateStr);
    out.opensOn = opens;
    out.deadlineLabel = due ? `Forecast: estimated application deadline ${due}` : 'Forecast: application dates not yet published';
  } else if (!out.deadline) {
    const due = isoFromStr(s.responseDateStr) || explicitDate(clean(s.responseDate));
    if (due) { out.deadline = due; out.deadlineLabel = clean(s.responseDate) || due; if (due < easternDay(now)) out.status = 'Closed'; }
  }
  delete out.detailPending;
  return out;
}
/** Detail lookups for this run: never-enriched records first (posted before forecasts, soonest deadline first),
 *  then enriched records not re-checked for DETAIL_REFRESH_DAYS, oldest first. */
export function detailQueue(records: Grant[], now: string, limit: number): Grant[] {
  const cutoff = Date.parse(now) - DETAIL_REFRESH_DAYS * DAY_MS;
  const pending = records.filter(g => g.detailPending && g.status !== 'Closed').sort((a, b) => Number(a.status === 'Opens soon') - Number(b.status === 'Opens soon') || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || a.id.localeCompare(b.id));
  const lastDetail = (g: Grant) => Date.parse(g.detailChecked || g.discovered || '') || 0;
  const due = records.filter(g => !g.detailPending && g.status !== 'Closed' && lastDetail(g) < cutoff).sort((a, b) => lastDetail(a) - lastDetail(b) || a.id.localeCompare(b.id));
  return [...pending, ...due].slice(0, limit);
}

// ---------- Washington FundHub ----------
// Public WordPress REST listing of the state's funding hub. funding-type 6 = Grant; funding-audience 19 Businesses,
// 21 Individuals, 23 Nonprofits. Only records whose funding_status is "active" are listed.
export const WA_PAGE_SIZE = 100;
export const waFundHubUrl = (page: number) => `https://fundhub.wa.gov/wp-json/wp/v2/funding?per_page=${WA_PAGE_SIZE}&page=${page}&funding-type=6&funding-audience=19,21,23&orderby=id&order=desc&_fields=id,title,link,modified,funding-type,funding-audience,acf`;
const WA_AUDIENCE_TYPES: Record<number, string[]> = { 19: ['Small business', 'Freelancer'], 21: ['Individual', 'Freelancer'], 23: ['Nonprofit'] };
const ymd = (v: unknown) => { const m = String(v || '').match(/^(20\d{2})(\d{2})(\d{2})$/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
export type WaPage = { active: Grant[]; inactiveIds: string[]; count: number };
export function parseWaFundHub(json: unknown, now: string): WaPage {
  if (!Array.isArray(json)) throw new Error('FundHub returned an unexpected response');
  const active: Grant[] = [], inactiveIds: string[] = []; const today = easternDay(now);
  for (const r of json as any[]) {
    if (!r?.id) continue; const id = 'wa-' + r.id; const acf = r.acf || {};
    if (!(r['funding-type'] || []).includes(6)) continue;
    if (String(acf.funding_status || '').toLowerCase() !== 'active') { inactiveIds.push(id); continue; }
    const types = [...new Set((r['funding-audience'] || []).flatMap((a: number) => WA_AUDIENCE_TYPES[a] || []))] as string[];
    const page = safeUrl(String(r.link || ''), 'https://fundhub.wa.gov/');
    const linkValue = typeof acf.application_link === 'object' && acf.application_link ? acf.application_link.url : '';
    const apply = linkValue ? safeUrl(String(linkValue), 'https://fundhub.wa.gov/') : null;
    const applyOk = apply && !/^https?:\/\/_blank\/?$/i.test(apply) ? apply : null;
    const title = tidyTitle(r.title?.rendered);
    if (!types.length) continue;
    const deadline = ymd(acf.application_close_date), opens = ymd(acf.application_open_date);
    const state = String(acf.federal_or_state || '').toLowerCase() === 'state';
    const ref = String(acf.external_reference_id || ''); const ggRef = ref.match(/^grantsgov_(\d+)$/)?.[1] || (applyOk || '').match(/grants\.gov\/search-results-detail\/(\d+)/)?.[1];
    const amount = Number(String(acf.ending_amount || '').replace(/[^\d.]/g, ''));
    const g: Grant = {
      id, title, funder: clean(acf.source) || 'Washington FundHub', description: clean(acf.description).slice(0, 1500) || 'Funding opportunity listed on Washington FundHub.',
      types, countries: ['United States'], states: state ? ['Washington'] : [], tags: [], amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      deadline, deadlineLabel: deadline || 'See listing', url: applyOk || page || '', sourceUrl: page || undefined, source: 'Washington FundHub',
      requirements: [clean(acf.eligibility).slice(0, 600) || 'Confirm eligibility with the funder.', ...(String(acf.cost_share).toLowerCase() === 'yes' ? ['Cost sharing or matching funds may be required.'] : []), state ? 'Washington state funding listed on Washington FundHub.' : 'Listed on Washington FundHub; confirm whether applicants outside Washington are eligible.'],
      checked: now, discovered: now, kind: state ? 'State grant' : 'Federal grant', live: true,
      status: deadline && deadline < today ? 'Closed' : opens && opens > today && (!deadline || opens <= deadline) ? 'Opens soon' : 'Open',
      sourceUpdated: clean(r.modified) || undefined, lastSeen: now,
    };
    if (g.status === 'Opens soon') g.opensOn = opens;
    if (ggRef) g.grantsGovId = ggRef;
    active.push(g);
  }
  return { active, inactiveIds, count: (json as any[]).length };
}

/** Pages through Washington FundHub (pages of WA_PAGE_SIZE). complete=true only when the last page was short, or
 *  page 2+ answered HTTP 400 (WordPress "page out of range"); a page-1 failure throws so nothing is retired. */
export async function fetchWaFundHub(get: (url: string) => Promise<string>, maxPages: number, now: string) {
  const records: Grant[] = [], inactiveIds: string[] = [];let complete = false, queries = 0;
  for (let page = 1; page <= maxPages; page++) {
    let body: string;
    try { body = await get(waFundHubUrl(page)); } catch (e) { if (page > 1 && /HTTP 400/.test((e as Error).message)) { complete = true; break; } throw e; }
    queries++;const parsed = parseWaFundHub(JSON.parse(body), now);records.push(...parsed.active);inactiveIds.push(...parsed.inactiveIds);
    if (parsed.count < WA_PAGE_SIZE) { complete = true; break; }
  }
  return { records, inactiveIds, complete, queries };
}

export const POETS_WRITERS_PAGE_SIZE = 100;
export const poetsWritersUrl = (page: number) => 'https://www.pw.org/grants?items_per_page=100&field_deadline_value=1' + (page ? '&page=' + page : '');
/** Pages through Poets & Writers' upcoming-deadline listing. A page is "full" by its raw row count (the parser drops
 *  past-deadline rows), so complete=true only when a page had fewer than 100 rows. */
export async function fetchPoetsWriters(get: (url: string) => Promise<string>, maxPages: number, now: string) {
  const records = new Map<string, Grant>();let complete = false, queries = 0;
  for (let page = 0; page < maxPages; page++) {
    const html = await get(poetsWritersUrl(page));queries++;
    const listed = html.split(/<div class="views-row [^"]*">/).length - 1;
    if (listed) for (const g of parsePrivateAwards(html, now)) records.set(g.id, g);
    if (listed < POETS_WRITERS_PAGE_SIZE) { complete = true; break; }
  }
  return { records: [...records.values()], complete, queries };
}

// ---------- Retirement ----------
export type RetireInput = { prefix: string; existing: Iterable<Grant>; seenIds: Set<string>; complete: boolean; explicitlyClosed?: string[]; reason: string; now: string };
export type RetireResult = { retired: Grant[]; guarded: boolean; note: string };
const isActive = (g: Grant) => g.status !== 'Closed';
/** Closes records of one source that the source no longer lists. Only call after that source's fetch succeeded:
 *  a failed fetch must never reach here. Missing records are retired only when the listing was complete and not
 *  suspiciously short; records the source itself marks closed are always retired. Rows are never deleted. */
export function retireMissing(input: RetireInput): RetireResult {
  const own = [...input.existing].filter(g => g.id.startsWith(input.prefix));
  const previouslyActive = own.filter(isActive).length;
  const explicit = new Set(input.explicitlyClosed || []);
  const guarded = previouslyActive >= 10 && input.seenIds.size < previouslyActive * RETIRE_MIN_SHARE;
  const retired: Grant[] = [];
  for (const g of own) {
    if (!isActive(g) || input.seenIds.has(g.id)) continue;
    const byExplicit = explicit.has(g.id);
    if (!byExplicit && (!input.complete || guarded)) continue;
    retired.push({ ...g, status: 'Closed', live: false, retiredAt: input.now, closedReason: byExplicit ? 'Marked closed by the source' : input.reason });
  }
  const note = guarded ? `Retirement skipped: ${input.seenIds.size} listings is under ${RETIRE_MIN_SHARE * 100}% of ${previouslyActive} previously active.` : !input.complete ? 'Listing not fully fetched; only records the source marks closed were retired.' : '';
  return { retired, guarded, note };
}

// ---------- Cross-source dedupe ----------
export const normalizeNumber = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normalizeTitle = (v: string) => clean(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export function dedupeKeys(g: Grant): string[] {
  const keys: string[] = [];
  const gg = g.id.startsWith('gov-') ? g.id.slice(4) : g.grantsGovId;
  if (gg) keys.push('gg:' + gg);
  if (g.opportunityNumber) { const n = normalizeNumber(g.opportunityNumber); if (n.length >= 4) keys.push('num:' + n); }
  const url = normalizeLeadUrl(g.url), title = normalizeTitle(g.title || '');
  if (url && title) keys.push('ut:' + url + '|' + title);
  return keys;
}
/** Lower ranks win: Grants.gov, then structured state feeds, then everything else. */
export function sourceRank(g: Grant): number {
  if (g.id.startsWith('gov-')) return 0;
  if (/^(ca|wa)-/.test(g.id)) return 1;
  if (g.sourceMode === 'Primary-source research') return 2;
  return 3;
}
export type DedupeResult = { dropNew: string[]; markExisting: Grant[]; clearExisting: Grant[]; deduped: number };
/** Finds records that describe the same opportunity as a higher-ranked one (same Grants.gov ID, opportunity number,
 *  or normalized URL plus title). New losers are not inserted; existing losers get duplicateOf and are hidden. */
export function crossSourceDedupe(staged: Map<string, Grant>, existing: Map<string, Grant>): DedupeResult {
  const all = new Map(existing); for (const [id, g] of staged) all.set(id, g);
  const order = [...all.values()].filter(g => g.status !== 'Closed' && !/^(awesome|nase|amber|pell)$/.test(g.id))
    .sort((a, b) => sourceRank(a) - sourceRank(b) || String(a.discovered || '').localeCompare(String(b.discovered || '')) || a.id.localeCompare(b.id));
  const owner = new Map<string, string>(), loserOf = new Map<string, string>();
  for (const g of order) {
    const keys = dedupeKeys(g); const winner = keys.map(k => owner.get(k)).find(id => id && id !== g.id);
    if (winner) { loserOf.set(g.id, winner); continue; }
    for (const k of keys) if (!owner.has(k)) owner.set(k, g.id);
  }
  const dropNew: string[] = [], markExisting: Grant[] = [], clearExisting: Grant[] = [];
  for (const [id, winner] of loserOf) {
    const prior = existing.get(id), current = staged.get(id) || prior!;
    if (!prior) { dropNew.push(id); continue; }
    if (current.duplicateOf !== winner || prior.duplicateOf !== winner) markExisting.push({ ...current, duplicateOf: winner });
  }
  for (const g of all.values()) if (g.duplicateOf && !loserOf.has(g.id)) { const { duplicateOf, ...rest } = staged.get(g.id) || g; void duplicateOf; clearExisting.push(rest as Grant); }
  const newlyMarked = markExisting.filter(g => existing.get(g.id)?.duplicateOf !== g.duplicateOf).length;
  return { dropNew, markExisting, clearExisting, deduped: dropNew.length + newlyMarked };
}

// ---------- Visibility ----------
const SCRAPED = /^(cos|pw|chamber|state)-/;
/** Scraped listings (CareerOneStop, Poets & Writers, U.S. Chamber, state page scans) whose source has not shown
 *  them for HIDE_UNSEEN_AFTER_DAYS. Researched records and structured feeds are excluded. Rows are kept. */
export function isUnseenScraped(g: Grant, now: string | number = Date.now()): boolean {
  if (!SCRAPED.test(g.id) || g.sourceMode === 'Primary-source research') return false;
  const seen = Date.parse(g.lastSeen || g.checked || '');
  const at = typeof now === 'number' ? now : Date.parse(now);
  return !Number.isFinite(seen) || at - seen > HIDE_UNSEEN_AFTER_DAYS * DAY_MS;
}
export const hasTitleAndLink = (g: Pick<Grant, 'title' | 'url'>) => !!clean(g.title) && !!safeUrl(String(g.url || ''), 'https://invalid.invalid') && /^https?:\/\//i.test(String(g.url || '').trim());
export function isHiddenListing(g: Grant, now: string | number = Date.now()): boolean {
  return !!g.duplicateOf || !hasTitleAndLink(g) || isUnseenScraped(g, now);
}
export const visibleListings = <T extends Grant>(grants: T[], now: string | number = Date.now()) => grants.filter(g => !isHiddenListing(g, now));

// ---------- Change detection ----------
const VOLATILE = new Set(['checked', 'lastSeen', 'discovered', 'sourceUpdated', 'detailChecked']);
const stable = (g: Grant) => JSON.stringify(Object.keys(g).filter(k => !VOLATILE.has(k) && (g as any)[k] !== undefined).sort().map(k => [k, (g as any)[k]]));
/** True when a source re-fetch changed anything users see (title, deadline, amount, status, text, links...). */
export const contentChanged = (prev: Grant, next: Grant) => stable(prev) !== stable(next);

// ---------- Health ----------
export type RefreshCounts = { added: number; updated: number; retired: number; deduped: number };
export type RefreshHealth = { status: 'ok' | 'partial' | 'failed' | 'stale'; checkedAt: string | null; lastAttemptAt: string | null; failedSources: string[] } & RefreshCounts;
export type RefreshAttempt = { at: string; ok: boolean; error?: string };
const FAILED = new Set(['Unavailable', 'Partial']);
/** Public health of the last refresh. failed: the latest run crashed before saving. stale: no successful run in
 *  the last 26 hours. partial: a source failed or returned only part of its data (budget deferrals are not
 *  failures). ok otherwise. Only source names and counts are exposed, never error text. */
export function refreshHealth(last: any, attempt: RefreshAttempt | null | undefined, now = Date.now()): RefreshHealth {
  const checkedAt = typeof last?.checkedAt === 'string' ? last.checkedAt : null;
  const counts: RefreshCounts = { added: 0, updated: 0, retired: 0, deduped: 0, ...(last?.counts || {}) };
  const failedSources = [...new Set(((last?.sources || []) as any[]).filter(s => s && FAILED.has(s.status) && (s.error || s.status === 'Unavailable')).map(s => String(s.name)))];
  const lastAttemptAt = attempt?.at || checkedAt;
  const lastSuccess = checkedAt ? Date.parse(checkedAt) : NaN;
  let status: RefreshHealth['status'];
  if (attempt && !attempt.ok && (!Number.isFinite(lastSuccess) || Date.parse(attempt.at) >= lastSuccess)) status = 'failed';
  else if (!Number.isFinite(lastSuccess) || now - lastSuccess > HEALTH_STALE_AFTER_MS) status = 'stale';
  else status = failedSources.length ? 'partial' : 'ok';
  return { status, checkedAt, lastAttemptAt, failedSources, added: counts.added, updated: counts.updated, retired: counts.retired, deduped: counts.deduped };
}
