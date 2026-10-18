import { join } from "node:path";
import { readJSON } from "../core/system.ts";
import type { AppModule } from "../core/types.ts";
import { agentVersions } from "./cursor-agent.ts";
import {
	bundle,
	caches,
	electronCaches,
	otherBundles,
	versions,
} from "./shared.ts";

const bundleIds = ["com.todesktop.230313mzl4w4u92"];
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
			// Agent bundled with Cursor.app; the standalone CLI is `cursor-agent`.
			...(await agentVersions(
				join(
					ctx.home,
					"Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local",
				),
				[],
				true,
			)),
			...(await otherBundles(
				ctx,
				installed,
				/^Cursor(?:[ -].+)?\.app$/,
				bundleIds,
			)),
		];
	},
};
