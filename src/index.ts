import { generateManPage } from "@optique/man";
import { type RunOptions, runSync } from "@optique/run";
import { apps, available, registry } from "./apps/index.ts";
import { type AppOptions, program } from "./cli.ts";
import { runAll, runApp, updateAndClean } from "./core/runner.ts";
import { appContext, currentPlatform, platformNames } from "./core/system.ts";
import { interactive, terminalUI } from "./ui.ts";
import {
	binary,
	check,
	cleanup,
	install,
	type Manifest,
	version,
} from "./update.ts";

export const options = {
	help: "option",
	version: { value: version, option: { names: ["-v", "--version"] } },
	completion: "command",
} as const satisfies RunOptions;

/**
 * Offers a newer release before anything else runs. Only an interactive
 * terminal is asked (`--yes` does not answer it); a failed check stays silent.
 * Returns whether sod-off was replaced, so the caller exits to be relaunched.
 */
export async function selfUpdate(
	target = binary(),
	find: () => Promise<Manifest | null> = () => check(),
	ui = terminalUI(),
): Promise<boolean> {
	if (!target) return false;
	await cleanup(target);
	if (!interactive()) return false;
	const manifest = await find().catch(() => null);
	if (!manifest) return false;
	if (
		!(await ui.confirm(
			`sod-off ${manifest.version} is available (installed: ${version}). Update now?`,
		))
	)
		return false;
	await ui.task(`Updating sod-off to ${manifest.version}`, () =>
		install(manifest, target),
	);
	ui.success(`Updated sod-off to ${manifest.version}. Run your command again.`);
	return true;
}

export async function run(args = process.argv.slice(2)): Promise<void> {
	// Without arguments there is nothing to run, so show what can be.
	const parsed = runSync(program, {
		...options,
		args: args.length ? args : ["--help"],
	});
	if ("man" in parsed) {
		console.log(generateManPage(program, { section: 1, date: new Date() }));
		return;
	}
	if (await selfUpdate()) return;
	await execute(parsed);
}

async function execute(options: AppOptions & { yes: boolean }): Promise<void> {
	const platform = currentPlatform();
	const supported = available(apps, platform);
	const app = registry(supported).get(options.app);
	if (!app && options.app !== "all")
		throw new Error(
			`${options.app} is not available on ${platformNames[platform]}.`,
		);
	if (!supported.length) {
		console.log(`No apps are available on ${platformNames[platform]} yet.`);
		return;
	}
	const abort = new AbortController();
	const cancel = () => abort.abort(new Error("Interrupted."));
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	try {
		const context = appContext(options.appPath, abort.signal);
		const ui = terminalUI(abort.signal, options.yes);
		const runner: typeof runApp = (app, action, context, ui) =>
			options.clean
				? updateAndClean(app, context, ui)
				: runApp(app, action, context, ui);
		if (options.app === "all")
			await runAll(supported, options.action, context, ui, runner);
		else if (app) await runner(app, options.action, context, ui);
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}
