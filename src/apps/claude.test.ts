import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testContext, testPaths } from "../tests.ts";
import { claude } from "./claude.ts";
import { otherBundles } from "./shared.ts";

describe("claude", () => {
	it("uses the official Claude desktop download redirect", async () => {
		expect((await claude.update?.(testContext(), null))?.url).toBe(
			"https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect",
		);
	});

	it("does not mistake a similarly named helper for an old desktop bundle", async () => {
		await testPaths([], async (home) => {
			const helper = join(home, "Applications/Claude Code URL Handler.app");
			await mkdir(join(helper, "Contents"), { recursive: true });
			await writeFile(join(helper, "Contents/Info.plist"), "placeholder");
			const items = await otherBundles(
				{
					...testContext(),
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
		});
	});
});
