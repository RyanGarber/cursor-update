import { createHash } from "node:crypto";
import { chmod, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { response } from "./core/system.ts";

export const version = pkg.version;

/** Published with every release by release.yml. */
const MANIFEST =
	"https://github.com/ryangarber/sod-off/releases/latest/download/latest.json";

export interface Manifest {
	version: string;
	/** Release binaries by `<platform>-<arch>`, as published to the version's tag. */
	assets: Partial<Record<string, { url: string; sha256: string }>>;
}

/**
 * The compiled binary this process runs from, the only build that can replace
 * itself; one run from source runs out of `node` or `bun`, which is not ours to
 * replace.
 */
export function binary(): string | null {
	const name = basename(process.execPath, ".exe").toLowerCase();
	if (["node", "bun", "bun-debug", "deno"].includes(name)) return null;
	return process.execPath;
}

/** Whether one version is a release after another, by its numbers alone. */
export function isNewer(version: string, than: string): boolean {
	const numbers = (value: string) =>
		(value.split(/[-+]/)[0] ?? "")
			.split(".")
			.map((part) => Number.parseInt(part, 10) || 0);
	const a = numbers(version);
	const b = numbers(than);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const difference = (a[i] ?? 0) - (b[i] ?? 0);
		if (difference !== 0) return difference > 0;
	}
	return false;
}

/** The released manifest, if it is a release after the one running. */
export async function check(
	fetchManifest: () => Promise<Manifest> = async () =>
		(
			await response(MANIFEST, AbortSignal.timeout(5_000))
		).json() as Promise<Manifest>,
): Promise<Manifest | null> {
	const manifest = await fetchManifest();
	if (typeof manifest?.version !== "string")
		throw new Error("No version in latest.json");
	return isNewer(manifest.version, version) ? manifest : null;
}

/**
 * Replaces the binary with the release's. The download lands beside it so the
 * rename stays within one filesystem and swaps the file whole; the running
 * process keeps the file it started from, so the next run starts the new one.
 */
export async function install(
	manifest: Manifest,
	target: string,
	build = `${process.platform}-${process.arch}`,
): Promise<void> {
	const asset = manifest.assets[build];
	if (!asset)
		throw new Error(`No sod-off ${manifest.version} build for ${build}`);
	const path = await realpath(target);
	const download = `${path}.download`;
	const previous = `${path}.old`;
	try {
		const bytes = new Uint8Array(
			await (await response(asset.url)).arrayBuffer(),
		);
		const digest = createHash("sha256").update(bytes).digest("hex");
		if (digest !== asset.sha256.toLowerCase())
			throw new Error(`SHA-256 mismatch for ${asset.url}`);
		await writeFile(download, bytes);
		await chmod(download, (await stat(path)).mode);
		if (process.platform === "win32") {
			// A running executable cannot be replaced on Windows, but it can be
			// moved aside, and removed on a later start once nothing runs it.
			await rm(previous, { force: true });
			await rename(path, previous);
			try {
				await rename(download, path);
			} catch (error) {
				await rename(previous, path);
				throw error;
			}
		} else await rename(download, path);
	} catch (error) {
		await rm(download, { force: true }).catch(() => {});
		throw error;
	}
}

/** Removes what an interrupted or a Windows update left beside the binary. */
export async function cleanup(target: string): Promise<void> {
	const path = await realpath(target).catch(() => target);
	await rm(`${path}.download`, { force: true }).catch(() => {});
	await rm(`${path}.old`, { force: true }).catch(() => {});
}
