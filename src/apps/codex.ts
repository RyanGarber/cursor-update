import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { contains, exists } from "../core/system.ts";
import type { AppModule } from "../core/types.ts";
import { caches, cli, versions } from "./shared.ts";
export const codex: AppModule = {
	name: "codex",
	displayName: "Codex CLI",
	platforms: ["darwin"],
	inspect: async (ctx) => {
		const installed = await cli(ctx, "codex");
		if (installed) {
			const root = dirname(dirname(installed.payload));
			if (await exists(join(root, "codex-package.json")))
				installed.storage = root;
		}
		return installed;
	},
	update: async (ctx) => {
		const release = await ctx.json<{
			tag_name: string;
			assets: { name: string; browser_download_url: string; digest?: string }[];
		}>("https://api.github.com/repos/openai/codex/releases/latest");
		const triple = `${ctx.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
		const asset = release.assets.find(
			(a) => a.name === `codex-package-${triple}.tar.gz`,
		);
		if (!asset) throw new Error("No compatible Codex package release found");
		return {
			version: release.tag_name.replace(/^rust-v/, ""),
			url: asset.browser_download_url,
			sha256: asset.digest?.replace(/^sha256:/, ""),
			format: "tar.gz",
			entry: "bin/codex",
			wholeArchive: true,
			teamId: "2DC432GLL2",
		};
	},
	clean: async (ctx, installed) => {
		const nativeRoot = join(ctx.home, ".codex/packages/standalone");
		const current = join(nativeRoot, "current");
		const pinned = (await exists(current))
			? await realpath(current)
			: undefined;
		const inactive = await versions(
			join(nativeRoot, "releases"),
			installed?.payload,
			/^\d+\.\d+\.\d+.*-apple-darwin$/,
		);
		// The vendor's current pointer may still be used by another launcher or auto-updater.
		return [
			...(await caches(ctx, [".cache/codex"])),
			...inactive.filter((item) => !pinned || !contains(item.path, pinned)),
		];
	},
};
