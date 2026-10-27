import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/not-found.tsx", import.meta.url), "utf8");

test("root 404 has its own title in the site format", () => {
  assert.match(src, /title:\s*"Page not found — I Can Get Grants"/);
});

test("404 copy never uses the old product name", () => {
  assert.doesNotMatch(src, /GrantOS/i);
});
