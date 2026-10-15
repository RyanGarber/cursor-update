import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AppContext, Usage } from "./types.ts";

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
export async function command(args: string[]): Promise<string> {
	const proc = Bun.spawn(args, {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const timeout = setTimeout(() => proc.kill(), 120_000);
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (code !== 0)
			throw new Error(
				`${args[0]} failed (${code}): ${stderr.trim() || stdout.trim()}`,
			);
		return stdout.trim();
	} finally {
		clearTimeout(timeout);
	}
}
/** Some download hosts reject non-browser clients with 403, so identify as desktop Safari. */
export const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
	Accept:
		"text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
};
export async function response(
	url: string,
	signal?: AbortSignal,
): Promise<Response> {
	if (new URL(url).protocol !== "https:")
		throw new Error(`Expected HTTPS: ${url}`);
	const result = await fetch(url, {
		headers: BROWSER_HEADERS,
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
	if (process.platform !== "darwin")
		throw new Error("sod-off currently supports macOS only.");
	if (process.arch !== "arm64" && process.arch !== "x64")
		throw new Error(`Unsupported architecture: ${process.arch}`);
	return {
		signal,
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
