import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import { children } from "../core/system.ts";
import type {
	AppContext,
	AppModule,
	CleanupTarget,
	Installation,
} from "../core/types.ts";
import { bundle, caches, otherBundles } from "./shared.ts";

const bundleIds = ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"];

const release = (name: string) =>
	name
		.match(/^(?:IntelliJIdea|IdeaIC)(\d{4})\.(\d+)$/)
		?.slice(1)
		.map(Number);
const older = (a: number[], b: number[]) =>
	a[0] !== b[0] ? (a[0] ?? 0) < (b[0] ?? 0) : (a[1] ?? 0) < (b[1] ?? 0);

/** Settings, plugins and indexes of major versions before the active one. */
async function oldSettings(
	context: AppContext,
	installed: Installation | null,
): Promise<CleanupTarget[]> {
	const folders = (
		await children(join(context.home, "Library/Application Support/JetBrains"))
	).filter((p) => release(basename(p)));
	// Without an installed version, the newest folder is presumed active.
	const active =
		installed?.version
			?.match(/^(\d{4})\.(\d+)/)
			?.slice(1)
			.map(Number) ??
		folders
			.map((p) => release(basename(p)) ?? [])
			.reduce<number[] | undefined>(
				(newest, v) => (!newest || older(newest, v) ? v : newest),
				undefined,
			);
	if (!active) return [];
	const result: CleanupTarget[] = [];
	for (const path of folders) {
		const version = release(basename(path));
		if (!version || !older(version, active)) continue;
		if ((await lstat(path)).isSymbolicLink()) continue;
		result.push({
			path,
			label: `${basename(path)} settings`,
			kind: "version",
		});
	}
	return result;
}

export const idea: AppModule = {
	name: "idea",
	displayName: "IntelliJ IDEA",
	platforms: ["darwin"],
	inspect: (context) =>
		bundle(context, ["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"], bundleIds),
	update: async (context, installed) => {
		const code =
			installed?.bundleId === "com.jetbrains.intellij.ce" ? "IIC" : "IIU";
		const data = await context.json<
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
		const download =
			release?.downloads[context.architecture === "arm64" ? "macM1" : "mac"];
		if (!release || !download)
			throw new Error("No compatible IntelliJ release found");
		return {
			version: release.version,
			url: download.link,
			sha256: (await context.text(download.checksumLink))
				.trim()
				.split(/\s+/)[0],
			format: "dmg",
			entry: code === "IIC" ? "IntelliJ IDEA CE.app" : "IntelliJ IDEA.app",
			teamId: "2ZEFAR8TH3",
			bundleIds: [
				code === "IIC" ? "com.jetbrains.intellij.ce" : "com.jetbrains.intellij",
			],
		};
	},
	clean: async (context, installed) => {
		const folders = (
			await children(join(context.home, "Library/Caches/JetBrains"))
		).filter((p) => /^(IntelliJIdea|IdeaIC)\d/.test(basename(p)));
		return [
			...(await caches(
				context,
				folders.map((p) => p.slice(context.home.length + 1)),
			)),
			...(await oldSettings(context, installed)),
			...(await otherBundles(
				context,
				installed,
				/^IntelliJ IDEA(?:[ -].+)?\.app$/,
				bundleIds,
			)),
		];
	},
};
