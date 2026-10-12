import { describe, expect, it } from "bun:test";
import { apps, registry } from "../src/apps/index.ts";
import { help, parseArgs } from "../src/index.ts";

describe("CLI routing", () => {
	it("defaults to inspection and parses app subcommands", () => {
		expect(parseArgs(["cursor"]).action).toBe("inspect");
		expect(parseArgs(["claude-code", "update"]).name).toBe("claude-code");
		expect(parseArgs(["idea", "clean"]).action).toBe("clean");
		expect(parseArgs(["codex", "--app-path", "/tmp/codex"]).appPath).toBe(
			"/tmp/codex",
		);
	});
	it("rejects old flags, unknown commands, missing values and extra arguments", () => {
		for (const args of [
			["--dry-run"],
			["--force"],
			["cursor", "oops"],
			["cursor", "clean", "extra"],
			["--app-path"],
			["--app-path", "--help"],
		])
			expect(() => parseArgs(args)).toThrow();
	});
	it("registers all six apps with both initial commands", () => {
		expect([...registry(apps).keys()]).toEqual([
			"cursor",
			"idea",
			"claude",
			"claude-code",
			"chatgpt",
			"codex",
		]);
		for (const app of apps) {
			expect(app.update).toBeFunction();
			expect(app.clean).toBeFunction();
			expect(help()).toContain(app.name);
		}
	});
	it("rejects duplicate registrations", () => {
		const app = apps[0];
		if (!app) throw new Error("Missing fixture app");
		expect(() => registry([app, app])).toThrow("duplicate");
	});
});

it("treats EOF as a declined confirmation and accepts only explicit yes", async () => {
	const { PassThrough } = await import("node:stream");
	const { createInterface } = await import("node:readline/promises");
	const { confirmPrompt } = await import("../src/index.ts");
	for (const [answer, expected] of [
		["yes\n", true],
		["\n", false],
		["no\n", false],
		["", false],
	] as const) {
		const input = new PassThrough();
		const output = new PassThrough();
		const readline = createInterface({ input, output, terminal: false });
		const confirmation = confirmPrompt(readline, "Proceed?");
		input.end(answer);
		expect(await confirmation).toBe(expected);
	}
});

it("accepts all and global yes flags and rejects a shared app path", async () => {
	for (const flag of ["--yes", "-y"]) {
		expect(parseArgs([flag, "all", "update"]).yes).toBe(true);
		expect(parseArgs(["all", "clean", flag]).action).toBe("clean");
	}
	expect(parseArgs(["all"]).action).toBe("inspect");
	expect(parseArgs(["all"]).yes).toBe(false);
	expect(() => parseArgs(["all", "--app-path", "/tmp/app"])).toThrow();
	const { terminalUI } = await import("../src/index.ts");
	expect(await terminalUI(undefined, true).confirm("Proceed?")).toBe(true);
	const abort = new AbortController();
	abort.abort();
	await expect(
		terminalUI(abort.signal, true).confirm("Proceed?"),
	).rejects.toThrow();
});

it("runs only installed apps for every action and continues after failures", async () => {
	const { runAll } = await import("../src/core/runner.ts");
	const { context } = await import("../src/core/system.ts");
	const installed = {
		path: "/tmp/app",
		payload: "/tmp/app",
		kind: "cli" as const,
		version: "1",
	};
	const modules = [
		{ name: "missing", displayName: "Missing", inspect: async () => null },
		{ name: "broken", displayName: "Broken", inspect: async () => installed },
		{ name: "present", displayName: "Present", inspect: async () => installed },
	];
	for (const action of ["inspect", "update", "clean"] as const) {
		const called: string[] = [];
		await expect(
			runAll(
				modules,
				action,
				context(),
				{ log() {}, confirm: async () => false },
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
