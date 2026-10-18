import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testContext, testUI } from "../tests.ts";
import { link, replace } from "./operations.ts";
import {
	managedRoot,
	type Operation,
	runAll,
	runApp,
	updateAndClean,
} from "./runner.ts";
import { command, exists, usage } from "./system.ts";
import type { AppContext, AppModule, Installation, UI } from "./types.ts";

let home: string;
let context: AppContext;
let app: AppModule;
let logs: string[];
let ui: UI;
let operations: Operation;
let disposed: boolean;
let source: string;
let primary: string;
let cache: string;
beforeEach(async () => {
	home = await realpath(await mkdtemp(join(tmpdir(), "sod-off-test-")));
	primary = join(home, "Example.app");
	source = join(home, "release.app");
	cache = join(home, "cache");
	await mkdir(primary);
	await writeFile(join(primary, "version"), "1.0.0");
	await mkdir(source);
	await writeFile(join(source, "version"), "2.0.0");
	await mkdir(cache);
	await writeFile(join(cache, "data"), "1234567890");
	context = {
		platform: "darwin",
		home,
		architecture: "arm64",
		command: async (args) => (args[0] === "/bin/ps" ? "" : command(args)),
		text: async () => {
			throw new Error("Unexpected network");
		},
		json: async () => {
			throw new Error("Unexpected network");
		},
	};
	app = {
		name: `test-${crypto.randomUUID()}`,
		displayName: "Example",
		platforms: ["darwin"],
		inspect: async () => ({
			path: primary,
			payload: primary,
			kind: "bundle",
			version: await readFile(join(primary, "version"), "utf8"),
		}),
		clean: async () => [{ path: cache, label: "Cache", kind: "cache" }],
		update: async () => ({
			url: "https://example.com/release",
			version: "2.0.0",
			format: "dmg",
			entry: "Example.app",
			teamId: "TEST",
		}),
	};
	logs = [];
	ui = testUI(logs);
	disposed = false;
	operations = {
		replace,
		link,
		prepare: async () => ({
			source,
			version: "2.0.0",
			download: { bytes: 10, allocated: 4096 },
			unpacked: await usage([source]),
			dispose: async () => {
				disposed = true;
			},
		}),
	};
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

const macOS = process.platform === "darwin";

describe("runApp", () => {
	it("inspection is read-only and reports before/after stats", async () => {
		const stats = await runApp(app, "inspect", context, ui);
		expect(stats.before).toEqual(stats.after);
		expect(logs.join("\n")).toContain(primary);
		expect(logs.join("\n")).toContain("1.0.0");
	});
	it("cancelled cleanup previews every path and changes nothing", async () => {
		const stats = await runApp(app, "clean", context, ui);
		expect(await exists(cache)).toBe(true);
		expect(stats.before).toEqual(stats.after);
		expect(logs.join("\n")).toContain("10 B files");
	});
	it("confirmed cleanup removes only the plan and accounts for reclaimed space", async () => {
		ui.confirm = async () => true;
		const stats = await runApp(app, "clean", context, ui);
		expect(await exists(cache)).toBe(false);
		expect(await exists(primary)).toBe(true);
		expect(stats.before.bytes - stats.after.bytes).toBe(10);
	});
	it("refuses targets containing the primary installation", async () => {
		app.clean = async () => [{ path: home, label: "unsafe", kind: "cache" }];
		ui.confirm = async () => true;
		await expect(runApp(app, "clean", context, ui)).rejects.toThrow(
			"home directory",
		);
		expect(await exists(primary)).toBe(true);
	});
	it("rejects changes to an installed version during confirmation", async () => {
		app.clean = async () => [
			{ path: cache, label: "Old version", kind: "version" },
		];
		ui.confirm = async () => {
			await writeFile(join(cache, "new"), "changed");
			return true;
		};
		await expect(runApp(app, "clean", context, ui)).rejects.toThrow(
			"changed since preview",
		);
		expect(await exists(join(cache, "data"))).toBe(true);
	});
	it("allows cache contents to change while confirmation is open", async () => {
		ui.confirm = async () => {
			await writeFile(join(cache, "data"), "updated on shutdown");
			await writeFile(join(cache, "new"), "new cache file");
			return true;
		};
		await runApp(app, "clean", context, ui);
		expect(await exists(cache)).toBe(false);
		expect(logs.join("\n")).toContain("Cache size refreshed:");
	});
	it("rejects a replaced cache directory before deleting any planned target", async () => {
		const { rename } = await import("node:fs/promises");
		ui.confirm = async () => {
			await rename(cache, `${cache}-original`);
			await mkdir(cache);
			await writeFile(join(cache, "replacement"), "preserve");
			return true;
		};
		await expect(runApp(app, "clean", context, ui)).rejects.toThrow(
			"changed since preview",
		);
		expect(await exists(join(cache, "replacement"))).toBe(true);
	});
	it("reports a running app before checking volatile cache contents", async () => {
		ui.confirm = async () => {
			await writeFile(join(cache, "new"), "changed");
			return true;
		};
		context.command = async () => `${primary}/Contents/MacOS/Example`;
		await expect(runApp(app, "clean", context, ui)).rejects.toThrow(
			"Quit the app",
		);
		expect(await exists(cache)).toBe(true);
	});
	it("protects a newly active version selected during confirmation", async () => {
		const inspect = app.inspect;
		ui.confirm = async () => {
			app.inspect = async () => ({
				path: cache,
				payload: cache,
				kind: "cli",
				version: "1",
			});
			return true;
		};
		await expect(runApp(app, "clean", context, ui)).rejects.toThrow(
			"overlaps primary",
		);
		app.inspect = inspect;
		expect(await exists(cache)).toBe(true);
	});
	it("declining update disposes preparation without replacing files", async () => {
		const stats = await runApp(app, "update", context, ui, operations);
		expect(disposed).toBe(true);
		expect(stats.before).toEqual(stats.after);
		expect(await readFile(join(primary, "version"), "utf8")).toBe("1.0.0");
		expect(logs.join("\n")).toContain("1.0.0 → 2.0.0");
		expect(logs.join("\n")).toMatch(new RegExp(`Overwrite +${primary}`));
	});
	// Replaces bundles with ditto, which only macOS ships.
	it.skipIf(!macOS)(
		"confirmed update verifies the replacement and leaves caches alone",
		async () => {
			ui.confirm = async () => true;
			await runApp(app, "update", context, ui, operations);
			expect(await readFile(join(primary, "version"), "utf8")).toBe("2.0.0");
			expect(await exists(cache)).toBe(true);
			expect(disposed).toBe(true);
		},
	);
	it("skips a current release without downloading", async () => {
		await writeFile(join(primary, "version"), "2.0.0");
		await runApp(app, "update", context, ui, operations);
		expect(disposed).toBe(false);
		expect(logs.join("\n")).toContain("Already current");
	});
	it("rejects replacement when the installation changed after preview", async () => {
		ui.confirm = async () => {
			await writeFile(join(primary, "version"), "3.0.0");
			return true;
		};
		await expect(
			runApp(app, "update", context, ui, operations),
		).rejects.toThrow("changed since preview");
		expect(disposed).toBe(true);
		expect(await readFile(join(primary, "version"), "utf8")).toBe("3.0.0");
	});
	it("refuses mutation while the app is running", async () => {
		ui.confirm = async () => true;
		context.command = async (args) =>
			args[0] === "/bin/ps"
				? `${primary}/Contents/MacOS/Example`
				: command(args);
		await expect(
			runApp(app, "update", context, ui, operations),
		).rejects.toThrow("Quit the app");
		expect(await readFile(join(primary, "version"), "utf8")).toBe("1.0.0");
	});
	it("reports stats and disposes resources even when replacement fails", async () => {
		ui.confirm = async () => true;
		operations.replace = async () => {
			throw new Error("copy failed");
		};
		await expect(
			runApp(app, "update", context, ui, operations),
		).rejects.toThrow("copy failed");
		expect(disposed).toBe(true);
		expect(logs.join("\n")).toContain("Space tracked:");
	});
	it("optional subcommands fail explicitly", async () => {
		delete app.clean;
		await expect(runApp(app, "clean", context, ui)).rejects.toThrow(
			"does not support clean",
		);
	});
	it("discovers managed versions without deleting the active payload", async () => {
		const root = managedRoot(context, app);
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "1.0.0"), "old");
		await writeFile(join(root, "2.0.0"), "current");
		app.inspect = async () => ({
			path: join(home, "bin"),
			payload: join(root, "2.0.0"),
			version: "2.0.0",
			kind: "cli",
		});
		ui.confirm = async () => true;
		await runApp(app, "clean", context, ui);
		expect(await exists(join(root, "1.0.0"))).toBe(false);
		expect(await exists(join(root, "2.0.0"))).toBe(true);
	});
});

