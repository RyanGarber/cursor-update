/**
 * Compiles sod-off for the given targets (the host's by default) into dist/,
 * optionally with the latest.json every installed sod-off checks
 * (src/update.ts); needs `bun` on PATH.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	choice,
	flag,
	map,
	merge,
	message,
	multiple,
	object,
	option,
	url,
	values,
	withDefault,
} from "@optique/core";
import { path, print, run } from "@optique/run";
import packageJson from "../package.json" with { type: "json" };
import { currentArchitecture, currentPlatform } from "../src/core/system.ts";
import type { Manifest } from "../src/update.ts";

const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const dist = fileURLToPath(new URL("../dist", import.meta.url));

const TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-arm64",
	"win32-x64",
] as const;
type Target = (typeof TARGETS)[number];

function artifactOf(target: Target) {
	return `sod-off-${target}${target.startsWith("win32-") ? ".exe" : ""}`;
}

const parser = merge(
	withDefault(
		object({
			manifest: flag("--manifest", "-m"),
			manifestUrl: withDefault(
				option("--manifest-url", url()),
				`${packageJson.repository.url.replace(".git", "")}/releases/download/v${packageJson.version}`,
			),
			manifestFile: withDefault(
				option("--manifest-file", path()),
				`latest.json`,
			),
		}),
		{ manifest: false } as const,
	),
	object({
		targets: map(
			multiple(
				option(
					"--target",
					"-t",
					choice([...TARGETS, "all", "current"] as const),
				),
			),
			(targets): Target[] => {
				if (targets.length === 0 || targets.includes("current")) {
					const platform = currentPlatform();
					const architecture = currentArchitecture();
					return [`${platform}-${architecture}`] as const;
				}
				if (targets.includes("all")) {
					return [...TARGETS];
				}
				return [...targets] as Target[];
			},
		),
		out: withDefault(option("--out", "-o", path()), dist),
	}),
);

if (import.meta.main) {
	const { targets, out, ...options } = run(parser);

	print(message`starting build for ${values(targets)}`);

	// build binaries
	const host = `${currentPlatform()}-${currentArchitecture()}`;
	for (const target of targets) {
		const outfile = join(out, artifactOf(target));
		execFileSync(
			"bun",
			[
				"build",
				main,
				"--compile",
				`--target=bun-${target.replace("win32", "windows")}`,
				`--outfile=${outfile}`,
			],
			{ stdio: "inherit" },
		);
		// Apple Silicon only runs signed binaries; an ad hoc signature will do.
		if (target.startsWith("darwin-") && process.platform === "darwin") {
			execFileSync("codesign", ["--force", "--sign", "-", outfile], {
				stdio: "inherit",
			});
		}
		if (process.platform !== "win32") {
			execFileSync("file", [outfile], { stdio: "inherit" });
		}
		// Only a native build can run here.
		if (target === host) {
			execFileSync(outfile, ["--version"], { stdio: "inherit" });
		}
	}

	// build manifest
	if (options.manifest) {
		print(message`writing manifest to ${join(out, options.manifestFile)}`);
		const manifest: Manifest = { version: packageJson.version, assets: {} };
		for (const target of targets) {
			manifest.assets[target] = {
				url: `${options.manifestUrl}/${artifactOf(target)}`,
				sha256: createHash("sha256")
					.update(await readFile(join(out, artifactOf(target))))
					.digest("hex"),
			};
			print(
				message`- ${target} -> ${manifest.assets[target].url} [${manifest.assets[target].sha256.slice(0, 8)}]`,
			);
		}
		await writeFile(
			join(out, options.manifestFile),
			JSON.stringify(manifest, null, "\t"),
		);
	}

	print(message`done`);
}
