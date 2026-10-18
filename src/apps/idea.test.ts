import { join } from "node:path";
import type { Installation } from "../core/types.ts";
import { testContext, testPaths } from "../tests.ts";
import { idea } from "./idea.ts";

describe("idea", () => {
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
				...testContext(),
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

	it("removes IntelliJ settings of major versions before the installed one", async () => {
		const root = "Library/Application Support/JetBrains";
		await testPaths(
			[
				[root, "IntelliJIdea2025.3"],
				[root, "IntelliJIdea2026.2"],
				[root, "IntelliJIdea2026.3"],
				[root, "IntelliJIdea2027.1"],
				[root, "IdeaIC2024.1"],
				[root, "WebStorm2024.1"],
				[root, "consentOptions"],
			],
			async (home) => {
				const items = await idea.clean?.(
					{ ...testContext(), home },
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
				const fallback = await idea.clean?.({ ...testContext(), home }, null);
				expect(fallback?.map((item) => item.path)).toHaveLength(4);
			},
		);
	});
});