describe("native CLI updates", () => {
	it("switches the launcher to a managed version and preserves the old payload", async () => {
		const old = join(home, "old-cli");
		const launcher = join(home, "cli");
		const fresh = join(home, "fresh-cli");
		await writeFile(old, "1.0.0");
		await writeFile(fresh, "2.0.0");
		await symlink(old, launcher);
		app.inspect = async () => ({
			path: launcher,
			payload: await realpath(launcher),
			kind: "cli",
			version: await readFile(launcher, "utf8"),
		});
		operations.prepare = async () => ({
			source: fresh,
			version: "2.0.0",
			download: await usage([fresh]),
			unpacked: await usage([fresh]),
			dispose: async () => {
				disposed = true;
			},
		});
		ui.confirm = async () => true;
		const stats = await runApp(app, "update", context, ui, operations);
		expect(await realpath(launcher)).toBe(
			join(managedRoot(context, app), "2.0.0"),
		);
		expect(await readFile(launcher, "utf8")).toBe("2.0.0");
		expect(await readFile(old, "utf8")).toBe("1.0.0");
		expect(stats.after.bytes).toBeGreaterThan(stats.before.bytes);
	});

	it("keeps a promoted native payload if launcher backup cleanup fails", async () => {
		const old = join(home, "old-cli");
		const launcher = join(home, "cli");
		const fresh = join(home, "fresh-cli");
		await writeFile(old, "1.0.0");
		await writeFile(fresh, "2.0.0");
		await symlink(old, launcher);
		app.inspect = async () => ({
			path: launcher,
			payload: await realpath(launcher),
			kind: "cli",
			version: await readFile(launcher, "utf8"),
		});
		operations.prepare = async () => ({
			source: fresh,
			version: "2.0.0",
			download: await usage([fresh]),
			unpacked: await usage([fresh]),
			dispose: async () => {},
		});
		operations.link = async (context, payload, target, verify) => {
			await link(context, payload, target, verify);
			throw new Error("backup cleanup failed");
		};
		ui.confirm = async () => true;
		await expect(
			runApp(app, "update", context, ui, operations),
		).rejects.toThrow("backup cleanup failed");
		expect(await readFile(launcher, "utf8")).toBe("2.0.0");
	});
});

