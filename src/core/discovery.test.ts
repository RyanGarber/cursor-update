import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { testPaths } from "../tests.ts";
import { versions } from "./discovery.ts";

describe("versions", () => {
	it("lists matching versions except the active one and symlinks", () =>
		testPaths(
			["versions/1.0.0", "versions/2.0.0", "versions/latest", "versions/tmp"],
			async (home, [old, active]) => {
				await symlink(old!, join(home, "versions/3.0.0"));
				expect(
					(
						await versions(
							join(home, "versions"),
							join(active!, "bin/tool"),
							/^\d+\.\d+\.\d+$/,
						)
					).map((item) => item.path),
				).toEqual([old]);
			},
		));
});
