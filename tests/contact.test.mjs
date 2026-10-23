import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CONTACT_RELAY_URL, contactError, contactPayload } from "../lib/contact.ts";

const ok = { name: "Ada", email: "ada@example.com", message: "Could you add our state's arts grants?", honeypot: "" };

test("the contact form posts to the shared relay as icangetgrants", () => {
  assert.equal(CONTACT_RELAY_URL, "https://tobiasfletcher.com/api/contact");
  const payload = contactPayload({ ...ok, name: "  Ada  " }, 123);
  assert.deepEqual(Object.keys(payload).sort(), ["email", "honeypot", "message", "name", "page", "site", "startedAt"]);
  assert.equal(payload.site, "icangetgrants");
  assert.equal(payload.name, "Ada");
  assert.equal(payload.startedAt, 123);
  assert.equal(payload.page, "/contact");
});

test("contact validation matches the relay limits", () => {
  assert.equal(contactError(ok), null);
  assert.match(contactError({ ...ok, name: " " }), /name/);
  assert.match(contactError({ ...ok, email: "nope" }), /email/);
  assert.match(contactError({ ...ok, message: "short" }), /10 characters/);
  assert.match(contactError({ ...ok, message: "x".repeat(5001) }), /5,000/);
});

test("footers link to /contact, the page is in the sitemap, and copy stays on brand", () => {
  for (const file of ["app/dashboard.tsx", "components/legal-page.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /href="\/contact"/, file);
  }
  assert.match(readFileSync("app/sitemap.ts", "utf8"), /path: "\/contact"/);
  for (const file of ["app/contact/page.tsx", "components/contact-form.tsx", "lib/contact.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /grantos|grantwell/i, file);
  }
});
