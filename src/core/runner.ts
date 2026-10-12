import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatBytes } from "../ui.ts";
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
} from "./types.ts";

export interface Services {
	prepare(ctx: OperationContext, release: Release, ui: UI): Promise<Prepared>;
	replace: typeof replace;
	link: typeof link;
}
const services: Services = { prepare, replace, link };
export function managedRoot(ctx: AppContext, app: AppModule): string {
	return join(ctx.home, ".local/share/sod-off", app.name, "versions");
}
async function targets(
	ctx: AppContext,
	app: AppModule,
	installed: Installation | null,
): Promise<CleanupTarget[]> {
	const items = [
		...((await app.clean?.(ctx, installed)) ?? []),
		...(await versions(managedRoot(ctx, app), installed?.payload, /.+/)),
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
	ctx: AppContext,
): Promise<void> {
	await safePath(path);
	if (resolve(path) === ctx.home)
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
	ctx: AppContext,
	paths: string[],
	executable?: string,
): Promise<void> {
	const processes = await ctx.command(["/bin/ps", "-axo", "command="]);
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
	ctx: AppContext,
	ui: UI,
	ops: Services = services,
): Promise<CommandStats> {
	if (action !== "inspect" && !app[action])
		throw new Error(`${app.name} does not support ${action}`);
	if (action === "inspect") return execute(app, action, ctx, ui, ops);
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
		return await execute(app, action, ctx, ui, ops);
	} finally {
		await rm(lock, { force: true });
	}
}
async function execute(
	app: AppModule,
	action: "inspect" | "update" | "clean",
	ctx: AppContext,
	ui: UI,
	ops: Services,
): Promise<CommandStats> {
	const installed = await app.inspect(ctx);
	const discovered = await targets(ctx, app, installed);
	const tracked = [
		...discovered.map((i) => i.path),
		managedRoot(ctx, app),
		...(installed
			? [installed.path, installed.storage ?? installed.payload]
			: []),
	];
	const operationContext: OperationContext = {
		...ctx,
		track: (path) => tracked.push(path),
	};
	const before = await usage(tracked);
	let after = before;
	ui.log(
		`${app.displayName}: ${installed?.version ?? "not installed"}\nPrimary location: ${installed?.path ?? ctx.appPath ?? "not found"}`,
	);
	if (installed && installed.path !== installed.payload)
		ui.log(`Resolved payload: ${installed.payload}`);
	try {
		if (action === "clean") {
			const plan = [];
			for (const item of discovered) {
				await protectedTarget(item.path, installed, ctx);
				const size = await usage([item.path]);
				plan.push({ ...item, size, signature: await cleanupIdentity(item) });
				ui.log(
					`Delete ${item.kind}: ${item.label}\n  ${item.path}\n  ${formatBytes(size.bytes)} files; ${formatBytes(size.allocated)} on disk`,
				);
			}
			if (!plan.length) ui.log("No caches or inactive versions found.");
			else {
				const total = await usage(plan.map((i) => i.path));
				ui.log(
					`Total selected: ${formatBytes(total.bytes)} files; ${formatBytes(total.allocated)} on disk. Close the app before deleting caches.`,
				);
				if (await ui.confirm(`Delete these ${plan.length} paths?`)) {
					// Revalidate the entire plan before the first deletion.
					ctx.signal?.throwIfAborted();
					const current = await app.inspect(ctx);
					await running(
						ctx,
						[
							...plan.map((i) => i.path),
							...(current ? [current.payload, current.path] : []),
						],
						current?.kind === "cli" ? basename(current.path) : undefined,
					);
					for (const item of plan) {
						await protectedTarget(item.path, current, ctx);
						if ((await cleanupIdentity(item)) !== item.signature)
							throw new Error(
								`Path changed since preview: ${item.path}; run clean again.`,
							);
					}

					for (const item of plan) {
						ctx.signal?.throwIfAborted();
						if (item.kind === "cache") {
							const size = await usage([item.path]);
							if (
								size.bytes !== item.size.bytes ||
								size.allocated !== item.size.allocated
							)
								ui.log(
									`Cache size refreshed: ${item.path}\n  ${formatBytes(size.bytes)} files; ${formatBytes(size.allocated)} on disk`,
								);
						}
						await rm(item.path, { recursive: true });
						ui.log(`Deleted ${item.path}`);
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
			const release = await app.update?.(ctx, installed);
			if (!release) throw new Error("No release found");
			if (
				release.version &&
				installed.version &&
				compareVersions(release.version, installed.version) <= 0
			)
				ui.log(`Already current (latest published: ${release.version}).`);
			else {
				const prepared = await ops.prepare(operationContext, release, ui);
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
								: join(managedRoot(ctx, app), prepared.version);
						tracked.push(target);
						await safePath(target);
						await safePath(installed.path);
						const old = await usage([installed.storage ?? installed.payload]);
						const snapshot = await identity(installed.path);
						const payloadSnapshot = await fingerprint(installed.payload);
						ui.log(
							`Update ${installed.version ?? "unknown"} → ${prepared.version}\nDownload: ${formatBytes(prepared.download.bytes)}\nNew ${installed.kind === "bundle" ? "bundle" : "package"}: ${formatBytes(prepared.unpacked.bytes)} files; ${formatBytes(prepared.unpacked.allocated)} on disk\nOverwrite: ${installed.kind === "bundle" ? target : installed.path}\nCurrent payload: ${formatBytes(old.bytes)} files; ${formatBytes(old.allocated)} on disk`,
						);
						if (installed.kind === "cli")
							ui.log(
								`Install payload: ${target}\nPoint launcher to: ${join(target, prepared.executable ?? "")}\n${installed.path !== installed.payload ? "The old payload remains available for clean." : "The existing standalone executable will be replaced."}`,
							);
						ui.log("Close the app and its running sessions before proceeding.");
						if (await ui.confirm("Replace this installation?")) {
							ctx.signal?.throwIfAborted();
							const current = await app.inspect(ctx);
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
							await running(
								ctx,
								[installed.path, installed.storage ?? installed.payload],
								installed.kind === "cli" ? basename(installed.path) : undefined,
							);
							const verify = async () => {
								const updated = await app.inspect(ctx);
								if (updated?.version !== prepared.version)
									throw new Error("Installed version verification failed");
							};
							if (installed.kind === "bundle")
								await ops.replace(
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
								await ops.replace(
									operationContext,
									prepared.source,
									target,
									async () => {},
								);
								try {
									await ops.link(
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
							ui.log(`Updated to ${prepared.version}.`);
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
			`Space tracked: ${formatBytes(before.allocated)} before → ${formatBytes(after.allocated)} after (${formatBytes(Math.abs(delta))} ${delta >= 0 ? "reclaimed" : "added"}).`,
		);
		ui.log(
			"Disk figures count allocated blocks; APFS shared blocks and concurrent app activity can affect actual free space.",
		);
	}
	return { before, after };
}

/** Run installed apps sequentially, retaining failures until every app was attempted. */
export async function runAll(
	apps: readonly AppModule[],
	action: "inspect" | "update" | "clean",
	ctx: AppContext,
	ui: UI,
	runner: typeof runApp = runApp,
): Promise<void> {
	if (ctx.appPath) throw new Error("--app-path cannot be used with all");
	const errors: Error[] = [];
	for (const app of apps) {
		ctx.signal?.throwIfAborted();
		try {
			if (!(await app.inspect(ctx))) {
				ui.log(`${app.displayName}: skipped (not installed).`);
				continue;
			}
			await runner(app, action, ctx, ui);
		} catch (error) {
			ctx.signal?.throwIfAborted();
			const failure = new Error(
				`${app.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
			errors.push(failure);
			ui.log(failure.message);
		}
	}
	if (errors.length)
		throw new AggregateError(
			errors,
			`${errors.length} app(s) failed: ${errors.map((error) => error.message).join("; ")}`,
		);
}
