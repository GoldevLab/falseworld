#!/usr/bin/env node
/** Fail CI if meadow VRM essentials are missing from the tree. */
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const essentials = [
  "public/avatars/sophia.vrm",
  "public/animaciones/StandingIdle.fbx",
  "public/animaciones/Walking.fbx",
  "public/animaciones/FastRun.fbx",
];

const missing = [];
for (const rel of essentials) {
  try {
    await access(path.join(root, rel), constants.R_OK);
  } catch {
    missing.push(rel);
  }
}

if (missing.length) {
  console.error("Missing essential meadow assets:");
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    "These must be committed (see .gitignore allowlist) so Fly can serve them."
  );
  process.exit(1);
}

console.log("Essential meadow assets OK:");
for (const rel of essentials) console.log(`  ✓ ${rel}`);
