import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fields, formatBytes } from "../ui.ts";
import { compareVersions, type Prepared, prepare } from "./artifact.ts";
import { versions } from "./discovery.ts";
import { link, replace } from "./operations.ts";
import {
	children,
	contains,
	exists,
	identity,
	roots,
	safePath,
	usage,
} from "./system.ts";
import type {
	AppContext,
	AppModule,
	CleanupTarget,
	CommandStats,
	Installation,
	OperationContext,
	Release,
	UI,
	Usage,
} from "./types.ts";

export interface Operation {
	prepare(context: OperationContext, release: Release): Promise<Prepared>;
	replace: typeof replace;
	link: typeof link;
}
const _operations: Operation = { prepare, replace, link };
export function managedRoot(context: AppContext, app: AppModule): string {
	return join(context.home, ".local/share/sod-off", app.name, "versions");
}
async function targets(
	context: AppContext,
	app: AppModule,
	installed: Installation | null,
): Promise<CleanupTarget[]> {
	const items = [
		...((await app.clean?.(context, installed)) ?? []),
		...(await versions(managedRoot(context, app), installed?.payload, /.+/)),
	];
	const unique = roots(items.map((i) => i.path));
	return unique.map((path) => {
		const item = items.find((i) => resolve(i.path) === path);
		if (!item) throw new Error(`Missing cleanup description: ${path}`);
		return { ...item, path };
	});
}
async function protectedTarget(
	path: string,
	installed: Installation | null,
	context: AppContext,
): Promise<void> {
	await safePath(path);
	if (resolve(path) === context.home)
		throw new Error(`Refusing to delete home directory: ${path}`);
	for (const active of installed
		? [installed.path, installed.storage ?? installed.payload]
		: []) {
		if (contains(path, active) || contains(active, path))
			throw new Error(`Cleanup overlaps primary installation: ${path}`);
	}
	if ((await lstat(path)).isSymbolicLink())
		throw new Error(`Refusing to clean symlink: ${path}`);
}
async function running(
	context: AppContext,
	paths: string[],
	executable?: string,
): Promise<void> {
	const processes = await context.command(["/bin/ps", "-axo", "command="]);
	const match = processes
		.split("\n")
		.find(
			(line) =>
				(executable !== undefined &&
					(line.trim() === executable ||
						line.trim().startsWith(`${executable} `))) ||
				paths.some(
					(path) =>
						line.trim().startsWith(`${path}/`) ||
						line.trim() === path ||
						line.trim().startsWith(`${path} `),
				),
		);
	if (match)
		throw new Error(
			`Quit the app and its running CLI sessions before continuing: ${match.trim()}`,
		);
}
async function fingerprint(path: string): Promise<string> {
	const hash = createHash("sha256");
	async function visit(entry: string): Promise<void> {
		hash.update(entry).update(await identity(entry));
		if ((await exists(entry)) && (await lstat(entry)).isDirectory()) {
			for (const child of await children(entry)) await visit(child);
		}
	}
	await visit(path);
	return hash.digest("hex");
}
function size(usage: Usage): string {
	return `${formatBytes(usage.bytes)} files; ${formatBytes(usage.allocated)} on disk`;
}
/** Cache contents are volatile; approval applies to the directory, not its snapshot. */
async function cleanupIdentity(item: CleanupTarget): Promise<string> {
	if (item.kind === "version") return fingerprint(item.path);
	const stat = await lstat(item.path);
	return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.mode & 0o170000}`;
}
/** Core owns measurement, confirmation, mutations and accounting, including failed commands. */
export async function runApp(
	app: AppModule,
	action: "inspect" | "update" | "clean",
	context: AppContext,
	ui: UI,
	operations: Operation = _operations,
): Promise<CommandStats> {
	if (action !== "inspect" && !app[action])
		throw new Error(`${app.name} does not support ${action}`);
	if (action === "inspect")
		return execute(app, action, context, ui, operations);
	const lock = join(
		await realpath(tmpdir()),
		`sod-off-${process.getuid?.() ?? "user"}-${app.name}.lock`,
	);
	await safePath(lock);
	await mkdir(dirname(lock), { recursive: true });
	try {
		await writeFile(lock, String(process.pid), { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error(
				`Another command holds ${lock}. If its process has exited, remove this stale lock.`,
			);
		throw error;
	}
	try {
		return await execute(app, action, context, ui, operations);
	} finally {
		await rm(lock, { force: true });
	}
}
async function execute(
	app: AppModule,
	action: "inspect" | "update" | "clean",
	context: AppContext,
	ui: UI,
	operations: Operation,
): Promise<CommandStats> {
	const { installed, discovered, tracked, before } = await ui.task(
		`Inspecting ${app.displayName}`,
		async () => {
			const installed = await app.inspect(context);
			const discovered = await targets(context, app, installed);
			const tracked = [
				...discovered.map((i) => i.path),
				managedRoot(context, app),
				...(installed
					? [installed.path, installed.storage ?? installed.payload]
					: []),
			];
			return { installed, discovered, tracked, before: await usage(tracked) };
		},
	);
	const operationContext: OperationContext = {
		...context,
		track: (path) => tracked.push(path),
	};
	let after = before;
	ui.note(
		app.displayName,
		fields({
			Version: installed?.version ?? "not installed",
			Location: installed?.path ?? context.appPath ?? "not found",
			Payload:
				installed && installed.path !== installed.payload
					? installed.payload
					: undefined,
		}),
	);
	try {
		if (action === "clean") {
			const plan = await ui.task(
				`Measuring ${discovered.length} cache / inactive-version paths`,
				async () => {
					const plan = [];
					for (const item of discovered) {
						await protectedTarget(item.path, installed, context);
						const size = await usage([item.path]);
						plan.push({
							...item,
							size,
							signature: await cleanupIdentity(item),
						});
					}
					return plan;
				},
			);
			if (!plan.length) ui.log("No caches or inactive versions found.");
			else {
				const total = await usage(plan.map((i) => i.path));
				ui.note(
					`Clean ${app.displayName}`,
					[
						...plan.map(
							(item) =>
								`${item.label} (${item.kind})\n  ${item.path}\n  ${size(item.size)}`,
						),
						`Total: ${size(total)}`,
					].join("\n"),
				);
				ui.warn("Close the app before deleting caches.");
				if (await ui.confirm(`Delete these ${plan.length} paths?`)) {
					// Revalidate the entire plan before the first deletion.
					context.signal?.throwIfAborted();
					const current = await app.inspect(context);
					await running(
						context,
						[
							...plan.map((i) => i.path),
							...(current ? [current.payload, current.path] : []),
						],
						current?.kind === "cli" ? basename(current.path) : undefined,
					);
					for (const item of plan) {
						await protectedTarget(item.path, current, context);
						if ((await cleanupIdentity(item)) !== item.signature)
							throw new Error(
								`Path changed since preview: ${item.path}; run clean again.`,
							);
					}

					for (const item of plan) {
						context.signal?.throwIfAborted();
						if (item.kind === "cache") {
							const current = await usage([item.path]);
							if (
								current.bytes !== item.size.bytes ||
								current.allocated !== item.size.allocated
							)
								ui.log(`Cache size refreshed: ${item.path}\n${size(current)}`);
						}
						await ui.task(`Delete ${item.path}`, () =>
							rm(item.path, { recursive: true }),
						);
					}
				} else ui.log("Cancelled.");
			}
		} else if (action === "update") {
			if (!installed)
				throw new Error(
					"No primary installation found. Install the app first or select it with --app-path.",
				);
			// Do not rewrite package-manager-owned executables or app bundles behind their backs.
			if (
				/(\/Cellar\/|\/Caskroom\/|\/node_modules\/|\/JetBrains\/Toolbox\/)/.test(
					installed.payload,
				)
			)
				throw new Error(
					"This installation is package-manager owned. Update it with its package manager, or select a standalone install using --app-path.",
				);
			const release = await ui.task(
				"Checking for the latest release",
				async () => app.update?.(context, installed),
			);
			if (!release) throw new Error("No release found");
			if (
				release.version &&
				installed.version &&
				compareVersions(release.version, installed.version) <= 0
			)
				ui.log(`Already current (latest published: ${release.version}).`);
			else {
				// Temporary files are removed when the command finishes.
				const prepared = await ui.task(
					`Downloading and inspecting ${release.url}`,
					() => operations.prepare(operationContext, release),
				);
				try {
					if (
						installed.version &&
						compareVersions(prepared.version, installed.version) <= 0
					) {
						ui.log(`Already current (latest published: ${prepared.version}).`);
					} else {
						const target =
							installed.kind === "bundle"
								? installed.payload
								: join(managedRoot(context, app), prepared.version);
						tracked.push(target);
						await safePath(target);
						await safePath(installed.path);
						const old = await usage([installed.storage ?? installed.payload]);
						const snapshot = await identity(installed.path);
						const payloadSnapshot = await fingerprint(installed.payload);
						const cli = installed.kind === "cli";
						ui.note(
							`Update ${app.displayName}`,
							fields({
								Version: `${installed.version ?? "unknown"} → ${prepared.version}`,
								Download: formatBytes(prepared.download.bytes),
								[cli ? "New package" : "New bundle"]: size(prepared.unpacked),
								Current: size(old),
								Overwrite: cli ? installed.path : target,
								"Install to": cli ? target : undefined,
								"Point to": cli
									? join(target, prepared.executable ?? "")
									: undefined,
							}),
						);
						if (cli)
							ui.log(
								installed.path !== installed.payload
									? "The old payload remains available for clean."
									: "The existing standalone executable will be replaced.",
							);
						ui.warn(
							"Close the app and its running sessions before proceeding.",
						);
						if (await ui.confirm("Replace this installation?")) {
							context.signal?.throwIfAborted();
							const current = await app.inspect(context);
							if (
								!current ||
								current.payload !== installed.payload ||
								current.version !== installed.version ||
								(await identity(installed.path)) !== snapshot ||
								(await fingerprint(installed.payload)) !== payloadSnapshot
							)
								throw new Error(
									"Primary installation changed since preview; run update again.",
								);
							await ui.task("Replacing the installation", async () => {
								await running(
									context,
									[installed.path, installed.storage ?? installed.payload],
									installed.kind === "cli"
										? basename(installed.path)
										: undefined,
								);
								const verify = async () => {
									const updated = await app.inspect(context);
									if (updated?.version !== prepared.version)
										throw new Error("Installed version verification failed");
								};
								if (installed.kind === "bundle")
									await operations.replace(
										operationContext,
										prepared.source,
										target,
										verify,
									);
								else {
									if (await exists(target))
										throw new Error(
											`New payload target already exists: ${target}; clean it first.`,
										);
									await operations.replace(
										operationContext,
										prepared.source,
										target,
										async () => {},
									);
									try {
										await operations.link(
											operationContext,
											join(target, prepared.executable ?? ""),
											installed.path,
											verify,
										);
									} catch (error) {
										// A cleanup failure after a successful switch must not remove the live payload.
										if (
											!(await exists(installed.path)) ||
											!contains(target, await realpath(installed.path))
										) {
											await rm(target, { recursive: true, force: true });
										}
										throw error;
									}
								}
							});
							ui.success(`Updated to ${prepared.version}.`);
						} else ui.log("Cancelled.");
					}
				} finally {
					await prepared.dispose();
				}
			}
		} else {
			ui.log(
				`${discovered.length} cache / inactive-version paths discovered. Run sod-off ${app.name} clean to review them.`,
			);
		}
	} finally {
		after = await usage(tracked);
		const delta = before.allocated - after.allocated;
		ui.log(
			`Space tracked: ${formatBytes(before.allocated)} before → ${formatBytes(after.allocated)} after (${formatBytes(Math.abs(delta))} ${delta >= 0 ? "reclaimed" : "added"}).\nDisk figures count allocated blocks; APFS shared blocks and concurrent app activity can affect actual free space.`,
		);
	}
	return { before, after };
}

/**
 * `update --clean`: updates, then cleans what the update left behind, such as
 * the previous version. A failed update skips the clean.
 */
export async function updateAndClean(
	app: AppModule,
	context: AppContext,
	ui: UI,
	runner: typeof runApp = runApp,
): Promise<CommandStats> {
	const update = await runner(app, "update", context, ui);
	if (!app.clean) return update;
	const clean = await runner(app, "clean", context, ui);
	return { before: update.before, after: clean.after };
}
/** Run installed apps sequentially, retaining failures until every app was attempted. */
export async function runAll(
	apps: readonly AppModule[],
	action: "inspect" | "update" | "clean",
	context: AppContext,
	ui: UI,
	runner: typeof runApp = runApp,
): Promise<void> {
	if (context.appPath) throw new Error("--app-path cannot be used with all");
	const errors: Error[] = [];
	for (const app of apps) {
		context.signal?.throwIfAborted();
		try {
			if (!(await app.inspect(context))) {
				ui.log(`${app.displayName}: skipped (not installed).`);
				continue;
			}
			await runner(app, action, context, ui);
		} catch (error) {
			context.signal?.throwIfAborted();
			const failure = new Error(
				`${app.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
			errors.push(failure);
			ui.warn(failure.message);
		}
	}
	if (errors.length)
		throw new AggregateError(
			errors,
			`${errors.length} app(s) failed: ${errors.map((error) => error.message).join("; ")}`,
		);
}
