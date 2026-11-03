// The image is built from an allowlist (.dockerignore: everything is left out unless listed). A source file missing
// from it is silently absent from the image: instrumentation.ts once was, and telemetry never started in Azure.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("..", import.meta.url);
const allowed = readFileSync(new URL(".dockerignore", root), "utf8").split("\n")
  .filter((line) => line.startsWith("!")).map((line) => line.slice(1));

test("the Docker build context holds every TypeScript file and source folder at the root", () => {
  const sources = readdirSync(root, { withFileTypes: true })
    .filter((entry) => (entry.isFile() && entry.name.endsWith(".ts")) || ["app", "lib"].includes(entry.name))
    .map((entry) => entry.name);
  assert.ok(sources.includes("instrumentation.ts"));
  assert.deepEqual(sources.filter((name) => !allowed.includes(name)), []);
});
