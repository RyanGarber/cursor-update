import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testContext, testPaths } from "../tests.ts";
import { bundle, caches, cli } from "./shared.ts";

// Not on any PATH, so discovery falls back to ~/.local/bin.
const name = `sod-off-test-${crypto.randomUUID()}`;

describe("cli", () => {
	it("finds a launcher in ~/.local/bin and reads its version", () =>
		testPaths([".local/bin"], async (home, [bin]) => {
			await writeFile(join(bin!, name), "");
			expect(
				await cli({ ...testContext([], `${name} 1.2.3-beta.4 (x)`), home }, [
					`${name}-missing`,
					name,
				]),
			).toEqual({
				path: join(bin!, name),
				payload: join(bin!, name),
				version: "1.2.3-beta.4",
				kind: "cli",
			});
		}));

	it("skips launchers whose payload is not accepted", () =>
		testPaths([".local/bin"], async (home, [bin]) => {
			await writeFile(join(bin!, name), "");
			expect(
				await cli({ ...testContext([], "1.0.0"), home }, name, () => false),
			).toBeNull();
		}));

	it("rejects an unrecognized version", () =>
		testPaths([".local/bin"], async (home, [bin]) => {
			await writeFile(join(bin!, name), "");
			await expect(
				cli({ ...testContext([], "unknown"), home }, name),
			).rejects.toThrow("Unrecognized");
		}));

	it("finds nothing when not installed", async () => {
		expect(await cli(testContext(), name)).toBeNull();
	});
});

describe("bundle", () => {
	it("reads an expected bundle's identity and version", () =>
		testPaths(["Example.app"], async (home, [app]) => {
			const context = {
				...testContext(),
				home,
				appPath: app,
				command: async (args: string[]) =>
					args[2] === "Print :CFBundleIdentifier" ? "com.example" : "3.1.4",
			};
			expect(await bundle(context, [], ["com.example"])).toMatchObject({
				path: app,
				kind: "bundle",
				version: "3.1.4",
				bundleId: "com.example",
			});
			await expect(bundle(context, [], ["com.other"])).rejects.toThrow(
				"Unexpected application",
			);
		}));
});

describe("caches", () => {
	it("lists only caches that exist", () =>
		testPaths(["Library/Caches/present"], async (home, [present]) => {
			expect(
				await caches({ ...testContext(), home }, [
					"Library/Caches/present",
					"Library/Caches/missing",
				]),
			).toEqual([
				{ path: present, label: "Library/Caches/present", kind: "cache" },
			]);
		}));
});
