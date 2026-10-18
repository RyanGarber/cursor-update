import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testPaths } from "./tests.ts";
import {
	check,
	cleanup,
	install,
	isNewer,
	type Manifest,
	version,
} from "./update.ts";

const sha256 = (text: string) =>
	createHash("sha256").update(text).digest("hex");
const manifest = (body: string, next = "99.0.0"): Manifest => ({
	version: next,
	assets: {
		"darwin-arm64": {
			url: "https://example.com/sod-off-darwin-arm64",
			sha256: sha256(body),
		},
	},
});

describe("update", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("compares versions by their numbers", () => {
		expect(isNewer("1.10.0", "1.9.9")).toBe(true);
		expect(isNewer("1.0.0", "1.0.0")).toBe(false);
		expect(isNewer("1.0.0", "1.0.1")).toBe(false);
		expect(isNewer("2.0.0-rc.1", "1.9.0")).toBe(true);
	});

	it("reports only a newer release", async () => {
		expect(await check(async () => manifest("x"))).not.toBeNull();
		expect(await check(async () => manifest("x", version))).toBeNull();
		await expect(check(async () => ({}) as Manifest)).rejects.toThrow();
	});

	it("replaces the binary only with a verified download", async () => {
		await testPaths([], async (dir) => {
			const target = join(dir, "sod-off");
			await writeFile(target, "old", { mode: 0o755 });
			vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) =>
				Object.defineProperty(new Response("new"), "url", {
					value: url,
				})) as unknown as typeof fetch);
			await expect(
				install(manifest("tampered"), target, "darwin-arm64"),
			).rejects.toThrow("SHA-256");
			expect(await readFile(target, "utf8")).toBe("old");
			await expect(
				install(manifest("new"), target, "linux-x64"),
			).rejects.toThrow("linux-x64");
			await install(manifest("new"), target, "darwin-arm64");
			expect(await readFile(target, "utf8")).toBe("new");
			expect((await stat(target)).mode & 0o777).toBe(0o755);
		});
	});

	it("removes what an interrupted update left beside the binary", async () => {
		await testPaths([], async (dir) => {
			const target = join(dir, "sod-off");
			await writeFile(target, "current");
			await writeFile(`${target}.download`, "partial");
			await writeFile(`${target}.old`, "previous");
			await cleanup(target);
			expect(await readFile(target, "utf8")).toBe("current");
			await expect(stat(`${target}.download`)).rejects.toThrow();
			await expect(stat(`${target}.old`)).rejects.toThrow();
		});
	});
});
