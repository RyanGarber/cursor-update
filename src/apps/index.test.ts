import { apps, available, registry } from "./index.ts";

describe("apps", () => {
	it("registers every app with both initial commands", () => {
		expect([...registry(apps).keys()]).toEqual([
			"cursor",
			"cursor-agent",
			"idea",
			"claude",
			"claude-code",
			"chatgpt",
			"codex",
		]);
		for (const app of apps) {
			expect(app.update).toBeTypeOf("function");
			expect(app.clean).toBeTypeOf("function");
		}
	});

	it("shows only the apps an operating system supports", () => {
		expect(available(apps, "darwin")).toEqual([...apps]);
		for (const platform of ["linux", "win32"] as const)
			expect(available(apps, platform)).toEqual([]);
	});

	it("rejects duplicate and invalid registrations", () => {
		const app = apps[0]!;
		expect(() => registry([app, app])).toThrow("duplicate");
		for (const name of ["", "Cursor", "-cursor", "cursor app"])
			expect(() => registry([{ ...app, name }])).toThrow("Invalid");
	});
});
