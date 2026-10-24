// Search, deadline display, and catalog freshness. These rules never write
// back onto stored grant records.

import { tidyDeadlineLabel } from './source-parsers';

export const FAR_FUTURE_YEARS = 5;
export const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

export const RELATED_TERMS: readonly (readonly string[])[] = [
  ['nyc', 'new york city', 'new york', 'ny'],
  ['small business', 'entrepreneur', 'startup', 'start up', 'sba', 'microenterprise', 'micro enterprise'],
  ['women owned', 'women', 'female entrepreneur', 'female entrepreneurs'],
  ['bakery', 'food', 'culinary', 'food business'],
  ['arts', 'art', 'artist', 'artists', 'arts organization', 'culture', 'cultural', 'visual arts', 'performing arts', 'music', 'dance', 'theater'],
  ['technology', 'tech', 'stem', 'innovation'],
];

const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'at', 'by', 'from']);

const FIELD_WEIGHT = {
  title: 8,
  funder: 5,
  tags: 4,
  location: 3,
  eligibility: 2,
  description: 1,
} as const;

type Field = keyof typeof FIELD_WEIGHT;

export type SearchableGrant = {
  id: string;
  title: string;
  funder: string;
  description: string;
  tags?: string[];
  requirements?: string[];
  types?: string[];
  countries?: string[];
  states?: string[];
  deadline: string | null;
  deadlineLabel?: string | null;
  status?: string;
};

export type SearchHit<T extends SearchableGrant = SearchableGrant> = { grant: T; relevance: number };

export type DeadlineView = { text: string; iso: string | null; farFuture: boolean };

const PHRASE_GROUPS = new Map<string, readonly string[]>();
for (const group of RELATED_TERMS) for (const phrase of group) PHRASE_GROUPS.set(phrase, group);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/([a-z0-9])['’]s\b/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordForms(word: string): string[] {
  const forms = [word];
  if (word.length > 4 && word.endsWith('ies')) forms.push(word.slice(0, -3) + 'y');
  if (word.length > 4 && word.endsWith('es')) forms.push(word.slice(0, -2));
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) forms.push(word.slice(0, -1));
  return forms;
}

function sameToken(hay: string, needle: string): boolean {
  if (hay === needle) return true;
  const hayForms = new Set(wordForms(hay));
  return wordForms(needle).some(form => hayForms.has(form));
}

function canonicalPhrase(phrase: string): string | null {
  if (PHRASE_GROUPS.has(phrase)) return phrase;
  const parts = phrase.split(' ');
  const last = parts[parts.length - 1];
  for (const form of wordForms(last)) {
    if (form === last) continue;
    const candidate = [...parts.slice(0, -1), form].join(' ');
    if (PHRASE_GROUPS.has(candidate)) return candidate;
  }
  return null;
}

export function queryTerms(query: string): string[] {
  const words = normalizeText(query).split(' ').filter(word => word && !STOP_WORDS.has(word));
  const terms: string[] = [];
  let index = 0;
  while (index < words.length) {
    let matched = '';
    let size = 0;
    const max = Math.min(4, words.length - index);
    for (let length = max; length >= 1; length--) {
      const canonical = canonicalPhrase(words.slice(index, index + length).join(' '));
      if (canonical) {
        matched = canonical;
        size = length;
        break;
      }
    }
    if (size) terms.push(matched);
    else terms.push(words[index]);
    index += size || 1;
  }
  return [...new Set(terms)];
}

function containsPhrase(words: string[], phrase: string): boolean {
  const needle = phrase.split(' ');
  if (!needle.length || words.length < needle.length) return false;
  for (let start = 0; start <= words.length - needle.length; start++) {
    let found = true;
    for (let offset = 0; offset < needle.length; offset++) {
      const hay = words[start + offset];
      const expected = needle[offset];
      const matches = offset === needle.length - 1 ? sameToken(hay, expected) : hay === expected;
      if (!matches) {
        found = false;
        break;
      }
    }
    if (found) return true;
  }
  return false;
}

function grantFields(grant: SearchableGrant): Record<Field, string[]> {
  const text: Record<Field, string> = {
    title: normalizeText(grant.title || ''),
    funder: normalizeText(grant.funder || ''),
    description: normalizeText(grant.description || ''),
    tags: normalizeText((grant.tags || []).join(' ')),
    // Applicant category lists are not searched here. Federal notices often
    // include every category, so "small business" would match unrelated programs.
    eligibility: normalizeText((grant.requirements || []).join(' ')),
    location: normalizeText([...(grant.countries || []), ...(grant.states || [])].join(' ')),
  };
  return {
    title: text.title ? text.title.split(' ') : [],
    funder: text.funder ? text.funder.split(' ') : [],
    description: text.description ? text.description.split(' ') : [],
    tags: text.tags ? text.tags.split(' ') : [],
    eligibility: text.eligibility ? text.eligibility.split(' ') : [],
    location: text.location ? text.location.split(' ') : [],
  };
}

