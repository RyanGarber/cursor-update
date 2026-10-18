import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
	access,
	lstat,
	readdir,
	readFile,
	realpath,
	stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import type { AppContext, Platform, Usage } from "./types.ts";

export const platforms: readonly Platform[] = ["darwin", "linux", "win32"];
export const platformNames: Record<Platform, string> = {
	darwin: "macOS",
	linux: "Linux",
	win32: "Windows",
};
export function currentPlatform(): Platform {
	const platform = process.platform as Platform;
	if (!platforms.includes(platform))
		throw new Error(`Unsupported operating system: ${process.platform}`);
	return platform;
}

export async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (
			["ENOENT", "ENOTDIR"].includes(
				(error as NodeJS.ErrnoException).code ?? "",
			)
		)
			return false;
		throw error;
	}
}
export async function children(path: string): Promise<string[]> {
	try {
		return (await readdir(path)).sort().map((name) => join(path, name));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}
export function command(args: string[]): Promise<string> {
	const [file = "", ...rest] = args;
	return new Promise((resolve, reject) =>
		execFile(
			file,
			rest,
			{ timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error)
					reject(
						new Error(
							`${file} failed (${error.code ?? error.signal}): ${stderr.trim() || stdout.trim() || error.message}`,
						),
					);
				else resolve(stdout.trim());
			},
		),
	);
}
/** The first executable named `name` on PATH, like `which`. */
export async function which(name: string): Promise<string | null> {
	const extensions =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
			: [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter))
		for (const extension of extensions) {
			if (!dir) continue;
			const path = join(dir, name + extension);
			try {
				if ((await stat(path)).isFile()) {
					await access(path, constants.X_OK);
					return path;
				}
			} catch {}
		}
	return null;
}
export async function response(
	url: string,
	signal?: AbortSignal,
): Promise<Response> {
	if (new URL(url).protocol !== "https:")
		throw new Error(`Expected HTTPS: ${url}`);
	const result = await fetch(url, {
		signal: AbortSignal.any([
			AbortSignal.timeout(600_000),
			...(signal ? [signal] : []),
		]),
	});
	if (!result.ok) throw new Error(`HTTP ${result.status}: ${url}`);
	if (new URL(result.url).protocol !== "https:")
		throw new Error("Insecure download redirect");
	return result;
}
export function context(appPath?: string, signal?: AbortSignal): AppContext {
	const platform = currentPlatform();
	if (process.arch !== "arm64" && process.arch !== "x64")
		throw new Error(`Unsupported architecture: ${process.arch}`);
	return {
		signal,
		platform,
		home: homedir(),
		arch: process.arch,
		appPath,
		command,
		text: async (url) => (await response(url, signal)).text(),
		json: async <T>(url: string) =>
			(await response(url, signal)).json() as Promise<T>,
	};
}
export async function plist(
	ctx: AppContext,
	app: string,
	key: string,
): Promise<string> {
	return ctx.command([
		"/usr/libexec/PlistBuddy",
		"-c",
		`Print :${key}`,
		join(app, "Contents/Info.plist"),
	]);
}
export function contains(parent: string, child: string): boolean {
	return child === parent || child.startsWith(`${parent}/`);
}
export function roots(paths: string[]): string[] {
	const sorted = [...new Set(paths.map((p) => resolve(p)))].sort(
		(a, b) => a.length - b.length,
	);
	return sorted.filter(
		(path, index) =>
			!sorted.slice(0, index).some((parent) => contains(parent, path)),
	);
}
/** Does not follow symlinks, deduplicates hard links, and propagates unreadable paths. */
export async function usage(paths: string[]): Promise<Usage> {
	const seen = new Set<string>();
	const result = { bytes: 0, allocated: 0 };
	async function visit(path: string): Promise<void> {
		if (!(await exists(path))) return;
		const stat = await lstat(path);
		const key = `${stat.dev}:${stat.ino}`;
		if (seen.has(key)) return;
		seen.add(key);
		result.allocated += stat.blocks * 512;
		if (stat.isDirectory()) {
			for (const child of await children(path)) await visit(child);
		} else result.bytes += stat.size;
	}
	for (const path of roots(paths)) await visit(path);
	return result;
}
/** Refuse paths whose parents redirect deletion/replacement through a symlink. */
export async function safePath(path: string): Promise<void> {
	const absolute = resolve(path);
	if (absolute === "/" || absolute === homedir())
		throw new Error(`Unsafe target: ${path}`);
	let parent = dirname(absolute);
	while (parent !== "/") {
		if ((await exists(parent)) && (await realpath(parent)) !== parent)
			throw new Error(`Symlinked parent: ${parent}`);
		parent = dirname(parent);
	}
}
export async function identity(path: string): Promise<string> {
	if (!(await exists(path))) return "missing";
	const s = await lstat(path);
	return `${s.dev}:${s.ino}:${s.mtimeMs}:${s.size}`;
}
export async function readJSON<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}
