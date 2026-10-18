import type { AppModule, Release } from "../core/types.ts";
import { bundle, caches, electronCaches, otherBundles } from "./shared.ts";

const bundleIds = ["com.openai.chat", "com.openai.codex"];

export function appcast(
	xml: string,
	arch: string,
): Pick<Release, "url" | "version"> {
	for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
		const item = match[1] ?? "";
		const hardware = item.match(/<sparkle:hardwareRequirements>(.*?)<\//)?.[1];
		if (hardware && !hardware.split(/[,\s]+/).includes(arch)) continue;
		const enclosure = item
			.split("<sparkle:deltas>")[0]
			?.match(/<enclosure\s[^>]*>/)?.[0];
		const url = enclosure
			?.match(/\burl="([^"]+)"/)?.[1]
			?.replaceAll("&amp;", "&");
		const version = item.match(/<sparkle:shortVersionString>(.*?)<\//)?.[1];
		if (url && version) return { url, version };
	}
	throw new Error(`No full ChatGPT release for ${arch}`);
}
export const chatgpt: AppModule = {
	name: "chatgpt",
	displayName: "ChatGPT.app",
	platforms: ["darwin"],
	inspect: (context) => bundle(context, ["ChatGPT.app"], bundleIds),
	update: async (context) => ({
		...appcast(
			await context.text(
				"https://persistent.oaistatic.com/codex-app-prod/appcast.xml",
			),
			context.architecture,
		),
		format: "zip",
		entry: "ChatGPT.app",
		teamId: "2DC432GLL2",
		bundleIds: ["com.openai.codex"],
	}),
	clean: async (context, installed) => [
		...(await caches(context, [
			...electronCaches("com.openai.codex"),
			...electronCaches("Codex"),
			...electronCaches("Codex/Default"),
			"Library/Caches/Codex",
			"Library/Caches/com.openai.chat",
			"Library/Caches/com.openai.codex",
			"Library/Caches/com.openai.chat.ShipIt",
		])),
		...(await otherBundles(
			context,
			installed,
			/^ChatGPT(?:[ -].+)?\.app$/,
			bundleIds,
		)),
	],
};
