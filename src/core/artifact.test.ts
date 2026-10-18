import { createHash } from "node:crypto";
import { testContext } from "../tests.ts";
import { prepare, validateEntries } from "./artifact.ts";
import { exists } from "./system.ts";
import type { Release } from "./types.ts";

const release: Release = {
	url: "https://example.com/claude",
	format: "binary",
	entry: "claude",
	version: "2.0.0",
	teamId: "TEST",
};
describe("artifact preparation lifecycle", () => {
	it("checks the digest and signature before running a CLI, measures it and disposes it", async () => {
		const commands: string[][] = [];
		const body = "fake signed executable";
		const sha256 = createHash("sha256").update(body).digest("hex");
		const prepared = await prepare(
			testContext(commands, "Claude Code 2.0.0"),
			{ ...release, sha256 },
			async () => new Response(body),
		);
		expect(commands[0]?.[0]).toBe("/usr/bin/codesign");
		expect(commands[0]?.join(" ")).toContain(
			'certificate leaf[subject.OU] = "TEST"',
		);
		expect(commands[1]?.[1]).toBe("--version");
		expect(prepared.download.bytes).toBe(body.length);
		expect(prepared.unpacked.bytes).toBe(body.length);
		await prepared.dispose();
		expect(await exists(prepared.source)).toBe(false);
	});
	it("rejects digest mismatches before executing anything", async () => {
		const commands: string[][] = [];
		await expect(
			prepare(
				testContext(commands, "Claude Code 2.0.0"),
				{ ...release, sha256: "0".repeat(64) },
				async () => new Response("bad"),
			),
		).rejects.toThrow("SHA-256 mismatch");
		expect(commands.length).toBe(0);
	});
	it("rejects signature failures before executing a downloaded program", async () => {
		const commands: string[][] = [];
		const context = testContext(commands, "Claude Code 2.0.0");
		context.command = async (args) => {
			commands.push(args);
			throw new Error("invalid signature");
		};
		await expect(
			prepare(context, release, async () => new Response("bad")),
		).rejects.toThrow("invalid signature");
		expect(commands.length).toBe(1);
		const source = commands[0]?.at(-1);
		if (!source) throw new Error("Missing source");
		expect(await exists(source)).toBe(false);
	});
	it("detaches a mounted DMG when its expected app is missing", async () => {
		const commands: string[][] = [];
		const context = testContext(commands, "Claude Code 2.0.0");
		await expect(
			prepare(
				context,
				{ ...release, format: "dmg", entry: "Missing.app" },
				async () => new Response("dmg"),
			),
		).rejects.toThrow("missing Missing.app");
		expect(commands.some((args) => args[1] === "detach")).toBe(true);
	});
	it("cleans up a prepared download after version mismatch", async () => {
		const commands: string[][] = [];
		await expect(
			prepare(
				testContext(commands, "Claude Code 2.0.0"),
				{ ...release, version: "3.0.0" },
				async () => new Response("binary"),
			),
		).rejects.toThrow("version mismatch");
		const source = commands[0]?.at(-1);
		if (!source) throw new Error("Missing source");
		expect(await exists(source)).toBe(false);
	});
});

describe("validateEntries", () => {
	it("rejects archive path traversal", () => {
		expect(() => validateEntries("ok\n../../outside")).toThrow();
		expect(() => validateEntries("/absolute")).toThrow();
		expect(() =>
			validateEntries("package/bin/codex\n./package/lib"),
		).not.toThrow();
	});
});
