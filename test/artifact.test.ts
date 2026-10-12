import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { prepare } from "../src/core/artifact.ts";
import { exists } from "../src/core/system.ts";
import type { AppContext, Release } from "../src/core/types.ts";

const ui = { log: () => {}, confirm: async () => false };
const release: Release = {
	url: "https://example.com/claude",
	format: "binary",
	entry: "claude",
	version: "2.0.0",
	teamId: "TEST",
};
function context(commands: string[][]): AppContext {
	return {
		home: "/tmp/unused",
		arch: "arm64",
		text: async () => "",
		json: async <T>() => ({}) as T,
		command: async (args) => {
			commands.push(args);
			return args[1] === "--version" ? "Claude Code 2.0.0" : "";
		},
	};
}
describe("artifact preparation lifecycle", () => {
	it("checks the digest and signature before running a CLI, measures it and disposes it", async () => {
		const commands: string[][] = [];
		const body = "fake signed executable";
		const sha256 = createHash("sha256").update(body).digest("hex");
		const prepared = await prepare(
			context(commands),
			{ ...release, sha256 },
			ui,
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
				context(commands),
				{ ...release, sha256: "0".repeat(64) },
				ui,
				async () => new Response("bad"),
			),
		).rejects.toThrow("SHA-256 mismatch");
		expect(commands.length).toBe(0);
	});
	it("rejects signature failures before executing a downloaded program", async () => {
		const commands: string[][] = [];
		const ctx = context(commands);
		ctx.command = async (args) => {
			commands.push(args);
			throw new Error("invalid signature");
		};
		await expect(
			prepare(ctx, release, ui, async () => new Response("bad")),
		).rejects.toThrow("invalid signature");
		expect(commands.length).toBe(1);
		const source = commands[0]?.at(-1);
		if (!source) throw new Error("Missing source");
		expect(await exists(source)).toBe(false);
	});
	it("detaches a mounted DMG when its expected app is missing", async () => {
		const commands: string[][] = [];
		const ctx = context(commands);
		await expect(
			prepare(
				ctx,
				{ ...release, format: "dmg", entry: "Missing.app" },
				ui,
				async () => new Response("dmg"),
			),
		).rejects.toThrow("missing Missing.app");
		expect(commands.some((args) => args[1] === "detach")).toBe(true);
	});
	it("cleans up a prepared download after version mismatch", async () => {
		const commands: string[][] = [];
		await expect(
			prepare(
				context(commands),
				{ ...release, version: "3.0.0" },
				ui,
				async () => new Response("binary"),
			),
		).rejects.toThrow("version mismatch");
		const source = commands[0]?.at(-1);
		if (!source) throw new Error("Missing source");
		expect(await exists(source)).toBe(false);
	});
});
