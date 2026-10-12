import { join } from "node:path";
import type { AppModule } from "../core/types.ts";
import { caches, cli, versions } from "./shared.ts";
export const claudeCode: AppModule = {
	name: "claude-code",
	displayName: "Claude Code",
	inspect: (ctx) => cli(ctx, "claude"),
	update: async (ctx) => {
		const base = "https://downloads.claude.ai/claude-code-releases";
		const version = (await ctx.text(`${base}/latest`)).trim();
		if (!/^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(version))
			throw new Error("Invalid Claude Code release version");
		const manifest = await ctx.json<{
			platforms: Record<string, { checksum: string }>;
		}>(`${base}/${version}/manifest.json`);
		const platform = `darwin-${ctx.arch}`;
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
	clean: async (ctx, installed) => [
		...(await caches(ctx, [
			".claude/downloads",
			".cache/claude",
			"Library/Caches/claude-cli-nodejs",
		])),
		...(await versions(
			join(ctx.home, ".local/share/claude/versions"),
			installed?.payload,
			/^\d+\.\d+\.\d+([-+][\w.-]+)?$/,
		)),
	],
};
