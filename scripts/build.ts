/** Compiles sod-off for every release build into dist/; needs `bun` on PATH. */
import { execFileSync } from "node:child_process";
import { asset, builds } from "./builds.ts";

for (const build of builds)
	execFileSync(
		"bun",
		[
			"build",
			"./src/main.ts",
			"--compile",
			`--target=bun-${build.replace("win32", "windows")}`,
			`--outfile=dist/${asset(build)}`,
		],
		{ stdio: "inherit" },
	);
