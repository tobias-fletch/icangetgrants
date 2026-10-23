// Google sign-in FEASIBILITY PROBE. Branch test/google-signin-probe only.
// DO NOT MERGE. Isolated from app/chatgpt-auth.ts, lib/access.ts and owner checks:
// nothing here reads or writes workspaces, identities or owner state.

export const PROBE_STATE_COOKIE = "__Host-icgg_google_probe_state";
export const PROBE_RT_COOKIE = "__Host-icgg_probe_rt";
export const PLACEHOLDER_CLIENT_ID = "probe-not-configured";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
export const PRODUCTION_HOSTS = new Set(["icangetgrants.com", "www.icangetgrants.com"]);
const STATE_MAX_AGE = 600;

export type ProbeEnv = Record<string, unknown> | undefined;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Reads a value from the Worker env binding first, then process.env. */
export function readVar(name: string, workerEnv: ProbeEnv, procEnv: ProbeEnv = typeof process !== "undefined" ? (process.env as ProbeEnv) : undefined): string | undefined {
  return str(workerEnv?.[name]) ?? str(procEnv?.[name]);
}

export function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

/**
 * Flag: GOOGLE_SIGNIN_PROBE=1 enables everywhere; =0 disables everywhere.
 * Unset: enabled on non-production hosts (localhost, Sites previews), disabled on
 * icangetgrants.com / www so production never exposes the probe.
 */
export function probeEnabled(requestUrl: string, workerEnv: ProbeEnv, procEnv?: ProbeEnv): boolean {
  const flag = readVar("GOOGLE_SIGNIN_PROBE", workerEnv, procEnv);
  if (flag === "0") return false;
  if (flag === "1") return true;
  return !PRODUCTION_HOSTS.has(hostOf(requestUrl));
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https://<host>/auth/google/callback; loopback dev hosts keep http (Google allows http only for loopback). */
export function callbackUrl(requestUrl: string): string {
  const u = new URL(requestUrl);
  const scheme = LOOPBACK.has(u.hostname) && u.protocol === "http:" ? "http" : "https";
  return `${scheme}://${u.host}/auth/google/callback`;
}

export function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export function stateCookie(state: string): string {
  return `${PROBE_STATE_COOKIE}=${state}; Path=/; Max-Age=${STATE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearStateCookie(): string {
  return `${PROBE_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Constant-time-ish comparison for short state strings. */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Decodes id_token payload and returns only sub/email. Token came straight from Google over TLS. */
export function idTokenClaims(idToken: unknown): { sub?: string; email?: string } {
  if (typeof idToken !== "string") return {};
  const parts = idToken.split(".");
  if (parts.length !== 3) return {};
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return {
      ...(typeof json.sub === "string" ? { sub: json.sub } : {}),
      ...(typeof json.email === "string" ? { email: json.email } : {}),
    };
  } catch {
    return {};
  }
}

export function oaiHeaderNames(headers: Headers): string[] {
  const names: string[] = [];
  headers.forEach((_v, k) => {
    if (k.toLowerCase().startsWith("oai-authenticated-")) names.push(k.toLowerCase());
  });
  return names.sort();
}

export const noStore = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export function disabledResponse(): Response {
  return new Response("Not found", { status: 404, headers: noStore });
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function handleStart(request: Request, workerEnv: ProbeEnv): Promise<Response> {
  if (!probeEnabled(request.url, workerEnv)) return disabledResponse();
  const clientId = readVar("GOOGLE_CLIENT_ID", workerEnv) ?? PLACEHOLDER_CLIENT_ID;
  const state = randomState();
  const headers = new Headers(noStore);
  headers.set("Location", buildAuthUrl(clientId, callbackUrl(request.url), state));
  headers.append("Set-Cookie", stateCookie(state));
  return new Response(null, { status: 302, headers });
}

export async function handleCallback(request: Request, workerEnv: ProbeEnv, fetcher: Fetcher = fetch): Promise<Response> {
  if (!probeEnabled(request.url, workerEnv)) return disabledResponse();
  const url = new URL(request.url);
  const cookieState = readCookie(request.headers.get("cookie"), PROBE_STATE_COOKIE);
  const queryState = url.searchParams.get("state") ?? undefined;
  const code = url.searchParams.get("code");
  const stateMatched = safeEqual(cookieState, queryState);
  const clientId = readVar("GOOGLE_CLIENT_ID", workerEnv);
  const clientSecret = readVar("GOOGLE_CLIENT_SECRET", workerEnv);
  const out: Record<string, unknown> = {
    probe: "google-signin-feasibility",
    cookieReceived: !!cookieState,
    stateMatched,
    codePresent: !!code,
    googleError: url.searchParams.get("error") ?? undefined,
    tokenExchange: "skipped",
  };
  if (!stateMatched) out.tokenExchange = "skipped: state mismatch";
  else if (!code) out.tokenExchange = "skipped: no code";
  else if (!clientId || !clientSecret) out.tokenExchange = "skipped: secrets not configured";
  else {
    try {
      const res = await fetcher(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl(request.url),
          grant_type: "authorization_code",
        }).toString(),
      });
      out.tokenExchange = res.status;
      if (res.ok) {
        const body = (await res.json()) as { id_token?: unknown };
        Object.assign(out, idTokenClaims(body.id_token));
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        if (typeof body.error === "string") out.tokenError = body.error;
      }
    } catch (e) {
      out.tokenExchange = "fetch failed: " + (e instanceof Error ? e.name : "error");
    }
  }
  const headers = new Headers(noStore);
  headers.set("Content-Type", "application/json");
  headers.append("Set-Cookie", clearStateCookie());
  return new Response(JSON.stringify(out, null, 2), { status: 200, headers });
}

export async function handleProbe(request: Request, workerEnv: ProbeEnv, fetcher: Fetcher = fetch): Promise<Response> {
  if (!probeEnabled(request.url, workerEnv)) return disabledResponse();
  const prior = readCookie(request.headers.get("cookie"), PROBE_RT_COOKIE);
  let discovery: Record<string, unknown>;
  try {
    const res = await fetcher(GOOGLE_DISCOVERY_URL, { headers: { Accept: "application/json" } });
    let issuer: unknown;
    if (res.ok) issuer = ((await res.json().catch(() => ({}))) as { issuer?: unknown }).issuer;
    discovery = { ok: res.ok, status: res.status, ...(typeof issuer === "string" ? { issuer } : {}) };
  } catch (e) {
    discovery = { ok: false, error: e instanceof Error ? e.name : "error" };
  }
  const out = {
    probe: "google-signin-feasibility",
    host: new URL(request.url).host,
    googleClientIdPresent: !!readVar("GOOGLE_CLIENT_ID", workerEnv),
    googleClientSecretPresent: !!readVar("GOOGLE_CLIENT_SECRET", workerEnv),
    testCookie: {
      received: !!prior,
      note: prior ? "Cookie set by a previous /auth/probe response came back." : "No probe cookie yet; reload /auth/probe to test the round trip.",
    },
    googleDiscoveryFetch: discovery,
    oaiAuthenticatedHeadersPresent: oaiHeaderNames(request.headers),
  };
  const headers = new Headers(noStore);
  headers.set("Content-Type", "application/json");
  headers.append("Set-Cookie", `${PROBE_RT_COOKIE}=${randomState()}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  return new Response(JSON.stringify(out, null, 2), { status: 200, headers });
}
