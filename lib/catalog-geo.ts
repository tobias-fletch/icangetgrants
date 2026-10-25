// City/county metadata for catalog records. Pure module (no I/O at import, relative type imports only) so the
// dashboard, the MCP tools and the tests share one set of rules.
//
// Storage: the Grant JSON in catalog.data is the source of truth (grant.city / grant.county). Migration
// drizzle/0002_catalog_city_county.sql adds nullable catalog.city / catalog.county columns that mirror those
// fields for indexing. Mirroring is best-effort: if 0002 has not been applied yet, mirrorCatalogGeo() reports
// false and nothing else changes, so the app behaves exactly as before the migration.
import type { Grant } from './grants';
import type { D1Like } from './seo-store';

export const PLACE_MIN = 2, PLACE_MAX = 80;
// Letters (any script), combining marks, spaces, periods, apostrophes and hyphens; must start with a letter.
const PLACE_RE = /^\p{L}[\p{L}\p{M} .'\u2019-]*$/u;
const COUNTY_SUFFIX = /\b(?:county|parish|borough|census area|municipality|city and borough|municipio)$/i;

export class PlaceError extends Error {}

function tidy(value: string) { return value.normalize('NFC').replace(/\s+/g, ' ').trim(); }

/** Validate an optional city or county. undefined = not provided, null = explicitly none. Throws PlaceError. */
export function cleanPlace(value: unknown, field: 'city' | 'county'): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new PlaceError(`${field} must be a string or null.`);
  const v = tidy(value);
  if (v.length < PLACE_MIN || v.length > PLACE_MAX || !PLACE_RE.test(v)) throw new PlaceError(`${field} must be ${PLACE_MIN}-${PLACE_MAX} letters, spaces, periods, apostrophes or hyphens.`);
  if (field === 'county' && !COUNTY_SUFFIX.test(v)) return v + ' County';
  return v;
}

/** The record's city: explicit grant.city, else the single entry of grant.cities (older city leads). */
export function grantCity(g: Pick<Grant, 'city' | 'cities'>): string | null {
  if (typeof g.city === 'string' && g.city) return g.city;
  return g.cities?.length === 1 ? g.cities[0] : null;
}
export function grantCounty(g: Pick<Grant, 'county'>): string | null { return typeof g.county === 'string' && g.county ? g.county : null; }

/** Filter label: "Austin, Texas" — the state keeps same-named cities apart. */
export function placeLabel(place: string | null, g: Pick<Grant, 'states'>): string | null {
  if (!place) return null;
  const state = g.states?.length === 1 ? g.states[0] : '';
  return state ? `${place}, ${state}` : place;
}
export const cityLabel = (g: Grant) => placeLabel(grantCity(g), g);
export const countyLabel = (g: Grant) => placeLabel(grantCounty(g), g);

/** Sorted, de-duplicated city and county options for the dashboard filters. */
export function placeOptions(grants: Grant[]) {
  const uniq = (list: (string | null)[]) => [...new Set(list.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  return { cities: uniq(grants.map(cityLabel)), counties: uniq(grants.map(countyLabel)) };
}

/** '' (or 'all') means no filter. */
export function matchesPlace(g: Grant, city: string, county: string) {
  if (city && city !== 'all' && cityLabel(g) !== city) return false;
  if (county && county !== 'all' && countyLabel(g) !== county) return false;
  return true;
}

export const GEO_MIRROR_SQL = 'UPDATE catalog SET city = ?, county = ? WHERE id = ?';

/** Best-effort copy of grant.city/county into the 0002 columns. Returns false (never throws) when the columns are missing. */
export async function mirrorCatalogGeo(db: D1Like & { batch?: (s: unknown[]) => Promise<unknown> }, grants: Grant[]): Promise<boolean> {
  if (!grants.length) return true;
  try {
    const statements = grants.map(g => db.prepare(GEO_MIRROR_SQL).bind(grantCity(g), grantCounty(g), g.id));
    if (db.batch) { for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40)); }
    else for (const s of statements) await s.run();
    return true;
  } catch (e) {
    if (/no such column|has no column/i.test(e instanceof Error ? e.message : '')) return false;
    console.error('catalog geo mirror failed', e instanceof Error ? e.message : 'unknown');
    return false;
  }
}