describe("runAll", () => {
	it("runs only installed apps for every action and continues after failures", async () => {
		const installed: Installation = {
			path: "/tmp/app",
			payload: "/tmp/app",
			kind: "cli",
			version: "1",
		};
		const modules: AppModule[] = [
			{
				name: "missing",
				displayName: "Missing",
				platforms: ["darwin"],
				inspect: async () => null,
			},
			{
				name: "broken",
				displayName: "Broken",
				platforms: ["darwin"],
				inspect: async () => installed,
			},
			{
				name: "present",
				displayName: "Present",
				platforms: ["darwin"],
				inspect: async () => installed,
			},
		];
		for (const action of ["inspect", "update", "clean"] as const) {
			const called: string[] = [];
			await expect(
				runAll(
					modules,
					action,
					testContext(),
					testUI(),
					async (app, requested) => {
						called.push(app.name);
						expect(requested).toBe(action);
						if (app.name === "broken") throw new Error("fixture failure");
						return {
							before: { bytes: 0, allocated: 0 },
							after: { bytes: 0, allocated: 0 },
						};
					},
				),
			).rejects.toThrow("1 app(s) failed");
			expect(called).toEqual(["broken", "present"]);
		}
	});
});

describe("updateAndClean", () => {
	it("cleans after updating, and not after a failed update", async () => {
		const usage = (bytes: number) => ({ bytes, allocated: bytes });
		const called: string[] = [];
		const stats = await updateAndClean(app, context, ui, async (_, action) => {
			called.push(action);
			return action === "update"
				? { before: usage(10), after: usage(8) }
				: { before: usage(8), after: usage(3) };
		});
		expect(called).toEqual(["update", "clean"]);
		expect(stats).toEqual({ before: usage(10), after: usage(3) });
		called.length = 0;
		await expect(
			updateAndClean(app, context, ui, async (_, action) => {
				called.push(action);
				throw new Error("update failed");
			}),
		).rejects.toThrow("update failed");
		expect(called).toEqual(["update"]);
	});
});
