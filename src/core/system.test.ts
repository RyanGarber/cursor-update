import { link, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { testPaths } from "../tests.ts";
import { contains, response, roots, safePath, usage } from "./system.ts";

describe("usage", () => {
	it("measures nested paths once, deduplicates hard links and never follows symlinks", () =>
		testPaths(["cache"], async (_, [cache]) => {
			await writeFile(join(cache!, "data"), "1234567890");
			await link(join(cache!, "data"), join(cache!, "copy"));
			await symlink(cache!, join(cache!, "loop"));
			const result = await usage([cache!, join(cache!, "data")]);
			expect(result.bytes).toBe(10 + Buffer.byteLength(cache!));
			expect(result.allocated).toBeGreaterThan(0);
		}));

	it("counts missing paths as empty", async () => {
		expect(await usage(["/nonexistent/sod-off"])).toEqual({
			bytes: 0,
			allocated: 0,
		});
	});
});

describe("paths", () => {
	it("matches only whole path components", () => {
		expect(contains("/a/b", "/a/b")).toBe(true);
		expect(contains("/a/b", "/a/b/c")).toBe(true);
		expect(contains("/a/b", "/a/bc")).toBe(false);
	});

	it("keeps only the outermost of nested paths", () => {
		expect(roots(["/a/b/c", "/a/b", "/a/bc", "/a/b/"])).toEqual([
			"/a/b",
			"/a/bc",
		]);
	});

	it("refuses cleanup through a symlinked parent", () =>
		testPaths(["cache"], async (home, [cache]) => {
			await symlink(cache!, join(home, "alias"));
			await expect(safePath(join(home, "alias/data"))).rejects.toThrow(
				"Symlinked parent",
			);
			await expect(safePath(join(cache!, "data"))).resolves.toBeUndefined();
		}));

	it("refuses the root and home directories", async () => {
		await expect(safePath("/")).rejects.toThrow("Unsafe");
		await expect(safePath(homedir())).rejects.toThrow("Unsafe");
	});
});

describe("response", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("refuses plain HTTP and insecure redirects", async () => {
		await expect(response("http://example.com")).rejects.toThrow("HTTPS");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Object.defineProperty(new Response("x"), "url", {
				value: "http://example.com/redirected",
			}),
		);
		await expect(response("https://example.com")).rejects.toThrow(
			"Insecure download redirect",
		);
	});

	it("rejects failed requests", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("gone", { status: 404 }),
		);
		await expect(response("https://example.com")).rejects.toThrow("HTTP 404");
	});
});
