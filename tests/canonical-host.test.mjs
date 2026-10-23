import assert from "node:assert/strict";
import test from "node:test";
import { apexRedirectLocation, normalizeRequestHost } from "../lib/site.ts";

test("host normalization ignores case, port, and a trailing dot", () => {
  assert.equal(normalizeRequestHost("WWW.icangetgrants.com:443"), "www.icangetgrants.com");
  assert.equal(normalizeRequestHost("www.icangetgrants.com."), "www.icangetgrants.com");
  assert.equal(normalizeRequestHost("www.icangetgrants.com.evil.example"), "www.icangetgrants.com.evil.example");
  assert.equal(normalizeRequestHost(null), "");
});

test("only the www host redirects, preserving path and query", () => {
  assert.equal(
    apexRedirectLocation("www.icangetgrants.com", "/privacy", "?q=student+aid&next=%2Fterms"),
    "https://icangetgrants.com/privacy?q=student+aid&next=%2Fterms",
  );
  assert.equal(apexRedirectLocation("www.icangetgrants.com:443", "/", ""), "https://icangetgrants.com/");
  assert.equal(apexRedirectLocation("icangetgrants.com", "/privacy", "?q=1"), null);
  assert.equal(apexRedirectLocation("localhost:5173", "/", ""), null);
  assert.equal(apexRedirectLocation("preview.example", "/privacy", ""), null);
  assert.equal(apexRedirectLocation("www.icangetgrants.com.evil.example", "/privacy", ""), null);
  assert.equal(apexRedirectLocation("notwww.icangetgrants.com", "/", ""), null);
});

test("a protocol-relative path cannot leave the apex origin", () => {
  assert.equal(apexRedirectLocation("www.icangetgrants.com", "//evil.example", ""), "https://icangetgrants.com/");
  assert.equal(apexRedirectLocation("www.icangetgrants.com", "/\\evil.example", "?x=1"), "https://icangetgrants.com/");
});
