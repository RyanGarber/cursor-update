import { testContext, testPaths } from "../tests.ts";
import { cursor } from "./cursor.ts";

describe("cursor", () => {
	it("removes old agent versions bundled with Cursor.app, keeping the newest", async () => {
		const worker =
			"Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/share/cursor-agent/versions";

		await testPaths(
			[
				[worker, "2026.10.14-a26f8ae"],
				[worker, "2026.10.18-ac23f9a"],
				[worker, "2026.9.30-0123abc"],
			],
			async (home, paths) => {
				const items = await cursor.clean?.({ ...testContext(), home }, null);
				expect(
					items
						?.filter((item) => item.path.includes("cursor-agent/versions"))
						.map((item) => item.path),
				).toEqual([paths[2], paths[0]]);
			},
		);
	});
});
