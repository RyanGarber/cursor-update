import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCommitFromUrl, getInstalledInfo } from "../src/check.ts";

describe("check module", () => {
	it("extracts commit hash from standard redirect URL", () => {
		const url =
			"https://downloads.cursor.com/production/3a92974361033b2051526321308c2740fe5912c5/darwin/arm64/Cursor-darwin-arm64.dmg";
		const commit = extractCommitFromUrl(url);
		expect(commit).toBe("3a92974361033b2051526321308c2740fe5912c5");
	});

	it("extracts commit hash from alternative URL shapes", () => {
		const url =
			"https://example.com/builds/abcdef1234567890abcdef1234567890abcdef12/file.dmg";
		const commit = extractCommitFromUrl(url);
		expect(commit).toBe("abcdef1234567890abcdef1234567890abcdef12");
	});

	it("returns null for URLs without 40-char commit hash", () => {
		const url = "https://example.com/latest.dmg";
		const commit = extractCommitFromUrl(url);
		expect(commit).toBeNull();
	});

	it("reads installed info correctly from product.json", () => {
		const tempAppDir = join(tmpdir(), `TestCursor-${Date.now()}.app`);
		const resourcesDir = join(tempAppDir, "Contents", "Resources", "app");
		mkdirSync(resourcesDir, { recursive: true });

		const mockProduct = {
			version: "3.22.7",
			commit: "37076c6c3f9e253c0fa2305197e45befd13a2260",
			realCommit: "37076c6c3f9e253c0fa2305197e45befd13a2268",
		};
		writeFileSync(
			join(resourcesDir, "product.json"),
			JSON.stringify(mockProduct),
		);

		try {
			const info = getInstalledInfo(tempAppDir);
			expect(info.exists).toBe(true);
			expect(info.commit).toBe("37076c6c3f9e253c0fa2305197e45befd13a2260");
			expect(info.version).toBe("3.22.7");
		} finally {
			rmSync(tempAppDir, { recursive: true, force: true });
		}
	});

	it("handles non-existent app path gracefully", () => {
		const info = getInstalledInfo("/path/that/does/not/exist.app");
		expect(info.exists).toBe(false);
		expect(info.commit).toBeNull();
		expect(info.version).toBeNull();
	});
});
