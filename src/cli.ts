import { resolve } from "node:path";
import {
	command,
	commandLine,
	constant,
	lineBreak,
	map,
	merge,
	message,
	object,
	option,
	optional,
	or,
	type Parser,
	text,
} from "@optique/core";
import { defineProgram } from "@optique/core/program";
import { path } from "@optique/run";
import pkg from "../package.json" with { type: "json" };
import { apps, available } from "./apps/index.ts";
import { currentPlatform } from "./core/system.ts";
import type { AppModule, Platform } from "./core/types.ts";

export type Action = "inspect" | "update" | "clean";
// A type rather than an interface, so `merge` can tell it is an object.
export type AppOptions = {
	/** An app's name, or `all`. */
	app: string;
	appPath?: string;
	action: Action;
	/** `update --clean`: clean after updating. */
	clean: boolean;
};

const update = command(
	"update",
	object({
		action: constant("update"),
		clean: option("--clean", {
			description: message`Clean after updating; each step is confirmed separately.`,
		}),
	}),
	{
		description: message`Inspect a downloaded release, then confirm replacing the installation.`,
	},
);
const clean = command("clean", object({ action: constant("clean") }), {
	description: message`Preview every cache and inactive version with its full size, then confirm deleting them.`,
});

/** The subcommands an app supports (all of them for `all`); without one, the app is inspected. */
function subcommands(app?: AppModule) {
	const supported: (typeof update | typeof clean)[] = [
		...(!app || app.update ? [update] : []),
		...(!app || app.clean ? [clean] : []),
	];
	return map(
		optional(or(...supported)),
		(value): Omit<AppOptions, "app"> => ({
			action: value?.action ?? "inspect",
			clean: value?.action === "update" && value.clean,
		}),
	);
}

function appCommand(app: AppModule, supported: boolean) {
	const actions = [app.update && "update", app.clean && "clean"].filter(
		Boolean,
	);
	return command(
		app.name,
		merge(
			object({
				app: constant(app.name),
				appPath: optional(
					map(
						option("--app-path", path({ mustExist: true }), {
							description: message`Select a primary app bundle or CLI launcher.`,
						}),
						(path) => resolve(path),
					),
				),
			}),
			subcommands(app),
		),
		{
			brief: message`${text(`${app.displayName} (${actions.join(", ")})`)}`,
			description: message`Show ${text(app.displayName)}'s primary location, version and disk usage.`,
			// An app for another operating system still parses, so running it can say why it is unavailable.
			hidden: supported ? undefined : true,
		},
	);
}

/** The command line, built from the apps an operating system supports. */
export function parser(
	modules: readonly AppModule[] = apps,
	platform: Platform = currentPlatform(),
) {
	const supported = available(modules, platform);
	const commands: Parser<"sync", AppOptions, unknown>[] = [
		command("all", merge(object({ app: constant("all") }), subcommands()), {
			brief: message`Every installed app; missing apps are skipped.`,
		}),
		...modules.map((app) => appCommand(app, supported.includes(app))),
	];
	return or(
		merge(
			object({
				yes: option("-y", "--yes", {
					description: message`Accept all confirmations, including non-interactive runs.`,
				}),
			}),
			or(...commands),
		),
		command("man", object({ man: constant(true) }), {
			brief: message`Print the manual page.`,
		}),
	);
}

export const program = defineProgram({
	parser: parser(),
	metadata: {
		name: "sod-off",
		version: pkg.version,
		brief: message`Inspect, update and clean installed apps.`,
		description: message`Without a subcommand, show an app's primary location, version and disk usage. ${commandLine("update")} downloads and inspects the latest release before asking to replace the installation; ${commandLine("clean")} previews every cache and inactive version before asking to delete them.`,
		examples: message`${commandLine("sod-off cursor")}${lineBreak()}${commandLine("sod-off idea update")}${lineBreak()}${commandLine("sod-off all update --clean -y")}${lineBreak()}${commandLine('sod-off codex --app-path "$HOME/.local/bin/codex"')}`,
		footer: message`Confirmations default to No. Non-interactive runs only show previews unless ${commandLine("--yes")} is supplied.`,
	},
});
