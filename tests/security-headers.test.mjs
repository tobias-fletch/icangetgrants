import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lib = readFileSync(new URL("../lib/security-headers.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const headersFile = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

const csp = lib
  .split("CONTENT_SECURITY_POLICY_REPORT_ONLY = [")[1]
  .split("].join")[0]
  .match(/^\s+"([^"]+)",$/gm)
  .map((line) => line.trim().slice(1, -2))
  .join("; ");

const fileHeaders = Object.fromEntries(
  headersFile
    .split("\n/*\n")[1]
    .split("\n")
    .filter((line) => /^\s+\S+:/.test(line))
    .map((line) => {
      const [name, ...rest] = line.trim().split(": ");
      return [name, rest.join(": ")];
    }),
);

test("HSTS matches the other sites: 1 day, no includeSubDomains, no preload", () => {
  assert.match(lib, /"Strict-Transport-Security": "max-age=86400"/);
  assert.equal(fileHeaders["Strict-Transport-Security"], "max-age=86400");
  assert.doesNotMatch(Object.values(fileHeaders).join("\n"), /includeSubDomains|preload/i);
  assert.doesNotMatch(lib.match(/"Strict-Transport-Security": "[^"]*"/)[0], /includeSubDomains|preload/i);
});

test("CSP is report-only (never an enforcing Content-Security-Policy header)", () => {
  assert.match(lib, /"Content-Security-Policy-Report-Only":/);
  assert.doesNotMatch(lib, /"Content-Security-Policy":/);
  assert.doesNotMatch(headersFile, /^\s+Content-Security-Policy:/m);
});

test("CSP allows the analytics beacon and the contact relay, and keeps the base rules", () => {
  assert.match(csp, /script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/cloudflareinsights\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/tobiasfletcher\.com/);
  for (const rule of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"]) {
    assert.ok(csp.includes(rule), rule);
  }
});

test("public/_headers carries the same values as lib/security-headers.ts", () => {
  assert.equal(fileHeaders["Content-Security-Policy-Report-Only"], csp);
  for (const name of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"]) {
    const value = lib.match(new RegExp(`"${name}":\\s*"([^"]+)"`))[1];
    assert.equal(fileHeaders[name], value, name);
  }
});

test("public/_headers keeps vinext's immutable cache rule for hashed assets", () => {
  assert.match(headersFile, /\/_next\/static\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
});

test("proxy.ts wraps every response it returns", () => {
  assert.match(proxy, /return withSecurityHeaders\(await route\(request\)\);/);
  assert.doesNotMatch(proxy, /export const config/); // no matcher: the proxy runs on every route
});

test("no old product name", () => {
  assert.doesNotMatch(lib + headersFile, /GrantOS/i);
});
