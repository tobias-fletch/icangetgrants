// Ongoing catalog sweep: pure helpers for the profile-independent sources (Grants.gov posted + forecasted,
// Washington FundHub), safe retirement, cross-source dedupe, the 30-day hide for scraped listings and the public
// refresh health summary. No Cloudflare or database imports, so every rule here is unit-tested directly.
import type { Grant } from './grants';
import { clean, tidyTitle, explicitDate, easternDay, safeUrl, parsePrivateAwards } from './source-parsers';
import { normalizeLeadUrl } from './state-discovery';
import { formatDay, isOpenGrant } from './listing';

export const DAY_MS = 86400000;
export const HIDE_UNSEEN_AFTER_DAYS = 30;
export const DETAIL_REFRESH_DAYS = 14;
export const HEALTH_STALE_AFTER_MS = 26 * 3600000;
// A Grants.gov forecast first posted this long ago is treated as stale even before its detail lookup: in the
// 2026-10-28 sweep every forecast this old had estimated dates in the past or no dates at all.
export const FORECAST_STALE_AFTER_DAYS = 730;
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
export type SweepHit = { id: string; number: string; title: string; agency: string; agencyCode?: string; openDate: string; closeDate: string; oppStatus: string; types: string[] };
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
        hits.set(id, { id, number: clean(h.number), title: tidyTitle(h.title), agency: clean(h.agency || h.agencyName), agencyCode: clean(h.agencyCode) || undefined, openDate: clean(h.openDate), closeDate: clean(h.closeDate), oppStatus: String(h.oppStatus), types: [...group.types] });
      }
    } catch (e) {
      complete = false;
      if (isDeferred(e)) { deferred++; continue; }
      errors.push(`${group.key} sweep: ${(e as Error).message}`);
    }
  }
  return { hits, complete, queries, errors, deferred };
}

// ---------- Agency vs contact person ----------
// Grants.gov's synopsis/forecast "agencyName" is often the contact person ("Benjamin J Goodman\nSenior Scientist").
// Conservative: only a staff job title, an email or phone number, or a "First M Last" name with no agency word counts.
const JOB_TITLE = /\b(?:grantor|grants?\s+(?:management\s+)?(?:officer|specialist)|contracting\s+officer|contract(?:ing)?\s+specialist|program\s+(?:analyst|officer|manager|executive|specialist|coordinator)|senior\s+scientist|scientist|specialist|analyst|coordinator|officer)\b/i;
const AGENCY_WORD = /\b(?:department|dept|office|agency|administration|institutes?|service|services|center|centers|bureau|mission|embassy|foundation|fund|national|council|commission|corps|command|laboratory|lab|research|endowment|division|board|authority|corporation|academy|survey|federal|regional|army|navy|naval|air\s+force|nasa|noaa|faa|nsf|nih|cdc|fda)\b|\bU\.?S\.?\b/i;
const PERSON_NAME = /^(?:[Dd]r\.?\s+)?[A-Za-z][a-z'’-]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?$/;
const MIDDLE_INITIAL = /^[A-Za-z][a-z'’-]+\s+[A-Z]\.?\s+[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?$/;
export function looksLikePerson(value: unknown): boolean {
  const raw = String(value ?? '').trim(); if (!raw) return false;
  if (/@|\b\d{3}[-.)\s]\s*\d{3}[-.\s]\d{4}\b/.test(raw)) return true;
  const lines = raw.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean), first = lines[0] || '';
  const name = PERSON_NAME.test(first) && !AGENCY_WORD.test(first);
  if (lines.length > 1 && name) return true;
  if (AGENCY_WORD.test(raw)) return false;
  if (JOB_TITLE.test(raw)) return true;
  return name && (MIDDLE_INITIAL.test(first) || /^dr\.?\s/i.test(first));
}
/** The funder shown for a Grants.gov record: the first agency-like name among the detail's agency details, the
 *  synopsis agencyName, the sweep agency, the top-level agency and finally the agency code. */
export function grantsGovAgency(candidates: unknown[], fallback = 'Federal agency'): string {
  for (const c of candidates) { const v = clean(String(c ?? '')).trim(); if (v && !looksLikePerson(c)) return v; }
  return fallback;
}

