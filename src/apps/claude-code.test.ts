import { join } from "node:path";
import { testContext, testPaths } from "../tests.ts";
import { claudeCode } from "./claude-code.ts";

describe("claude-code", () => {
	it("rejects malformed Claude Code channel responses", async () => {
		await expect(
			claudeCode.update?.(
				{ ...testContext(), text: async () => "<html>error</html>" },
				null,
			),
		).rejects.toThrow("Invalid");
	});

	it("resolves Claude Code version and checksum from its native manifest", async () => {
		const release = await claudeCode.update?.(
			{
				...testContext(),
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
});

describe("claude-code clean", () => {
	it("removes inactive native versions and keeps the active one", async () => {
		const root = ".local/share/claude/versions";
		await testPaths(
			[[root, "2.1.295"], [root, "2.1.296"], ".claude/downloads"],
			async (home, [old, active, downloads]) => {
				const items = await claudeCode.clean?.(
					{ ...testContext(), home },
					{
						path: join(home, ".local/bin/claude"),
						payload: active!,
						kind: "cli",
						version: "2.1.296",
					},
				);
				expect(items?.map((item) => item.path)).toEqual([downloads, old]);
			},
		);
	});
});
