#!/usr/bin/env bun
import { resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { apps, registry } from "./apps/index.ts";
import { runAll, runApp } from "./core/runner.ts";
import { context } from "./core/system.ts";
import type { UI } from "./core/types.ts";

export interface CliOptions {
	name?: string;
	action: "inspect" | "update" | "clean";
	appPath?: string;
	help: boolean;
	version: boolean;
	yes: boolean;
}
export function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		action: "inspect",
		help: false,
		version: false,
		yes: false,
	};
	const positional: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") options.help = true;
		else if (arg === "--version" || arg === "-v") options.version = true;
		else if (arg === "--yes" || arg === "-y") options.yes = true;
		else if (arg === "--app-path") {
			const path = args[++i];
			if (!path || path.startsWith("-"))
				throw new Error("--app-path requires a path");
			options.appPath = resolve(path);
		} else if (arg?.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
		else if (arg) positional.push(arg);
	}
	if (positional.length > 2)
		throw new Error("Usage: sod-off <app> [update|clean]");
	options.name = positional[0];
	if (options.name === "all" && options.appPath)
		throw new Error("--app-path cannot be used with all");
	const action = positional[1];
	if (action && action !== "update" && action !== "clean")
		throw new Error(`Unknown subcommand: ${action}`);
	options.action =
		action === "update" || action === "clean" ? action : "inspect";
	return options;
}
export function help(): string {
	return `sod-off — inspect, update and clean installed macOS apps\n\nUsage: sod-off <app|all> [update|clean] [--app-path <path>] [--yes]\n\n${apps.map((app) => `  ${app.name.padEnd(14)} ${app.displayName} (${[app.update && "update", app.clean && "clean"].filter(Boolean).join(", ")})`).join("\n")}\n\nall: run on every installed app; skip missing apps.\n\nWithout a subcommand: show primary location, version and disk usage.\nupdate: inspect a downloaded release, then confirm replacement.\nclean: preview every cache / inactive version and its full size, then confirm deletion.\n\n--app-path <path>  Select a primary app bundle or CLI launcher\n-y, --yes          Accept all confirmations, including non-interactive runs\n-h, --help         Show help\n-v, --version      Show sod-off version\n\nConfirmation defaults to No. Non-interactive runs only show previews unless --yes is supplied.\n`;
}
export async function confirmPrompt(
	readline: Interface,
	message: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const closed = new Promise<string>((resolve) =>
			readline.once("close", () => resolve("")),
		);
		const answer = await Promise.race([
			readline.question(`${message} [y/N] `, { signal }),
			closed,
		]);
		return /^(y|yes)$/i.test(answer.trim());
	} catch {
		return false;
	} finally {
		readline.close();
	}
}
export function terminalUI(signal?: AbortSignal, yes = false): UI {
	return {
		log: (message) => console.log(message),
		confirm: async (message) => {
			signal?.throwIfAborted();
			if (yes) return true;
			if (!process.stdin.isTTY || !process.stdout.isTTY) {
				console.log("No interactive terminal; nothing changed.");
				return false;
			}
			const readline = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			return confirmPrompt(readline, message, signal);
		},
	};
}
export async function run(args = process.argv.slice(2)): Promise<void> {
	const options = parseArgs(args);
	if (options.version) {
		console.log("1.0.0");
		return;
	}
	if (options.help || !options.name) {
		console.log(help());
		return;
	}
	const app = registry(apps).get(options.name);
	if (!app && options.name !== "all")
		throw new Error(`Unknown app: ${options.name}. Run sod-off --help.`);
	const abort = new AbortController();
	const cancel = () => abort.abort(new Error("Interrupted."));
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	try {
		const ctx = context(options.appPath, abort.signal);
		const ui = terminalUI(abort.signal, options.yes);
		if (options.name === "all") await runAll(apps, options.action, ctx, ui);
		else if (app) await runApp(app, options.action, ctx, ui);
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}
if (import.meta.main)
	run().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