const PLACEHOLDER_REQ = 'Read the full notice for applicant eligibility, cost sharing and other restrictions.';
/** One sweep hit as a catalog record. Enriched detail fields (description, amount, requirements, tags, applicant
 *  codes) from an earlier detail lookup are kept; deadline, title, status and agency come from this run. */
export function grantsGovRecord(hit: SweepHit, prev: Grant | undefined, now: string): Grant {
  const id = 'gov-' + hit.id, forecast = hit.oppStatus === 'forecasted', today = easternDay(now);
  const deadline = forecast ? null : explicitDate(hit.closeDate) || null;
  const closed = !!deadline && deadline < today;
  // A forecast that has now been posted gets a fresh detail lookup for the posted notice.
  const enriched = !!prev && !prev.detailPending && !!prev.description && !(prev.status === 'Opens soon' && !forecast);
  const description = enriched ? prev!.description : `${forecast ? 'Forecasted' : 'Posted'} federal grant opportunity ${hit.number} from ${hit.agency || 'a federal agency'}. Open the Grants.gov listing for the full notice, eligibility and award details.`;
  const g: Grant = {
    id, title: hit.title, funder: grantsGovAgency([hit.agency, prev?.funder, hit.agencyCode]), description,
    types: hit.types, countries: ['United States'], tags: enriched ? prev!.tags : [], amount: enriched ? prev!.amount : null,
    deadline, deadlineLabel: forecast ? (enriched && prev!.deadlineLabel?.startsWith('Forecast') ? prev!.deadlineLabel : 'Forecast: estimated dates on the Grants.gov notice') : hit.closeDate || 'See notice',
    url: grantsGovDetailUrl(hit.id), sourceUrl: grantsGovDetailUrl(hit.id), source: 'Grants.gov',
    requirements: enriched ? prev!.requirements : [PLACEHOLDER_REQ], checked: now, discovered: prev?.discovered || now,
    kind: 'Federal grant', live: true, status: closed ? 'Closed' : forecast ? 'Opens soon' : 'Open',
    opportunityNumber: hit.number || undefined, grantsGovId: hit.id, lastSeen: now,
  };
  if (prev?.applicantCodes) g.applicantCodes = prev.applicantCodes;
  if (prev?.detailChecked) g.detailChecked = prev.detailChecked;
  if (forecast) {
    const postedOn = explicitDate(hit.openDate) || prev?.forecastPostedOn;
    if (postedOn) g.forecastPostedOn = postedOn;
    if (enriched) { if (prev!.estPostingDate) g.estPostingDate = prev!.estPostingDate; if (prev!.estDueDate) g.estDueDate = prev!.estDueDate; }
    g.opensOn = enriched && prev!.opensOn && prev!.opensOn >= today ? prev!.opensOn : null;
    const stale = staleForecastReason(g, now);
    if (stale) { g.status = 'Closed'; g.live = false; g.closedReason = stale; }
  }
  if (!enriched && g.status !== 'Closed') g.detailPending = true;
  return g;
}

/** Why a forecast should no longer be listed: an estimated posting or application date from the Grants.gov
 *  notice is already past, or the forecast itself was first posted over FORECAST_STALE_AFTER_DAYS ago. */
