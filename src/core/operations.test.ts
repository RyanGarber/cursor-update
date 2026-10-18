import {
	readdir,
	readFile,
	realpath,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { testContext, testPaths } from "../tests.ts";
import { link, replace } from "./operations.ts";
import { command } from "./system.ts";

const macOS = process.platform === "darwin";

/** An installed 1.0.0 bundle and a staged 2.0.0 release beside it. */
function fixture(
	run: (home: string, primary: string, source: string) => Promise<void>,
) {
	return testPaths(
		["Example.app", "release.app"],
		async (home, [primary, source]) => {
			await writeFile(join(primary!, "version"), "1.0.0");
			await writeFile(join(source!, "version"), "2.0.0");
			await run(home, primary!, source!);
		},
	);
}

describe("replace", () => {
	// Replaces bundles with ditto, which only macOS ships.
	it.skipIf(!macOS)("swaps in the new bundle once verified", () =>
		fixture(async (home, primary, source) => {
			await replace(
				{ ...testContext(), home, command },
				source,
				primary,
				async () => {},
			);
			expect(await readFile(join(primary, "version"), "utf8")).toBe("2.0.0");
			// Neither the staged copy nor the backup is left behind.
			expect((await readdir(home)).sort()).toEqual([
				"Example.app",
				"release.app",
			]);
		}),
	);

	it.skipIf(!macOS)(
		"restores the old bundle when post-install verification fails",
		() =>
			fixture(async (home, primary, source) => {
				await expect(
					replace(
						{ ...testContext(), home, command },
						source,
						primary,
						async () => {
							throw new Error("bad version");
						},
					),
				).rejects.toThrow("bad version");
				expect(await readFile(join(primary, "version"), "utf8")).toBe("1.0.0");
			}),
	);
});

describe("link", () => {
	it("points a launcher at the new payload once verified", () =>
		fixture(async (home, primary, source) => {
			const launcher = join(home, "launcher");
			await symlink(join(primary, "version"), launcher);
			await link(
				{ ...testContext(), home },
				join(source, "version"),
				launcher,
				async () => {},
			);
			expect(await realpath(launcher)).toBe(join(source, "version"));
			expect((await readdir(home)).sort()).toEqual([
				"Example.app",
				"launcher",
				"release.app",
			]);
		}));

	it("restores a launcher symlink when verification fails", () =>
		fixture(async (home, primary, source) => {
			const launcher = join(home, "launcher");
			await symlink(join(primary, "version"), launcher);
			await expect(
				link(
					{ ...testContext(), home },
					join(source, "version"),
					launcher,
					async () => {
						throw new Error("bad version");
					},
				),
			).rejects.toThrow("bad version");
			expect(await realpath(launcher)).toBe(join(primary, "version"));
		}));
});