function scoreTerms(grant: SearchableGrant, terms: string[]): number {
  const fields = grantFields(grant);
  let total = 0;
  for (const term of terms) {
    const options = PHRASE_GROUPS.get(term) || [term];
    let termScore = 0;
    let matched = false;
    for (const field of Object.keys(FIELD_WEIGHT) as Field[]) {
      const words = fields[field];
      const exact = containsPhrase(words, term);
      const related = !exact && options.some(option => option !== term && containsPhrase(words, option));
      if (!exact && !related) continue;
      matched = true;
      termScore += FIELD_WEIGHT[field] * (exact ? 2 : 1);
    }
    if (!matched) return 0;
    total += termScore;
  }
  return total;
}

export function relevanceScore(grant: SearchableGrant, query: string): number {
  const terms = queryTerms(query);
  if (!terms.length) return 0;
  return scoreTerms(grant, terms);
}

export function searchGrants<T extends SearchableGrant>(grants: T[], query: string): SearchHit<T>[] {
  const terms = queryTerms(query);
  if (!terms.length) return grants.map(grant => ({ grant, relevance: 0 }));
  return grants
    .map(grant => ({ grant, relevance: scoreTerms(grant, terms) }))
    .filter(hit => hit.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.grant.title.localeCompare(b.grant.title) || a.grant.id.localeCompare(b.grant.id));
}

function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) return null;
  return day;
}

function shiftYears(day: string, years: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year + years, month - 1, date)).toISOString().slice(0, 10);
}

export function calendarDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isFarFutureDeadline(deadline: string | null | undefined, now = new Date()): boolean {
  const day = isoDay(deadline);
  if (!day) return false;
  return day > shiftYears(calendarDay(now), FAR_FUTURE_YEARS);
}

export function effectiveDeadline(deadline: string | null | undefined, now = new Date()): string | null {
  const day = isoDay(deadline);
  if (!day || isFarFutureDeadline(day, now)) return null;
  return day;
}

export function deadlineSortKey(deadline: string | null | undefined, now = new Date()): string {
  return effectiveDeadline(deadline, now) || '9999';
}

export function deadlineView(grant: { deadline: string | null; deadlineLabel?: string | null }, now = new Date(), fallback = 'Check provider'): DeadlineView {
  if (isFarFutureDeadline(grant.deadline, now)) return { text: 'No fixed deadline', iso: null, farFuture: true };
  const iso = effectiveDeadline(grant.deadline, now);
  if (iso) return { text: '', iso, farFuture: false };
  return { text: grant.deadlineLabel ? tidyDeadlineLabel(grant.deadlineLabel, 'See listing') : fallback, iso: null, farFuture: false };
}

export function isOpenGrant(grant: { status?: string | null; deadline: string | null }, now = new Date()): boolean {
  if (grant.status === 'Closed') return false;
  const deadline = effectiveDeadline(grant.deadline, now);
  if (!deadline) return true;
  return deadline >= calendarDay(now);
}

export function isRefreshStale(checkedAt: string | null | undefined, now = Date.now()): boolean {
  if (!checkedAt) return true;
  const parsed = Date.parse(checkedAt);
  if (!Number.isFinite(parsed)) return true;
  return now - parsed > STALE_AFTER_MS;
}

// Hours since the last refresh (one decimal, null when never refreshed or unparseable) and the 26-hour stale flag.
export function refreshFreshness(checkedAt: string | null | undefined, now = Date.now()): { stale: boolean; hoursSinceRefresh: number | null } {
  const parsed = checkedAt ? Date.parse(checkedAt) : NaN;
  const hoursSinceRefresh = Number.isFinite(parsed) ? Math.round(((now - parsed) / 3600000) * 10) / 10 : null;
  return { stale: isRefreshStale(checkedAt, now), hoursSinceRefresh };
}

export function formatLastUpdatedEt(checkedAt: string): string {
  const parsed = new Date(checkedAt);
  if (Number.isNaN(parsed.getTime())) return 'unavailable';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('month')} ${part('day')}, ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod')} ET`;
}
