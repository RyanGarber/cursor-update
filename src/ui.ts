import { confirm, log } from "@clack/prompts";
import { Listr } from "listr2";
import type { UI } from "./core/types.ts";

export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.min(
		units.length - 1,
		Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))),
	);
	const size = bytes / 1024 ** i;
	return `${size.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

/** Label/value rows aligned into columns; empty values are left out. */
export function fields(rows: Record<string, string | undefined>): string {
	const entries = Object.entries(rows).filter(
		(entry): entry is [string, string] => entry[1] !== undefined,
	);
	const width = Math.max(...entries.map(([label]) => label.length));
	return entries
		.map(([label, value]) => `${label.padEnd(width)}  ${value}`)
		.join("\n");
}

export function interactive(): boolean {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// Task lines carry no guide bar, so messages leave it out too and line up with them.
const line = { secondarySymbol: " ", spacing: 0 };

/** Clack for messages and prompts; each task is a listr2 list of its own, so prompts never land inside one. */
export function terminalUI(signal?: AbortSignal, yes = false): UI {
	return {
		log: (message) => log.info(message, line),
		warn: (message) => log.warn(message, line),
		success: (message) => log.success(message, line),
		// A heading over indented lines rather than a box, which would wrap long paths.
		note: (title, body) => {
			log.step(title, { ...line, spacing: 1 });
			log.message(body, { ...line, symbol: " " });
		},
		task: async <T>(title: string, run: () => Promise<T>) => {
			let result: T | undefined;
			await new Listr(
				[
					{
						title,
						task: async () => {
							result = await run();
						},
					},
				],
				{
					registerSignalListeners: false,
					rendererOptions: { showErrorMessage: false },
				},
			).run();
			return result as T;
		},
		confirm: async (message) => {
			signal?.throwIfAborted();
			if (yes) {
				log.step(`${message} Yes (--yes)`, line);
				return true;
			}
			if (!interactive()) {
				log.warn(`${message} No interactive terminal; nothing changed.`, line);
				return false;
			}
			// Cancelling the prompt declines, like answering No.
			return (await confirm({ message, initialValue: false, signal })) === true;
		},
	};
}
