import { readdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { children, contains, exists } from "../core/system.ts";
import type { AppContext, AppModule, CleanupTarget } from "../core/types.ts";
import { caches, cli } from "./shared.ts";

const agentVersion = /^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$/i;

/** `YYYY.M.D-hash` by date, then by name. */
function byVersion(a: string, b: string): number {
	const date = (p: string) =>
		(basename(p).split("-")[0] ?? "")
			.split(".")
			.map((n) => n.padStart(4, "0"))
			.join(".");
	return date(a).localeCompare(date(b)) || a.localeCompare(b);
}
/** The agent marks a version it runs from with `<version>/.running/<pid>`. */
async function running(path: string): Promise<boolean> {
	const pids = await readdir(join(path, ".running")).catch(() => []);
	return pids.some((pid) => {
		try {
			process.kill(Number(pid), 0);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "EPERM";
		}
	});
}
/**
 * Cursor agent payloads under `<root>/share/cursor-agent/versions` and
 * interrupted installs beside them, except versions a launcher in `<root>/bin`
 * resolves into, `active` ones, running ones and (with `keepNewest`) the newest.
 */
export async function agentVersions(
	root: string,
	active: (string | undefined)[],
	keepNewest: boolean,
): Promise<CleanupTarget[]> {
	const versionsRoot = join(root, "share/cursor-agent/versions");
	const entries = await children(versionsRoot);
	const found = entries
		.filter((p) => agentVersion.test(basename(p)))
		.sort(byVersion);
	const keep = [...active, ...(keepNewest ? [found.at(-1)] : [])];
	for (const launcher of ["agent", "cursor-agent"]) {
		const path = join(root, "bin", launcher);
		if (await exists(path))
			keep.push(await realpath(path).catch(() => undefined));
	}
	const result: CleanupTarget[] = [];
	for (const path of found) {
		if (keep.some((k) => k && contains(path, k)) || (await running(path)))
			continue;
		result.push({
			path,
			label: `Installed version ${basename(path)}`,
			kind: "version",
		});
	}
	for (const path of entries)
		if (basename(path).startsWith(".tmp-"))
			result.push({
				path,
				label: `Interrupted install ${basename(path)}`,
				kind: "cache",
			});
	return result;
}

export const cursorAgent: AppModule = {
	name: "cursor-agent",
	displayName: "Cursor Agent CLI",
	platforms: ["darwin"],
	// `agent` is a common name; accept only a launcher into a cursor-agent payload.
	inspect: (context) =>
		cli(
			context,
			["agent", "cursor-agent"],
			(payload) => basename(payload) === "cursor-agent",
		),
	update: async (context: AppContext) => {
		// The installer pins the current release; the agent's own updater needs a login.
		const script = await context.text("https://cursor.com/install");
		const version = script.match(
			/downloads\.cursor\.com\/lab\/(\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+)\//i,
		)?.[1];
		if (!version) throw new Error("No Cursor Agent release in the installer");
		return {
			version,
			url: `https://downloads.cursor.com/lab/${version}/darwin/${context.architecture}/agent-cli-package.tar.gz`,
			format: "tar.gz",
			entry: "cursor-agent",
			wholeArchive: true,
			// The launcher is a script; its Anysphere-signed companion vouches for the package.
			verify: "cursor-agent-worker-sea",
			teamId: "DCNK4UB866",
		};
	},
	clean: async (context, installed) => [
		...(await caches(context, ["Library/Caches/cursor-compile-cache"])),
		...(await agentVersions(
			join(context.home, ".local"),
			[installed?.payload],
			false,
		)),
	],
};
