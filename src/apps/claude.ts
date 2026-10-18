import type { AppModule } from "../core/types.ts";
import { bundle, caches, electronCaches, otherBundles } from "./shared.ts";

const bundleIds = ["com.anthropic.claudefordesktop"];

export const claude: AppModule = {
	name: "claude",
	displayName: "Claude.app",
	platforms: ["darwin"],
	inspect: (context) => bundle(context, ["Claude.app"], bundleIds),
	update: async () => ({
		url: "https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect",
		format: "dmg",
		entry: "Claude.app",
		teamId: "Q6L2SF6YDW",
		bundleIds: ["com.anthropic.claudefordesktop"],
	}),
	clean: async (context, installed) => [
		...(await caches(context, [
			...electronCaches("Claude"),
			"Library/Caches/com.anthropic.claudefordesktop",
			"Library/Caches/com.anthropic.claudefordesktop.ShipIt",
		])),
		...(await otherBundles(
			context,
			installed,
			/^Claude(?:[ -].+)?\.app$/,
			bundleIds,
		)),
	],
};
