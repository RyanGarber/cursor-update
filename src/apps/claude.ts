import type { AppModule } from "../core/types.ts";
import { bundle, caches, electronCaches, otherBundles } from "./shared.ts";

const bundleIds = ["com.anthropic.claudefordesktop"];

export const claude: AppModule = {
	name: "claude",
	displayName: "Claude.app",
	inspect: (ctx) => bundle(ctx, ["Claude.app"], bundleIds),
	// The app's own Squirrel feed; the claude.ai download redirect sits behind a Cloudflare challenge.
	update: async (ctx) => {
		const feed = await ctx.json<{
			currentRelease: string;
			releases: { version: string; updateTo: { url: string } }[];
		}>("https://downloads.claude.ai/releases/darwin/universal/RELEASES.json");
		const release = feed.releases.find(
			(r) => r.version === feed.currentRelease,
		);
		if (!release) throw new Error("No current Claude desktop release found");
		return {
			version: release.version,
			url: release.updateTo.url,
			format: "zip",
			entry: "Claude.app",
			teamId: "Q6L2SF6YDW",
			bundleIds,
		};
	},
	clean: async (ctx, installed) => [
		...(await caches(ctx, [
			...electronCaches("Claude"),
			"Library/Caches/com.anthropic.claudefordesktop",
			"Library/Caches/com.anthropic.claudefordesktop.ShipIt",
		])),
		...(await otherBundles(
			ctx,
			installed,
			/^Claude(?:[ -].+)?\.app$/,
			bundleIds,
		)),
	],
};
