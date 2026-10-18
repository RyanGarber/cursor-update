#!/usr/bin/env bun
/** Compiles sod-off for every release build into dist/, named by its manifest key. */
import { $ } from "bun";

export const builds = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64",
] as const;
export const asset = (build: string) =>
	`sod-off-${build}${build.startsWith("win32-") ? ".exe" : ""}`;

if (import.meta.main)
	for (const build of builds) {
		const target = `bun-${build.replace("win32", "windows")}`;
		await $`bun build ./src/index.ts --compile --target=${target} --outfile dist/${asset(build)}`;
	}
