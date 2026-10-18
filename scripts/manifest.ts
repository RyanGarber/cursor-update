#!/usr/bin/env bun
/**
 * Writes the latest.json every installed sod-off checks (src/update.ts):
 * `bun scripts/manifest.ts <version> <release download URL>`.
 */
import type { Manifest } from "../src/update.ts";
import { asset, builds } from "./build.ts";

const [version, base] = process.argv.slice(2);
if (!version || !base)
	throw new Error("Usage: manifest.ts <version> <download URL>");
const manifest: Manifest = { version, assets: {} };
for (const build of builds) {
	const bytes = await Bun.file(`dist/${asset(build)}`).bytes();
	manifest.assets[build] = {
		url: `${base}/${asset(build)}`,
		sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
	};
}
console.log(JSON.stringify(manifest, null, "\t"));
