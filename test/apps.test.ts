import { describe, expect, it } from "bun:test";
import { appcast } from "../src/apps/chatgpt.ts";
import { claudeCode } from "../src/apps/claude-code.ts";
import { codex } from "../src/apps/codex.ts";
import { idea } from "../src/apps/idea.ts";
import type { AppContext, Installation } from "../src/core/types.ts";

const ctx: AppContext = {
	home: "/tmp/fake",
	arch: "arm64",
	command: async () => "",
	text: async () => "",
	json: async <T>() => ({}) as T,
};
describe("vendor release adapters", () => {
	it("selects full appcast archives for the requested architecture, never deltas", () => {
		const xml = `<rss><item><sparkle:hardwareRequirements>x64</sparkle:hardwareRequirements><sparkle:shortVersionString>3.0</sparkle:shortVersionString><enclosure url="https://example.com/intel.zip"/></item><item><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements><sparkle:shortVersionString>2.0</sparkle:shortVersionString><enclosure url="https://example.com/full.zip"/><sparkle:deltas><enclosure url="https://example.com/delta"/></sparkle:deltas></item></rss>`;
		expect(appcast(xml, "arm64")).toEqual({
			url: "https://example.com/full.zip",
			version: "2.0",
		});
		expect(() => appcast("<rss/>", "arm64")).toThrow();
	});
	it("resolves Claude Code version and checksum from its native manifest", async () => {
		const release = await claudeCode.update?.(
			{
				...ctx,
				text: async () => "2.1.296\n",
				json: async <T>() =>
					({
						platforms: { "darwin-arm64": { checksum: "a".repeat(64) } },
					}) as T,
			},
			null,
		);
		expect(release?.url).toBe(
			"https://downloads.claude.ai/claude-code-releases/2.1.296/darwin-arm64/claude",
		);
		expect(release?.sha256).toBe("a".repeat(64));
	});
	it("rejects malformed Claude Code channel responses", async () => {
		await expect(
			claudeCode.update?.(
				{ ...ctx, text: async () => "<html>error</html>" },
				null,
			),
		).rejects.toThrow("Invalid");
	});
	it("selects the full Codex package including companion executables", async () => {
		const release = await codex.update?.(
			{
				...ctx,
				arch: "x64",
				json: async <T>() =>
					({
						tag_name: "rust-v0.162.1",
						assets: [
							{
								name: "codex-package-x86_64-apple-darwin.tar.gz",
								browser_download_url: "https://github.com/release.tar.gz",
								digest: `sha256:${"b".repeat(64)}`,
							},
						],
					}) as T,
			},
			null,
		);
		expect(release?.wholeArchive).toBe(true);
		expect(release?.entry).toBe("bin/codex");
		expect(release?.version).toBe("0.162.1");
	});
	it("preserves the installed IDEA edition and selects the native architecture", async () => {
		let requested = "";
		const installed: Installation = {
			path: "/Applications/IntelliJ IDEA CE.app",
			payload: "/Applications/IntelliJ IDEA CE.app",
			kind: "bundle",
			version: "2025.1",
			bundleId: "com.jetbrains.intellij.ce",
		};
		const release = await idea.update?.(
			{
				...ctx,
				text: async () => `${"c".repeat(64)} file.dmg`,
				json: async <T>(url: string) => {
					requested = url;
					return {
						IIC: [
							{
								version: "2025.2",
								downloads: {
									macM1: {
										link: "https://example.com/arm.dmg",
										checksumLink: "https://example.com/checksum",
									},
								},
							},
						],
					} as T;
				},
			},
			installed,
		);
		expect(requested).toContain("code=IIC");
		expect(release?.url).toBe("https://example.com/arm.dmg");
		expect(release?.sha256).toBe("c".repeat(64));
	});
});

it("does not mistake a similarly named helper for an old desktop bundle", async () => {
	const { mkdtemp, mkdir, writeFile, rm, realpath } = await import(
		"node:fs/promises"
	);
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { otherBundles } = await import("../src/apps/shared.ts");
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "sod-app-discovery-")),
	);
	const helper = join(home, "Applications/Claude Code URL Handler.app");
	await mkdir(join(helper, "Contents"), { recursive: true });
	await writeFile(join(helper, "Contents/Info.plist"), "placeholder");
	try {
		const items = await otherBundles(
			{
				...ctx,
				home,
				command: async (args) =>
					args.at(-1)?.startsWith(home)
						? "local.claude-url-handler"
						: "com.anthropic.claudefordesktop",
			},
			null,
			/^Claude Code URL Handler\.app$/,
			["com.anthropic.claudefordesktop"],
		);
		expect(items).toEqual([]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

it("resolves the current Claude desktop release from its update feed", async () => {
	const { claude } = await import("../src/apps/claude.ts");
	const url =
		"https://downloads.claude.ai/releases/darwin/universal/2.0.0/Claude-abc.zip";
	const release = await claude.update?.(
		{
			...ctx,
			json: async <T>() =>
				({
					currentRelease: "2.0.0",
					releases: [
						{
							version: "1.0.0",
							updateTo: { url: "https://example.com/old.zip" },
						},
						{ version: "2.0.0", updateTo: { url } },
					],
				}) as T,
		},
		null,
	);
	expect(release).toMatchObject({ url, version: "2.0.0", format: "zip" });
});
