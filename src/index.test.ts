import { formatDocPage, getDocPage, parseSync } from "@optique/core";
import { apps } from "./apps/index.ts";
import { parser } from "./cli.ts";
import { selfUpdate } from "./index.ts";
import { terminalUI } from "./ui.ts";
import type { Manifest } from "./update.ts";

const cli = parser(apps, "darwin");
function parseArgs(args: string[]) {
	const result = parseSync(cli, args);
	if (!result.success) throw new Error(JSON.stringify(result.error));
	if ("man" in result.value) throw new Error("Parsed the man command");
	return result.value;
}

describe("command line", () => {
	it("defaults to inspection and parses app subcommands", () => {
		expect(parseArgs(["cursor"]).action).toBe("inspect");
		expect(parseArgs(["claude-code", "update"]).app).toBe("claude-code");
		expect(parseArgs(["idea", "clean"]).action).toBe("clean");
		expect(parseArgs(["codex", "--app-path", "/tmp"]).appPath).toBe("/tmp");
	});

	it("rejects old flags, unknown commands, missing values and extra arguments", () => {
		for (const args of [
			[],
			["--dry-run"],
			["cursor", "--force"],
			["cursor", "oops"],
			["cursor", "clean", "extra"],
			["cursor", "update", "clean"],
			["cursor", "--app-path"],
			["cursor", "--app-path", "/does/not/exist"],
		])
			expect(() => parseArgs(args)).toThrow();
	});

	it("accepts --clean only with update", () => {
		expect(parseArgs(["cursor", "update", "--clean"]).clean).toBe(true);
		expect(parseArgs(["all", "update", "--clean", "-y"]).clean).toBe(true);
		expect(parseArgs(["cursor", "update"]).clean).toBe(false);
		expect(() => parseArgs(["cursor", "--clean"])).toThrow();
		expect(() => parseArgs(["cursor", "clean", "--clean"])).toThrow();
	});

	it("accepts all and the yes flag anywhere, and rejects a shared app path", () => {
		for (const flag of ["--yes", "-y"]) {
			expect(parseArgs([flag, "all", "update"]).yes).toBe(true);
			expect(parseArgs(["all", "clean", flag]).action).toBe("clean");
		}
		expect(parseArgs(["all"]).action).toBe("inspect");
		expect(parseArgs(["all"]).yes).toBe(false);
		expect(() => parseArgs(["all", "--app-path", "/tmp"])).toThrow();
	});

	it("parses an app for another operating system, but leaves it out of help", () => {
		const linux = parser(apps, "linux");
		expect(parseSync(linux, ["cursor"]).success).toBe(true);
		const page = getDocPage(linux);
		expect(page && formatDocPage("sod-off", page)).not.toContain("cursor");
	});

	it("lists every app and the commands it supports", () => {
		const page = getDocPage(cli);
		const text = page ? formatDocPage("sod-off", page) : "";
		for (const app of apps) expect(text).toContain(app.name);
		expect(text).toContain("(update, clean)");
	});
});

describe("confirmation", () => {
	it("accepts everything with --yes, unless interrupted", async () => {
		expect(await terminalUI(undefined, true).confirm("Proceed?")).toBe(true);
		const abort = new AbortController();
		abort.abort();
		await expect(
			terminalUI(abort.signal, true).confirm("Proceed?"),
		).rejects.toThrow();
	});
});

describe("selfUpdate", () => {
	it("does nothing when running from source", async () => {
		let asked = false;
		const find = async (): Promise<Manifest> => {
			asked = true;
			return { version: "99.0.0", assets: {} };
		};
		expect(await selfUpdate(null, find)).toBe(false);
		expect(asked).toBe(false);
	});
});
