import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanPreviousCaches, getDirectorySize } from "../src/cache.ts";

describe("cache module", () => {
	it("calculates directory size accurately", () => {
		const tempDir = join(tmpdir(), `test-cache-size-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		writeFileSync(join(tempDir, "file1.txt"), "hello world"); // 11 bytes
		const subDir = join(tempDir, "sub");
		mkdirSync(subDir);
		writeFileSync(join(subDir, "file2.txt"), "12345"); // 5 bytes

		try {
			const size = getDirectorySize(tempDir);
			expect(size).toBe(16);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("deletes previous version caches while keeping the new version", () => {
		const tempHome = join(tmpdir(), `test-home-${Date.now()}`);
		const cachedData = join(
			tempHome,
			"Library",
			"Application Support",
			"Cursor",
			"CachedData",
		);
		const compileCache = join(
			tempHome,
			"Library",
			"Caches",
			"cursor-compile-cache",
		);
		const libraryCaches = join(tempHome, "Library", "Caches");

		const oldCommit = "37076c6c3f9e253c0fa2305197e45befd13a2260";
		const newCommit = "3a92974361033b2051526321308c2740fe5912c5";

		const oldCommitDir = join(cachedData, oldCommit);
		const newCommitDir = join(cachedData, newCommit);
		const compileCacheSubdir = join(
			compileCache,
			"v24.14.0-arm64-cf738c9d-501",
		);
		const shipItDir = join(
			libraryCaches,
			"com.todesktop.230313mzl4w4u92.ShipIt",
		);

		mkdirSync(oldCommitDir, { recursive: true });
		mkdirSync(newCommitDir, { recursive: true });
		mkdirSync(compileCacheSubdir, { recursive: true });
		mkdirSync(shipItDir, { recursive: true });

		writeFileSync(join(oldCommitDir, "data.bin"), "old-commit-cache-data");
		writeFileSync(join(newCommitDir, "data.bin"), "new-commit-cache-data");
		writeFileSync(join(compileCacheSubdir, "compile.bin"), "compile-data");
		writeFileSync(join(shipItDir, "shipit.bin"), "shipit-data");

		try {
			const result = cleanPreviousCaches(newCommit, tempHome);

			// Old commit cache should be deleted
			expect(existsSync(oldCommitDir)).toBe(false);
			// New commit cache should remain untouched
			expect(existsSync(newCommitDir)).toBe(true);
			// Compile cache subdirectories should be deleted
			expect(existsSync(compileCacheSubdir)).toBe(false);
			// ShipIt cache should be deleted
			expect(existsSync(shipItDir)).toBe(false);

			expect(result.deletedDirs.length).toBe(3);
			expect(result.freedBytes).toBeGreaterThan(0);
		} finally {
			rmSync(tempHome, { recursive: true, force: true });
		}
	});
});