export function staleForecastReason(g: Pick<Grant, 'estPostingDate' | 'estDueDate' | 'forecastPostedOn'>, now: string): string | null {
  const today = easternDay(now);
  if (g.estDueDate && g.estDueDate < today) return 'Forecast estimated application date has passed';
  if (g.estPostingDate && g.estPostingDate < today) return 'Forecast estimated posting date has passed';
  if (g.forecastPostedOn && Date.parse(now) - Date.parse(g.forecastPostedOn + 'T12:00:00Z') > FORECAST_STALE_AFTER_DAYS * DAY_MS) return 'Forecast is over two years old';
  return null;
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
  out.funder = grantsGovAgency([s.agencyDetails?.agencyName, data?.agencyDetails?.agencyName, s.agencyName, g.funder, data?.topAgencyDetails?.agencyName, s.agencyCode, data?.owningAgencyCode], g.funder || 'Federal agency');
  out.requirements = [clean(s.applicantEligibilityDesc) || PLACEHOLDER_REQ, ...(bool(s.costSharing) ? ['Cost sharing or matching funds are required.'] : [])];
  if (data?.forecast && !data?.synopsis) {
    // Agencies often leave stale estimates on old forecasts; an estimate already in the past is not shown.
    // A forecast whose estimated posting or application date has passed is closed (row kept, hidden).
    const today = easternDay(now), postAt = isoFromStr(s.estSynopsisPostingDateStr), dueAt = isoFromStr(s.estApplicationResponseDateStr);
    if (postAt) out.estPostingDate = postAt; else delete out.estPostingDate;
    if (dueAt) out.estDueDate = dueAt; else delete out.estDueDate;
    out.opensOn = postAt && postAt >= today ? postAt : null;
    out.deadlineLabel = dueAt && dueAt >= today ? `Forecast: estimated application deadline ${formatDay(dueAt)}` : 'Forecast: application dates not yet published';
    const stale = staleForecastReason(out, now);
    if (stale) { out.status = 'Closed'; out.live = false; out.closedReason = stale; }
  } else if (!out.deadline) {
    const due = isoFromStr(s.responseDateStr) || explicitDate(clean(s.responseDate));
    if (due) { out.deadline = due; out.deadlineLabel = clean(s.responseDate) || due; if (due < easternDay(now)) out.status = 'Closed'; }
  }
  delete out.detailPending;
  return out;
}
/** Detail lookups for this run: never-enriched records first, then enriched records not re-checked for
 *  DETAIL_REFRESH_DAYS, oldest first. Half of the pending slots go to forecasts (their estimated dates decide
 *  "expected" and stale), alternating the oldest-posted (most likely stale) and newest-posted forecast; the rest
 *  go to posted records, soonest deadline first. Unused slots on either side go to the other. */
export function detailQueue(records: Grant[], now: string, limit: number): Grant[] {
  const cutoff = Date.parse(now) - DETAIL_REFRESH_DAYS * DAY_MS;
  const open = records.filter(g => g.detailPending && g.status !== 'Closed');
  const posted = open.filter(g => g.status !== 'Opens soon').sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || a.id.localeCompare(b.id));
  const byPosted = open.filter(g => g.status === 'Opens soon').sort((a, b) => String(a.forecastPostedOn || '').localeCompare(String(b.forecastPostedOn || '')) || a.id.localeCompare(b.id));
  const forecasts: Grant[] = []; for (let lo = 0, hi = byPosted.length - 1; lo <= hi; lo++, hi--) { forecasts.push(byPosted[lo]); if (hi !== lo) forecasts.push(byPosted[hi]); }
  const fSlots = Math.min(forecasts.length, Math.max(Math.ceil(limit / 2), limit - posted.length));
  const pending = [...posted.slice(0, limit - fSlots), ...forecasts.slice(0, fSlots), ...posted.slice(limit - fSlots), ...forecasts.slice(fSlots)];
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

// ---------- Generic titles ----------
// Titles made only of generic award words ("Poetry Prize", "Book Prize", "Chapbook Contest") get the sponsor added.
const GENERIC_WORDS = new Set('a an the and of for in on to by with annual open first second full length full-length book books chapbook chapbooks poetry poem poems poet poets fiction nonfiction non creative short story stories flash prose essay essays novel novella novels manuscript manuscripts writing writers writer literary literature translation translations prize prizes award awards contest contests competition competitions fellowship fellowships grant grants residency residencies emerging debut new collection series memoir reading program publication prizes international national chapbook contest'.split(' '));
export function isGenericTitle(title: string): boolean {
  const words = normalizeTitle(title).split(' ').filter(Boolean);
  return words.length > 0 && words.length <= 6 && words.every(w => GENERIC_WORDS.has(w) || /^\d{4}$/.test(w));
}
// The title already names the sponsor when every distinctive word of the sponsor's name is in it
// ("Nightboat Poetry Prize" for Nightboat Books).
const SPONSOR_FILLER = new Set('the a an of and for books book press publishing publishers magazine review journal quarterly foundation inc llc co company literary arts editions'.split(' '));
const hasSponsor = (title: string, sponsor: string) => {
  const t = new Set(normalizeTitle(title).split(' ')), words = normalizeTitle(sponsor).split(' ').filter(w => w && !SPONSOR_FILLER.has(w));
  return !sponsor || (words.length ? words.every(w => t.has(w)) : normalizeTitle(title).includes(normalizeTitle(sponsor)));
};
export function withSponsor(title: string, sponsor: string): string {
  const t = clean(title), s = clean(sponsor);
  return s && !hasSponsor(t, s) ? `${t}, ${s}` : t;
}
/** Listings that still share a normalized title with another visible listing get their sponsor added (then the
 *  opportunity number when the sponsor is the same too). Grants.gov records are only renamed when the number differs.
 *  Returns the records whose titles changed. */
