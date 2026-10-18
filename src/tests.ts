import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppContext, UI } from "./core/types.ts";

/**
 * Test context with a fake home directory.
 */
export function testContext(
	commands?: string[][],
	version?: string,
): AppContext {
	return {
		platform: "darwin",
		architecture: "arm64",
		home: "/tmp/fake",
		text: async () => "",
		json: async <T>() => ({}) as T,
		command: async (args) => {
			if (commands) {
				commands.push(args);
			}
			if (version && args[1] === "--version") {
				return version;
			}
			return "";
		},
	};
}

/**
 * Run a test with a temporary home directory and cleanup.
 */
export async function testPaths(
	paths: (string | string[])[],
	run: (home: string, paths: string[]) => Promise<unknown> | unknown,
) {
	const home = await realpath(await mkdtemp(join(tmpdir(), "sod-clean-")));
	try {
		const absolute = paths.map((path) => join(home, ...[path].flat()));
		for (const path of absolute) {
			await mkdir(path, { recursive: true });
		}
		return await run(home, absolute);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

/**
 * Test UI that records every message, runs tasks inline and declines confirmations.
 */
export function testUI(logs: string[] = []): UI {
	return {
		log: (message) => logs.push(message),
		warn: (message) => logs.push(message),
		success: (message) => logs.push(message),
		note: (title, body) => logs.push(`${title}\n${body}`),
		task: (_title, run) => run(),
		confirm: async () => false,
	};
}
