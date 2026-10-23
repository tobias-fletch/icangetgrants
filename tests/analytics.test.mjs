import assert from "node:assert/strict";
import test from "node:test";
import {
  CF_ANALYTICS_TOKEN,
  GOOGLE_SITE_VERIFICATION,
  ANALYTICS_PRIVACY_LINE,
  analyticsPrivacyLine,
  cloudflareBeaconAttributes,
  validSiteVerification,
} from "../lib/analytics.ts";

test("nothing renders while no token or verification value is configured", () => {
  assert.equal(CF_ANALYTICS_TOKEN, "");
  assert.equal(GOOGLE_SITE_VERIFICATION, "");
  assert.equal(cloudflareBeaconAttributes(), null);
  assert.equal(validSiteVerification(GOOGLE_SITE_VERIFICATION), null);
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
  assert.equal(analyticsPrivacyLine(), null);
  assert.equal(analyticsPrivacyLine("short"), null);
  assert.equal(analyticsPrivacyLine("0123456789abcdef0123456789abcdef"), ANALYTICS_PRIVACY_LINE);
  assert.equal(
    ANALYTICS_PRIVACY_LINE,
    "We count visits with Cloudflare Web Analytics, which uses no cookies and doesn’t track you across sites.",
  );
});
