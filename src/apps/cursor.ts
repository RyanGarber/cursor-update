import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { children, contains, exists, readJSON } from "../core/system.ts";
import type { AppModule, CleanupTarget } from "../core/types.ts";
import {
	bundle,
	caches,
	electronCaches,
	otherBundles,
	versions,
} from "./shared.ts";

const bundleIds = ["com.todesktop.230313mzl4w4u92"];
const agentVersion = /^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$/i;

/**
 * Cursor agent payloads under `<root>/share/cursor-agent/versions`, except the
 * newest and any a launcher in `<root>/bin` (or on PATH) still resolves into.
 */
async function agentVersions(
	root: string,
	launchers: (string | null)[],
): Promise<CleanupTarget[]> {
	const versionsRoot = join(root, "share/cursor-agent/versions");
	const newest = (await children(versionsRoot))
		.filter((p) => agentVersion.test(p.slice(versionsRoot.length + 1)))
		.sort(byVersion)
		.at(-1);
	const active = [newest];
	for (const launcher of [
		...launchers,
		join(root, "bin/agent"),
		join(root, "bin/cursor-agent"),
	])
		if (launcher && (await exists(launcher)))
			active.push(await realpath(launcher).catch(() => undefined));
	const inactive = await versions(versionsRoot, undefined, agentVersion);
	return inactive.filter(
		(item) => !active.some((path) => path && contains(item.path, path)),
	);
}
/** `YYYY.M.D-hash` by date, then by name. */
function byVersion(a: string, b: string): number {
	const date = (p: string) =>
		(p.split("/").at(-1)?.split("-")[0] ?? "")
			.split(".")
			.map((n) => n.padStart(4, "0"))
			.join(".");
	return date(a).localeCompare(date(b)) || a.localeCompare(b);
}

export const cursor: AppModule = {
	name: "cursor",
	displayName: "Cursor",
	platforms: ["darwin"],
	inspect: (ctx) => bundle(ctx, ["Cursor.app"], bundleIds),
	update: async (ctx) => ({
		url: `https://api2.cursor.sh/updates/download/golden/darwin-${ctx.arch}/cursor/latest`,
		format: "dmg",
		entry: "Cursor.app",
		teamId: "VDXQ22DGB9",
		bundleIds: ["com.todesktop.230313mzl4w4u92"],
	}),
	clean: async (ctx, installed) => {
		const data = installed
			? await readJSON<{ commit?: string }>(
					join(installed.payload, "Contents/Resources/app/product.json"),
				)
			: {};
		const root = join(
			ctx.home,
			"Library/Application Support/Cursor/CachedData",
		);
		return [
			...(await caches(ctx, [
				...electronCaches("Cursor"),
				"Library/Caches/cursor-compile-cache",
				"Library/Caches/com.todesktop.230313mzl4w4u92.ShipIt",
			])),
			...(await versions(
				root,
				data.commit ? join(root, data.commit) : undefined,
				/^[a-f0-9]{40}$/i,
			)),
			// Agent bundled with Cursor.app.
			...(await agentVersions(
				join(
					ctx.home,
					"Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local",
				),
				[],
			)),
			// Standalone `agent` CLI.
			...(await agentVersions(join(ctx.home, ".local"), [
				Bun.which("agent"),
				Bun.which("cursor-agent"),
			])),
			...(await otherBundles(
				ctx,
				installed,
				/^Cursor(?:[ -].+)?\.app$/,
				bundleIds,
			)),
		];
	},
};
