// Bundles the modular ES sources under `static/client/src/*/entry.js` back
// into the single-file bundles that `src/main.rs` serves via
// `client_asset!(include_bytes!(...))`. Content-digest cache busting (see
// `resuma::client::client_asset`) means the output filename never changes —
// only the id's `?v=<hash>` query string does, once you rerun this build and
// restart the server.
//
// Why bundle to one file per client asset instead of serving ES modules
// directly: `client_asset` embeds bytes at compile time (`include_bytes!`),
// so Resuma has no dev-time static file server for a whole module graph —
// simplest to keep shipping one file per asset and do the module graph work
// at build time instead, same trade-off most bundlers make for library code.
import { build, context } from "esbuild";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = "static/client/src";
const OUT_DIR = "static/client";
const watch = process.argv.includes("--watch");

function findEntries() {
  const entries = [];
  for (const name of readdirSync(SRC_ROOT)) {
    const dir = path.join(SRC_ROOT, name);
    if (!statSync(dir).isDirectory()) continue;
    const entry = path.join(dir, "entry.js");
    try {
      statSync(entry);
      entries.push({ name, entry });
    } catch {
      // No entry.js in this dir — not a bundle target, skip.
    }
  }
  return entries;
}

const entries = findEntries();
if (!entries.length) {
  console.error(`No */entry.js found under ${SRC_ROOT}`);
  process.exit(1);
}

const commonOptions = {
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  legalComments: "none",
  loader: { ".wgsl": "text" },
};

async function run() {
  for (const { name, entry } of entries) {
    const outfile = path.join(OUT_DIR, `${name}.js`);
    const options = { ...commonOptions, entryPoints: [entry], outfile };
    if (watch) {
      const ctx = await context(options);
      await ctx.watch();
      console.log(`Watching ${entry} -> ${outfile}`);
    } else {
      await build(options);
      console.log(`Built ${entry} -> ${outfile}`);
    }
  }
  if (!watch) {
    console.log(`\n${entries.length} bundle(s) built. Restart the dev server to pick up new content hashes.`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
