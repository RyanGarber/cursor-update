import { describe, expect, it } from "bun:test";
import { parseArgs } from "../src/index.ts";

describe("cli argument parsing", () => {
	it("parses default options", () => {
		const opts = parseArgs([]);
		expect(opts.checkOnly).toBe(false);
		expect(opts.force).toBe(false);
		expect(opts.dryRun).toBe(false);
		expect(opts.help).toBe(false);
		expect(opts.appPath).toBe("/Applications/Cursor.app");
	});

	it("parses flags correctly", () => {
		const opts = parseArgs([
			"--check",
			"--force",
			"--dry-run",
			"--no-cache-clean",
		]);
		expect(opts.checkOnly).toBe(true);
		expect(opts.force).toBe(true);
		expect(opts.dryRun).toBe(true);
		expect(opts.skipCacheCleanup).toBe(true);
	});

	it("parses custom app path", () => {
		const opts = parseArgs(["--app-path", "/custom/Cursor.app"]);
		expect(opts.appPath).toBe("/custom/Cursor.app");
	});
});
