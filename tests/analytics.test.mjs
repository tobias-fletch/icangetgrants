import assert from "node:assert/strict";
import test from "node:test";
import {
  CF_ANALYTICS_TOKEN,
  GOOGLE_SITE_VERIFICATION,
  ANALYTICS_PRIVACY_LINE,
  analyticsPrivacyLine,
  cloudflareBeaconAttributes,
  excludedLibrariesPhrase,
  validSiteVerification,
} from "../lib/analytics.ts";

test("the icangetgrants.com Cloudflare token is configured, so the cookieless beacon ships", () => {
  assert.equal(CF_ANALYTICS_TOKEN, "641ab131ef6442d5911c1881c5fe7d65");
  assert.deepEqual(cloudflareBeaconAttributes(), {
    defer: true,
    src: "https://static.cloudflareinsights.com/beacon.min.js",
    "data-cf-beacon": '{"token":"641ab131ef6442d5911c1881c5fe7d65"}',
  });
  assert.equal(cloudflareBeaconAttributes(""), null);
});

test("the icangetgrants.com Search Console verification value is configured and valid", () => {
  assert.equal(GOOGLE_SITE_VERIFICATION, "u3x-wOrf_imKdhDSSEKkmc67G5m1Cddn1F2xHGLnKDo");
  assert.equal(validSiteVerification(GOOGLE_SITE_VERIFICATION), GOOGLE_SITE_VERIFICATION);
  assert.equal(validSiteVerification(""), null);
});

test("malformed values are rejected", () => {
  assert.equal(cloudflareBeaconAttributes('abc"><script>'), null);
  assert.equal(cloudflareBeaconAttributes("short"), null);
  assert.equal(validSiteVerification('x" onload="y'), null);
});

test("a configured token produces the cookieless Cloudflare beacon", () => {
  assert.deepEqual(cloudflareBeaconAttributes("0123456789abcdef0123456789abcdef"), {
    defer: true,
    src: "https://static.cloudflareinsights.com/beacon.min.js",
    "data-cf-beacon": '{"token":"0123456789abcdef0123456789abcdef"}',
  });
  assert.equal(validSiteVerification("AbC-123_xyzAbC-123_xyz"), "AbC-123_xyzAbC-123_xyz");
});

test("the privacy-page analytics line ships only with a valid token", () => {
  assert.equal(analyticsPrivacyLine(), ANALYTICS_PRIVACY_LINE);
  assert.equal(analyticsPrivacyLine(""), null);
  assert.equal(analyticsPrivacyLine("short"), null);
  assert.equal(analyticsPrivacyLine("0123456789abcdef0123456789abcdef"), ANALYTICS_PRIVACY_LINE);
  assert.equal(
    ANALYTICS_PRIVACY_LINE,
    "We count visits with Cloudflare Web Analytics, which uses no cookies and doesn’t track you across sites.",
  );
});

test("the privacy page drops 'or analytics' only when the beacon ships", () => {
  assert.equal(excludedLibrariesPhrase(), "an advertising library");
  assert.equal(excludedLibrariesPhrase(""), "an advertising or analytics library");
  assert.equal(excludedLibrariesPhrase("short"), "an advertising or analytics library");
  assert.equal(excludedLibrariesPhrase('abc"><script>'), "an advertising or analytics library");
  assert.equal(excludedLibrariesPhrase("0123456789abcdef0123456789abcdef"), "an advertising library");
  // Both privacy-page states follow the same validity check as the beacon tag.
  for (const value of ["", "short", "0123456789abcdef0123456789abcdef"]) {
    const ships = cloudflareBeaconAttributes(value) !== null;
    assert.equal(analyticsPrivacyLine(value) !== null, ships);
    assert.equal(excludedLibrariesPhrase(value) === "an advertising library", ships);
  }
});
