import { join } from "node:path";
import type { AppModule } from "../core/types.ts";
import { caches, cli, versions } from "./shared.ts";
export const claudeCode: AppModule = {
	name: "claude-code",
	displayName: "Claude Code",
	platforms: ["darwin"],
	inspect: (context) => cli(context, "claude"),
	update: async (context) => {
		const base = "https://downloads.claude.ai/claude-code-releases";
		const version = (await context.text(`${base}/latest`)).trim();
		if (!/^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(version))
			throw new Error("Invalid Claude Code release version");
		const manifest = await context.json<{
			platforms: Record<string, { checksum: string }>;
		}>(`${base}/${version}/manifest.json`);
		const platform = `darwin-${context.architecture}`;
		const sha256 = manifest.platforms[platform]?.checksum;
		if (!sha256) throw new Error(`No Claude Code checksum for ${platform}`);
		return {
			version,
			url: `${base}/${version}/${platform}/claude`,
			sha256,
			format: "binary",
			entry: "claude",
			teamId: "Q6L2SF6YDW",
		};
	},
	clean: async (context, installed) => [
		...(await caches(context, [
			".claude/downloads",
			".cache/claude",
			"Library/Caches/claude-cli-nodejs",
		])),
		...(await versions(
			join(context.home, ".local/share/claude/versions"),
			installed?.payload,
			/^\d+\.\d+\.\d+([-+][\w.-]+)?$/,
		)),
	],
};
