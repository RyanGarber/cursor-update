/**
 * Writes the latest.json every installed sod-off checks (src/update.ts):
 * `node scripts/manifest.ts <version> <release download URL>`.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Manifest } from "../src/update.ts";
import { asset, builds } from "./builds.ts";

const [version, base] = process.argv.slice(2);
if (!version || !base)
	throw new Error("Usage: manifest.ts <version> <download URL>");
const manifest: Manifest = { version, assets: {} };
for (const build of builds)
	manifest.assets[build] = {
		url: `${base}/${asset(build)}`,
		sha256: createHash("sha256")
			.update(await readFile(`dist/${asset(build)}`))
			.digest("hex"),
	};
console.log(JSON.stringify(manifest, null, "\t"));
