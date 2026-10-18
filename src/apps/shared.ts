import { lstat, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { children, exists, plist, which } from "../core/system.ts";
import type { AppContext, CleanupTarget, Installation } from "../core/types.ts";

export async function bundle(
	ctx: AppContext,
	names: string[],
	expectedIds: readonly string[],
): Promise<Installation | null> {
	const paths = ctx.appPath
		? [ctx.appPath]
		: names.flatMap((name) => [
				join("/Applications", name),
				join(ctx.home, "Applications", name),
			]);
	for (const path of paths)
		if (await exists(path)) {
			const payload = await realpath(path);
			const bundleId = await plist(ctx, payload, "CFBundleIdentifier");
			if (!expectedIds.includes(bundleId))
				throw new Error(`Unexpected application at ${path}: ${bundleId}`);
			return {
				path,
				payload,
				kind: "bundle",
				version: await plist(ctx, payload, "CFBundleShortVersionString"),
				bundleId,
			};
		}
	return null;
}
/**
 * The first launcher found on PATH or in ~/.local/bin, trying each name in
 * turn; with `accept`, only one whose payload it accepts.
 */
export async function cli(
	ctx: AppContext,
	executables: string | string[],
	accept: (payload: string) => boolean = () => true,
): Promise<Installation | null> {
	const names = typeof executables === "string" ? [executables] : executables;
	let path = ctx.appPath;
	for (const name of names) {
		if (path) break;
		for (const candidate of [
			await which(name),
			join(ctx.home, ".local/bin", name),
		])
			if (
				candidate &&
				(await exists(candidate)) &&
				accept(await realpath(candidate).catch(() => ""))
			) {
				path = candidate;
				break;
			}
	}
	if (!path || !(await exists(path))) return null;
	const executable = basename(path);
	const payload = await realpath(path);
	const output = await ctx.command([path, "--version"]);
	const version = output.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];
	if (!version)
		throw new Error(`Unrecognized ${executable} version: ${output}`);
	return { path, payload, version, kind: "cli" };
}
export async function caches(
	ctx: AppContext,
	relative: string[],
): Promise<CleanupTarget[]> {
	const result: CleanupTarget[] = [];
	for (const name of relative) {
		const path = join(ctx.home, name);
		if (await exists(path)) result.push({ path, label: name, kind: "cache" });
	}
	return result;
}
export async function otherBundles(
	ctx: AppContext,
	installed: Installation | null,
	match: RegExp,
	expectedIds: readonly string[],
): Promise<CleanupTarget[]> {
	const result: CleanupTarget[] = [];
	for (const root of ["/Applications", join(ctx.home, "Applications")]) {
		for (const path of await children(root)) {
			if (!match.test(basename(path)) || (await lstat(path)).isSymbolicLink())
				continue;
			if (installed && (await realpath(path)) === installed.payload) continue;
			if (!(await exists(join(path, "Contents/Info.plist")))) continue;
			if (!expectedIds.includes(await plist(ctx, path, "CFBundleIdentifier")))
				continue;
			result.push({
				path,
				kind: "version",
				label: `${basename(path)} ${await plist(ctx, path, "CFBundleShortVersionString")}`,
			});
		}
	}
	return result;
}
export const electronCaches = (folder: string) =>
	[
		"Cache",
		"Code Cache",
		"GPUCache",
		"DawnGraphiteCache",
		"DawnWebGPUCache",
	].map((name) => `Library/Application Support/${folder}/${name}`);

export { versions } from "../core/discovery.ts";
