import { lstat } from "node:fs/promises";
import { basename } from "node:path";
import { children, contains } from "./system.ts";
import type { CleanupTarget } from "./types.ts";

export async function versions(
	root: string,
	active: string | undefined,
	match: RegExp,
): Promise<CleanupTarget[]> {
	const result: CleanupTarget[] = [];
	for (const path of await children(root)) {
		if (!match.test(basename(path)) || (await lstat(path)).isSymbolicLink())
			continue;
		if (active && contains(path, active)) continue;
		result.push({
			path,
			label: `Installed version ${basename(path)}`,
			kind: "version",
		});
	}
	return result;
}