export function disambiguateTitles(visible: Grant[]): Grant[] {
  const groups = new Map<string, Grant[]>();
  for (const g of visible) { const k = normalizeTitle(g.title || ''); if (k) groups.set(k, [...(groups.get(k) || []), g]); }
  const changed: Grant[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const funders = new Set(list.map(g => normalizeTitle(g.funder || '')));
    for (const g of list) {
      const sameFunder = list.filter(x => normalizeTitle(x.funder || '') === normalizeTitle(g.funder || '')).length > 1;
      let title = g.title;
      if (funders.size > 1 && !g.id.startsWith('gov-')) title = withSponsor(title, g.funder);
      if (sameFunder && g.opportunityNumber && !title.includes(g.opportunityNumber)) title = `${title} (${g.opportunityNumber})`;
      if (title !== g.title) changed.push({ ...g, title });
    }
  }
  return changed;
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
    if (listed) for (const g of parsePrivateAwards(html, now)) records.set(g.id, isGenericTitle(g.title) || /_\d+$/.test(g.id) ? { ...g, title: withSponsor(g.title, g.funder) } : g);
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
// Same normalized title and same fixed deadline across two different sources (e.g. a Grants.gov notice that
// Washington FundHub re-lists under its own ID). At least three words, so short generic titles never pair up.
export function titleDeadlineKey(g: Grant): string | null {
  const title = normalizeTitle(g.title || ''); const d = String(g.deadline || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && title.split(' ').length >= 3 ? 'td:' + title + '|' + d : null;
}
const sourceOf = (g: Grant) => g.id.startsWith('gov-') ? 'Grants.gov' : g.source || g.id.split('-')[0];
// A Grants.gov forecast with the same normalized title and agency as an open Grants.gov notice: the open one is kept.
const forecastPairKey = (g: Grant) => g.id.startsWith('gov-') ? 'fp:' + normalizeTitle(g.title || '') + '|' + normalizeTitle(g.funder || '') : null;
/** Finds records that describe the same opportunity as a higher-ranked one (same Grants.gov ID, opportunity number,
 *  or normalized URL plus title). New losers are not inserted; existing losers get duplicateOf and are hidden. */
export function crossSourceDedupe(staged: Map<string, Grant>, existing: Map<string, Grant>): DedupeResult {
  const all = new Map(existing); for (const [id, g] of staged) all.set(id, g);
  const order = [...all.values()].filter(g => g.status !== 'Closed' && !/^(awesome|nase|amber|pell)$/.test(g.id))
    .sort((a, b) => sourceRank(a) - sourceRank(b) || String(a.discovered || '').localeCompare(String(b.discovered || '')) || a.id.localeCompare(b.id));
  const owner = new Map<string, string>(), loserOf = new Map<string, string>();
  for (const g of order) {
    const keys = dedupeKeys(g); let winner = keys.map(k => owner.get(k)).find(id => id && id !== g.id);
    const td = titleDeadlineKey(g), tdOwner = td ? owner.get(td) : undefined;
    if (!winner && tdOwner && tdOwner !== g.id && sourceOf(all.get(tdOwner)!) !== sourceOf(g)) winner = tdOwner;
    if (winner) { loserOf.set(g.id, winner); continue; }
    for (const k of keys) if (!owner.has(k)) owner.set(k, g.id);
    if (td && !owner.has(td)) owner.set(td, g.id);
  }
  // Forecast/open pairs on Grants.gov: the forecast is hidden behind the open notice with the same title and agency.
  const openByPair = new Map<string, string>();
  for (const g of order) { const k = forecastPairKey(g); if (k && g.status !== 'Opens soon' && !loserOf.has(g.id) && !openByPair.has(k)) openByPair.set(k, g.id); }
  for (const g of order) { const k = forecastPairKey(g); const open = k && g.status === 'Opens soon' ? openByPair.get(k) : undefined; if (open && !loserOf.has(g.id)) loserOf.set(g.id, open); }
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
/** Closed rows (status Closed, or a fixed deadline before today in New York) stay in the catalog but are not
 *  listed publicly, searched, counted or put in the sitemap. */
export function isClosedListing(g: Pick<Grant, 'status' | 'deadline'>, now: string | number = Date.now()): boolean {
  return !isOpenGrant(g, new Date(typeof now === 'number' ? now : Date.parse(now)));
}
export function isHiddenListing(g: Grant, now: string | number = Date.now()): boolean {
  return !!g.duplicateOf || !hasTitleAndLink(g) || isUnseenScraped(g, now) || isClosedListing(g, now);
}
export const visibleListings = <T extends Grant>(grants: T[], now: string | number = Date.now()) => grants.filter(g => !isHiddenListing(g, now));

// ---------- Change detection ----------
const VOLATILE = new Set(['checked', 'lastSeen', 'discovered', 'sourceUpdated', 'detailChecked']);
const stable = (g: Grant) => JSON.stringify(Object.keys(g).filter(k => !VOLATILE.has(k) && (g as any)[k] !== undefined).sort().map(k => [k, (g as any)[k]]));
/** True when a source re-fetch changed anything users see (title, deadline, amount, status, text, links...). */
export const contentChanged = (prev: Grant, next: Grant) => stable(prev) !== stable(next);

// ---------- Health ----------
export type RefreshCounts = { added: number; updated: number; retired: number; deduped: number };
export type HealthWarning = { source: string; message: string };
export type RefreshHealth = { status: 'ok' | 'partial' | 'failed' | 'stale'; checkedAt: string | null; lastAttemptAt: string | null; failedSources: string[]; warnings: HealthWarning[] } & RefreshCounts;
export type RefreshAttempt = { at: string; ok: boolean; error?: string };
const FAILED = new Set(['Unavailable', 'Partial']);
/** Public health of the last refresh. failed: the latest run crashed before saving. stale: no successful run in
 *  the last 26 hours. partial: a source failed or returned only part of its data (budget deferrals are not
 *  failures). ok otherwise. Only source names and counts are exposed, never raw error text; warnings carry
 *  fixed wording built by the source (see refusalKind). */
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
  // Warnings (for example studentaid.gov refusing an automated check) are shown separately and never set partial.
  const warnings: HealthWarning[] = ((last?.sources || []) as { name?: unknown; warnings?: unknown }[]).flatMap(s => Array.isArray(s?.warnings) ? s.warnings.map((w: unknown) => ({ source: String(s.name), message: String(w).slice(0, 300) })) : []);
  return { status, checkedAt, lastAttemptAt, failedSources, warnings, added: counts.added, updated: counts.updated, retired: counts.retired, deduped: counts.deduped };
}

// ---------- Refused connections ----------
/** A site refusing, resetting or timing out our honest ICanGetGrants/1.2 request (or answering 403/429,
 *  or with any 5xx such as Cloudflare's 520), as opposed to a missing (404) or broken page or parser. Returns fixed wording for public health, or null for other errors. */
export function refusalKind(e: unknown): string | null {
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } } | null;
  const text = [err?.name, err?.message, err?.code, err?.cause?.code, err?.cause?.message].filter(Boolean).join(' ');
  if (/TimeoutError|AbortError|timed? ?out|aborted due to timeout|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT/i.test(text)) return 'timed out';
  if (/ECONNRESET|connection (?:was )?reset|stream reset|socket hang up|network connection lost|other side closed|UND_ERR_SOCKET/i.test(text)) return 'reset the connection';
  if (/ECONNREFUSED|connection refused/i.test(text)) return 'refused the connection';
  if (/\bHTTP (?:403|429)\b/.test(text)) return 'refused the request (' + text.match(/HTTP (?:403|429)/)![0] + ')';
  // 5xx (including Cloudflare's 520): the site's server or its front door failed us. Only the weekly studentaid.gov
  // check calls refusalKind, so this does not soften 5xx errors from any other source.
  if (/\bHTTP 5\d\d\b/.test(text)) return 'returned a server error (' + text.match(/HTTP 5\d\d/)![0] + ')';
  if (/^TypeError\b.*fetch failed/i.test(text)) return 'refused the connection';
  return null;
}
