import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PLACEHOLDER_CLIENT_ID, PROBE_STATE_COOKIE, PROBE_RT_COOKIE, buildAuthUrl, callbackUrl, handleCallback,
  handleProbe, handleStart, idTokenClaims, oaiHeaderNames, probeEnabled, readCookie, safeEqual,
} from "../lib/google-probe.ts";

const PREVIEW = "https://preview-abc.example/auth/google/start";
const noProc = {};
const fakeJwt = (claims) => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

test("flag: production hosts off by default, previews on, explicit flag wins", () => {
  assert.equal(probeEnabled("https://icangetgrants.com/auth/probe", {}, noProc), false);
  assert.equal(probeEnabled("https://www.icangetgrants.com/auth/probe", {}, noProc), false);
  assert.equal(probeEnabled("https://preview-abc.example/auth/probe", {}, noProc), true);
  assert.equal(probeEnabled("http://localhost:5173/auth/probe", {}, noProc), true);
  assert.equal(probeEnabled("https://preview-abc.example/auth/probe", { GOOGLE_SIGNIN_PROBE: "0" }, noProc), false);
  assert.equal(probeEnabled("https://icangetgrants.com/auth/probe", { GOOGLE_SIGNIN_PROBE: "1" }, noProc), true);
});

test("disabled on production: all three routes 404", async () => {
  for (const h of [handleStart, handleCallback, handleProbe]) {
    const res = await h(new Request("https://icangetgrants.com/auth/x"), {});
    assert.equal(res.status, 404);
  }
});

test("start redirects to Google with placeholder client id, https callback, scopes and state cookie", async () => {
  const res = await handleStart(new Request(PREVIEW), {});
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(loc.searchParams.get("client_id"), PLACEHOLDER_CLIENT_ID);
  assert.equal(loc.searchParams.get("redirect_uri"), "https://preview-abc.example/auth/google/callback");
  assert.equal(loc.searchParams.get("scope"), "openid email profile");
  assert.equal(loc.searchParams.get("response_type"), "code");
  const state = loc.searchParams.get("state");
  assert.ok(state && state.length >= 32);
  const cookie = res.headers.get("set-cookie");
  assert.match(cookie, new RegExp(`^${PROBE_STATE_COOKIE}=${state};`));
  for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600", "Path=/"]) assert.ok(cookie.includes(attr), attr);
});

test("start uses GOOGLE_CLIENT_ID from env when set", async () => {
  const res = await handleStart(new Request(PREVIEW), { GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com" });
  assert.equal(new URL(res.headers.get("location")).searchParams.get("client_id"), "abc.apps.googleusercontent.com");
});

test("callbackUrl is https on the request host, http only for loopback dev", () => {
  assert.equal(callbackUrl("http://localhost:3000/auth/google/start"), "http://localhost:3000/auth/google/callback");
  assert.equal(callbackUrl("http://preview.example/auth/google/start"), "https://preview.example/auth/google/callback");
  assert.equal(callbackUrl("https://icangetgrants.com/auth/google/start"), "https://icangetgrants.com/auth/google/callback");
  assert.ok(buildAuthUrl("id", "https://h/cb", "s").includes("scope=openid+email+profile"));
});

test("callback: state mismatch and missing cookie skip exchange", async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response("{}"); };
  const res = await handleCallback(new Request("https://preview-abc.example/auth/google/callback?state=x&code=c"), {}, fetcher);
  const body = await res.json();
  assert.deepEqual([body.cookieReceived, body.stateMatched, body.codePresent], [false, false, true]);
  assert.match(body.tokenExchange, /state mismatch/);
  assert.equal(called, false);
});

test("callback: matched state but no secrets skips exchange", async () => {
  const req = new Request("https://preview-abc.example/auth/google/callback?state=s123&code=c", { headers: { cookie: `${PROBE_STATE_COOKIE}=s123` } });
  const body = await (await handleCallback(req, {}, async () => { throw new Error("no"); })).json();
  assert.equal(body.stateMatched, true);
  assert.match(body.tokenExchange, /secrets not configured/);
});

test("callback: exchanges code, returns only sub/email, never tokens or secrets", async () => {
  let sent;
  const fetcher = async (url, init) => {
    sent = { url, body: new URLSearchParams(init.body) };
    return Response.json({ access_token: "AT-SECRET", id_token: fakeJwt({ sub: "1234", email: "a@b.com", name: "X" }), refresh_token: "RT" });
  };
  const req = new Request("https://preview-abc.example/auth/google/callback?state=s123&code=thecode", { headers: { cookie: `${PROBE_STATE_COOKIE}=s123` } });
  const res = await handleCallback(req, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret" }, fetcher);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(sent.url, "https://oauth2.googleapis.com/token");
  assert.equal(sent.body.get("code"), "thecode");
  assert.equal(sent.body.get("redirect_uri"), "https://preview-abc.example/auth/google/callback");
  assert.equal(body.tokenExchange, 200);
  assert.equal(body.sub, "1234");
  assert.equal(body.email, "a@b.com");
  for (const leak of ["AT-SECRET", "RT", "csecret", "thecode", "eyJ", "e30"]) assert.ok(!text.includes(leak), leak);
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
});

test("probe reports booleans, header names only, discovery status, sets round-trip cookie", async () => {
  const headers = { "oai-authenticated-user-id": "SECRETID", "oai-authenticated-user-email": "x@y.z", cookie: `${PROBE_RT_COOKIE}=abc` };
  const fetcher = async () => Response.json({ issuer: "https://accounts.google.com" });
  const res = await handleProbe(new Request("https://preview-abc.example/auth/probe", { headers }), { GOOGLE_CLIENT_ID: "cid" }, fetcher);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.googleClientIdPresent, true);
  assert.equal(body.googleClientSecretPresent, false);
  assert.equal(body.testCookie.received, true);
  assert.deepEqual(body.googleDiscoveryFetch, { ok: true, status: 200, issuer: "https://accounts.google.com" });
  assert.deepEqual(body.oaiAuthenticatedHeadersPresent, ["oai-authenticated-user-email", "oai-authenticated-user-id"]);
  assert.ok(!text.includes("SECRETID") && !text.includes("x@y.z") && !text.includes('"cid"'));
  assert.match(res.headers.get("set-cookie"), new RegExp(`^${PROBE_RT_COOKIE}=`));
});

test("helpers", () => {
  assert.equal(readCookie("a=1; b=2", "b"), "2");
  assert.equal(readCookie(null, "b"), undefined);
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual(undefined, undefined), false);
  assert.deepEqual(idTokenClaims("garbage"), {});
  assert.deepEqual(oaiHeaderNames(new Headers({ "x-other": "1" })), []);
});

test("isolation: probe files import nothing from ChatGPT auth, owner access or the DB", () => {
  const files = ["../lib/google-probe.ts", "../app/auth/probe-env.ts", "../app/auth/probe/route.ts", "../app/auth/google/start/route.ts", "../app/auth/google/callback/route.ts"];
  for (const f of files) {
    const imports = readFileSync(new URL(f, import.meta.url), "utf8").split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
    for (const forbidden of ["chatgpt-auth", "lib/access", "lib/admin", "@/db", "discovery"]) assert.ok(!imports.includes(forbidden), `${f} imports ${forbidden}`);
  }
  const src = readFileSync(new URL("../lib/google-probe.ts", import.meta.url), "utf8");
  for (const forbidden of ["isOwner", "OWNER_USER_ID", "getDb", "getChatGPTUser"]) assert.ok(!src.includes(forbidden), forbidden);
});
