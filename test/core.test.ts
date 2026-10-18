import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	link as hardlink,
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
import { validateEntries } from "../src/core/artifact.ts";
import { link, replace } from "../src/core/operations.ts";
import { managedRoot, runApp, type Services } from "../src/core/runner.ts";
import { command, exists, safePath, usage } from "../src/core/system.ts";
import type { AppContext, AppModule, UI } from "../src/core/types.ts";

let home: string;
let ctx: AppContext;
let app: AppModule;
let logs: string[];
let ui: UI;
let ops: Services;
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
	ctx = {
		platform: "darwin",
		home,
		arch: "arm64",
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
	ui = { log: (message) => logs.push(message), confirm: async () => false };
	disposed = false;
	ops = {
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

describe("core accounting and confirmation", () => {
	it("measures nested paths once, deduplicates hard links and never follows symlinks", async () => {
		await hardlink(join(cache, "data"), join(cache, "copy"));
		await symlink(cache, join(cache, "loop"));
		const result = await usage([cache, join(cache, "data")]);
		expect(result.bytes).toBe(10 + Buffer.byteLength(cache));
		expect(result.allocated).toBeGreaterThan(0);
	});
	it("inspection is read-only and reports before/after stats", async () => {
		const stats = await runApp(app, "inspect", ctx, ui);
		expect(stats.before).toEqual(stats.after);
		expect(logs.join("\n")).toContain(primary);
		expect(logs.join("\n")).toContain("1.0.0");
	});
	it("cancelled cleanup previews every path and changes nothing", async () => {
		const stats = await runApp(app, "clean", ctx, ui);
		expect(await exists(cache)).toBe(true);
		expect(stats.before).toEqual(stats.after);
		expect(logs.join("\n")).toContain("10 B files");
	});
	it("confirmed cleanup removes only the plan and accounts for reclaimed space", async () => {
		ui.confirm = async () => true;
		const stats = await runApp(app, "clean", ctx, ui);
		expect(await exists(cache)).toBe(false);
		expect(await exists(primary)).toBe(true);
		expect(stats.before.bytes - stats.after.bytes).toBe(10);
	});
	it("refuses targets containing the primary installation", async () => {
		app.clean = async () => [{ path: home, label: "unsafe", kind: "cache" }];
		ui.confirm = async () => true;
		await expect(runApp(app, "clean", ctx, ui)).rejects.toThrow(
			"home directory",
		);
		expect(await exists(primary)).toBe(true);
	});
	it("refuses cleanup through a symlinked parent", async () => {
		await symlink(cache, join(home, "alias"));
		await expect(safePath(join(home, "alias/data"))).rejects.toThrow(
			"Symlinked parent",
		);
	});
	it("rejects changes to an installed version during confirmation", async () => {
		app.clean = async () => [
			{ path: cache, label: "Old version", kind: "version" },
		];
		ui.confirm = async () => {
			await writeFile(join(cache, "new"), "changed");
			return true;
		};
		await expect(runApp(app, "clean", ctx, ui)).rejects.toThrow(
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
		await runApp(app, "clean", ctx, ui);
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
		await expect(runApp(app, "clean", ctx, ui)).rejects.toThrow(
			"changed since preview",
		);
		expect(await exists(join(cache, "replacement"))).toBe(true);
	});
	it("reports a running app before checking volatile cache contents", async () => {
		ui.confirm = async () => {
			await writeFile(join(cache, "new"), "changed");
			return true;
		};
		ctx.command = async () => `${primary}/Contents/MacOS/Example`;
		await expect(runApp(app, "clean", ctx, ui)).rejects.toThrow("Quit the app");
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
		await expect(runApp(app, "clean", ctx, ui)).rejects.toThrow(
			"overlaps primary",
		);
		app.inspect = inspect;
		expect(await exists(cache)).toBe(true);
	});
	it("declining update disposes preparation without replacing files", async () => {
		const stats = await runApp(app, "update", ctx, ui, ops);
		expect(disposed).toBe(true);
		expect(stats.before).toEqual(stats.after);
		expect(await readFile(join(primary, "version"), "utf8")).toBe("1.0.0");
		expect(logs.join("\n")).toContain("1.0.0 → 2.0.0");
		expect(logs.join("\n")).toContain(`Overwrite: ${primary}`);
	});
	it("confirmed update verifies the replacement and leaves caches alone", async () => {
		ui.confirm = async () => true;
		await runApp(app, "update", ctx, ui, ops);
		expect(await readFile(join(primary, "version"), "utf8")).toBe("2.0.0");
		expect(await exists(cache)).toBe(true);
		expect(disposed).toBe(true);
	});
	it("skips a current release without downloading", async () => {
		await writeFile(join(primary, "version"), "2.0.0");
		await runApp(app, "update", ctx, ui, ops);
		expect(disposed).toBe(false);
		expect(logs.join("\n")).toContain("Already current");
	});
	it("rejects replacement when the installation changed after preview", async () => {
		ui.confirm = async () => {
			await writeFile(join(primary, "version"), "3.0.0");
			return true;
		};
		await expect(runApp(app, "update", ctx, ui, ops)).rejects.toThrow(
			"changed since preview",
		);
		expect(disposed).toBe(true);
		expect(await readFile(join(primary, "version"), "utf8")).toBe("3.0.0");
	});
	it("refuses mutation while the app is running", async () => {
		ui.confirm = async () => true;
		ctx.command = async (args) =>
			args[0] === "/bin/ps"
				? `${primary}/Contents/MacOS/Example`
				: command(args);
		await expect(runApp(app, "update", ctx, ui, ops)).rejects.toThrow(
			"Quit the app",
		);
		expect(await readFile(join(primary, "version"), "utf8")).toBe("1.0.0");
	});
	it("reports stats and disposes resources even when replacement fails", async () => {
		ui.confirm = async () => true;
		ops.replace = async () => {
			throw new Error("copy failed");
		};
		await expect(runApp(app, "update", ctx, ui, ops)).rejects.toThrow(
			"copy failed",
		);
		expect(disposed).toBe(true);
		expect(logs.join("\n")).toContain("Space tracked:");
	});
	it("optional subcommands fail explicitly", async () => {
		delete app.clean;
		await expect(runApp(app, "clean", ctx, ui)).rejects.toThrow(
			"does not support clean",
		);
	});
	it("discovers managed versions without deleting the active payload", async () => {
		const root = managedRoot(ctx, app);
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
		await runApp(app, "clean", ctx, ui);
		expect(await exists(join(root, "1.0.0"))).toBe(false);
		expect(await exists(join(root, "2.0.0"))).toBe(true);
	});
});
describe("replacement transactions", () => {
	it("restores the old bundle when post-install verification fails", async () => {
		await expect(
			replace(ctx, source, primary, async () => {
				throw new Error("bad version");
			}),
		).rejects.toThrow("bad version");
		expect(await readFile(join(primary, "version"), "utf8")).toBe("1.0.0");
	});
	it("restores a launcher symlink when verification fails", async () => {
		const launcher = join(home, "launcher");
		await symlink(join(primary, "version"), launcher);
		await expect(
			link(ctx, join(source, "version"), launcher, async () => {
				throw new Error("bad version");
			}),
		).rejects.toThrow("bad version");
		expect(await realpath(launcher)).toBe(join(primary, "version"));
	});
	it("rejects archive path traversal", () => {
		expect(() => validateEntries("ok\n../../outside")).toThrow();
		expect(() => validateEntries("/absolute")).toThrow();
		expect(() =>
			validateEntries("package/bin/codex\n./package/lib"),
		).not.toThrow();
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
		ops.prepare = async () => ({
			source: fresh,
			version: "2.0.0",
			download: await usage([fresh]),
			unpacked: await usage([fresh]),
			dispose: async () => {
				disposed = true;
			},
		});
		ui.confirm = async () => true;
		const stats = await runApp(app, "update", ctx, ui, ops);
		expect(await realpath(launcher)).toBe(join(managedRoot(ctx, app), "2.0.0"));
		expect(await readFile(launcher, "utf8")).toBe("2.0.0");
		expect(await readFile(old, "utf8")).toBe("1.0.0");
		expect(stats.after.bytes).toBeGreaterThan(stats.before.bytes);
	});
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
	ops.prepare = async () => ({
		source: fresh,
		version: "2.0.0",
		download: await usage([fresh]),
		unpacked: await usage([fresh]),
		dispose: async () => {},
	});
	ops.link = async (context, payload, target, verify) => {
		await link(context, payload, target, verify);
		throw new Error("backup cleanup failed");
	};
	ui.confirm = async () => true;
	await expect(runApp(app, "update", ctx, ui, ops)).rejects.toThrow(
		"backup cleanup failed",
	);
	expect(await readFile(launcher, "utf8")).toBe("2.0.0");
});
