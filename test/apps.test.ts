import { describe, expect, it } from "vitest";
import { appcast } from "../src/apps/chatgpt.ts";
import { claudeCode } from "../src/apps/claude-code.ts";
import { codex } from "../src/apps/codex.ts";
import { idea } from "../src/apps/idea.ts";
import type { AppContext, Installation } from "../src/core/types.ts";

const ctx: AppContext = {
	platform: "darwin",
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

it("resolves the Cursor agent release pinned by its installer", async () => {
	const { cursorAgent } = await import("../src/apps/cursor-agent.ts");
	const release = await cursorAgent.update?.(
		{
			...ctx,
			text: async () =>
				'DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.10.16-e3cb207/$OS/$ARCH/agent-cli-package.tar.gz"',
		},
		null,
	);
	expect(release).toMatchObject({
		version: "2026.10.16-e3cb207",
		url: "https://downloads.cursor.com/lab/2026.10.16-e3cb207/darwin/arm64/agent-cli-package.tar.gz",
		wholeArchive: true,
		verify: "cursor-agent-worker-sea",
	});
	await expect(
		cursorAgent.update?.({ ...ctx, text: async () => "<html/>" }, null),
	).rejects.toThrow("No Cursor Agent release");
});

it("uses the official Claude desktop download redirect", async () => {
	const { claude } = await import("../src/apps/claude.ts");
	expect((await claude.update?.(ctx, null))?.url).toBe(
		"https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect",
	);
});

describe("version cleanup", async () => {
	const { mkdtemp, mkdir, rm, realpath, symlink, writeFile } = await import(
		"node:fs/promises"
	);
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	async function fixture(dirs: string[]): Promise<string> {
		const home = await realpath(await mkdtemp(join(tmpdir(), "sod-clean-")));
		for (const dir of dirs) await mkdir(join(home, dir), { recursive: true });
		return home;
	}

	it("removes IntelliJ settings of major versions before the installed one", async () => {
		const root = "Library/Application Support/JetBrains";
		const home = await fixture(
			[
				"IntelliJIdea2025.3",
				"IntelliJIdea2026.2",
				"IntelliJIdea2026.3",
				"IntelliJIdea2027.1",
				"IdeaIC2024.1",
				"WebStorm2024.1",
				"consentOptions",
			].map((name) => join(root, name)),
		);
		try {
			const items = await idea.clean?.(
				{ ...ctx, home },
				{
					path: "/Applications/IntelliJ IDEA.app",
					payload: "/Applications/IntelliJ IDEA.app",
					kind: "bundle",
					version: "2026.3.1",
					bundleId: "com.jetbrains.intellij",
				},
			);
			expect(items?.map((item) => item.path)).toEqual(
				["IdeaIC2024.1", "IntelliJIdea2025.3", "IntelliJIdea2026.2"].map(
					(name) => join(home, root, name),
				),
			);
			// Without an installation the newest folder is kept.
			const fallback = await idea.clean?.({ ...ctx, home }, null);
			expect(fallback?.map((item) => item.path)).toHaveLength(4);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("removes old agent versions bundled with Cursor.app, keeping the newest", async () => {
		const { cursor } = await import("../src/apps/cursor.ts");
		const worker =
			"Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/share/cursor-agent/versions";
		const home = await fixture([
			join(worker, "2026.10.14-a26f8ae"),
			join(worker, "2026.10.18-ac23f9a"),
			join(worker, "2026.9.30-0123abc"),
		]);
		try {
			const items = await cursor.clean?.({ ...ctx, home }, null);
			expect(
				items
					?.filter((item) => item.path.includes("cursor-agent/versions"))
					.map((item) => item.path),
			).toEqual([
				join(home, worker, "2026.9.30-0123abc"),
				join(home, worker, "2026.10.14-a26f8ae"),
			]);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("removes old agent CLI versions but keeps active, linked and running ones", async () => {
		const { cursorAgent } = await import("../src/apps/cursor-agent.ts");
		const cli = ".local/share/cursor-agent/versions";
		const home = await fixture([
			join(cli, "2026.10.1-1111111"),
			join(cli, "2026.10.9-2222222"),
			join(cli, "2026.10.12-3333333/.running"),
			join(cli, "2026.10.14-4444444/.running"),
			join(cli, "2026.10.16-5555555"),
			join(cli, ".tmp-2026.10.16-5555555-1760000000"),
			join(cli, "not-a-version"),
			".local/bin",
		]);
		// The legacy launcher still points at an older version.
		await writeFile(join(home, cli, "2026.10.1-1111111/cursor-agent"), "");
		await symlink(
			join(home, cli, "2026.10.1-1111111/cursor-agent"),
			join(home, ".local/bin/cursor-agent"),
		);
		await writeFile(
			join(home, cli, "2026.10.12-3333333/.running", String(process.pid)),
			"",
		);
		await writeFile(
			join(home, cli, "2026.10.14-4444444/.running/2147483646"),
			"",
		);
		try {
			const items = await cursorAgent.clean?.(
				{ ...ctx, home },
				{
					path: join(home, ".local/bin/agent"),
					payload: join(home, cli, "2026.10.16-5555555/cursor-agent"),
					kind: "cli",
					version: "2026.10.16-5555555",
				},
			);
			expect(items?.map((item) => item.path)).toEqual([
				join(home, cli, "2026.10.9-2222222"),
				join(home, cli, "2026.10.14-4444444"),
				join(home, cli, ".tmp-2026.10.16-5555555-1760000000"),
			]);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});
