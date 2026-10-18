import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { testContext, testPaths } from "../tests.ts";
import { codex } from "./codex.ts";

describe("codex", () => {
	it("selects the full Codex package including companion executables", async () => {
		const release = await codex.update?.(
			{
				...testContext(),
				architecture: "x64",
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
});

describe("codex clean", () => {
	it("keeps the active release and the one the vendor's current pointer pins", async () => {
		const releases = ".codex/packages/standalone/releases";
		await testPaths(
			[
				[releases, "0.160.0-aarch64-apple-darwin"],
				[releases, "0.161.0-aarch64-apple-darwin"],
				[releases, "0.162.1-aarch64-apple-darwin"],
				".cache/codex",
			],
			async (home, [old, pinned, active, cache]) => {
				await symlink(
					pinned!,
					join(home, ".codex/packages/standalone/current"),
				);
				const items = await codex.clean?.(
					{ ...testContext(), home },
					{
						path: join(home, ".local/bin/codex"),
						payload: join(active!, "bin/codex"),
						kind: "cli",
						version: "0.162.1",
					},
				);
				expect(items?.map((item) => item.path)).toEqual([cache, old]);
			},
		);
	});
});
