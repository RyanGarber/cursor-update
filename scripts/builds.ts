/** Every release build, named by its key in latest.json (`<platform>-<arch>`). */
export const builds = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64",
] as const;
export const asset = (build: string) =>
	`sod-off-${build}${build.startsWith("win32-") ? ".exe" : ""}`;
