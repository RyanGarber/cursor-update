import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selfUpdate } from "../src/index.ts";
import {
	check,
	install,
	isNewer,
	type Manifest,
	version,
} from "../src/update.ts";

const sha256 = (text: string) =>
	new Bun.CryptoHasher("sha256").update(text).digest("hex");
const manifest = (body: string, next = "99.0.0"): Manifest => ({
	version: next,
	assets: {
		"darwin-arm64": {
			url: "https://example.com/sod-off-darwin-arm64",
			sha256: sha256(body),
		},
	},
});

describe("self-update", () => {
	afterEach(() => {
		// biome-ignore lint/suspicious/noExplicitAny: restores spied globals
		(globalThis.fetch as any).mockRestore?.();
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
		const dir = await realpath(await mkdtemp(join(tmpdir(), "sod-update-")));
		const target = join(dir, "sod-off");
		await writeFile(target, "old", { mode: 0o755 });
		try {
			spyOn(globalThis, "fetch").mockImplementation((async (url: string) =>
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
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("does nothing when running from source or when declined", async () => {
		let asked = false;
		const ask = async () => {
			asked = true;
			return false;
		};
		expect(await selfUpdate(null, async () => manifest("x"), ask)).toBe(false);
		expect(asked).toBe(false);
	});
});
