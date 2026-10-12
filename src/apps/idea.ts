import { basename, join } from "node:path";
import { children } from "../core/system.ts";
import type { AppModule } from "../core/types.ts";
import { bundle, caches, otherBundles } from "./shared.ts";

const bundleIds = ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"];

export const idea: AppModule = {
	name: "idea",
	displayName: "IntelliJ IDEA",
	inspect: (ctx) =>
		bundle(ctx, ["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"], bundleIds),
	update: async (ctx, installed) => {
		const code =
			installed?.bundleId === "com.jetbrains.intellij.ce" ? "IIC" : "IIU";
		const data = await ctx.json<
			Record<
				string,
				{
					version: string;
					downloads: Record<string, { link: string; checksumLink: string }>;
				}[]
			>
		>(
			`https://data.services.jetbrains.com/products/releases?code=${code}&latest=true&type=release`,
		);
		const release = data[code]?.[0];
		const download = release?.downloads[ctx.arch === "arm64" ? "macM1" : "mac"];
		if (!release || !download)
			throw new Error("No compatible IntelliJ release found");
		return {
			version: release.version,
			url: download.link,
			sha256: (await ctx.text(download.checksumLink)).trim().split(/\s+/)[0],
			format: "dmg",
			entry: code === "IIC" ? "IntelliJ IDEA CE.app" : "IntelliJ IDEA.app",
			teamId: "2ZEFAR8TH3",
			bundleIds: [
				code === "IIC" ? "com.jetbrains.intellij.ce" : "com.jetbrains.intellij",
			],
		};
	},
	clean: async (ctx, installed) => {
		const folders = (
			await children(join(ctx.home, "Library/Caches/JetBrains"))
		).filter((p) => /^(IntelliJIdea|IdeaIC)\d/.test(basename(p)));
		return [
			...(await caches(
				ctx,
				folders.map((p) => p.slice(ctx.home.length + 1)),
			)),
			...(await otherBundles(
				ctx,
				installed,
				/^IntelliJ IDEA(?:[ -].+)?\.app$/,
				bundleIds,
			)),
		];
	},
};
