import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testContext, testPaths } from "../tests.ts";
import { cursorAgent } from "./cursor-agent.ts";

describe("cursor-agent", () => {
	it("removes old agent CLI versions but keeps active, linked and running ones", async () => {
		const cli = ".local/share/cursor-agent/versions";
		await testPaths(
			[
				[cli, "2026.10.1-1111111"],
				[cli, "2026.10.9-2222222"],
				[cli, "2026.10.12-3333333/.running"],
				[cli, "2026.10.14-4444444/.running"],
				[cli, "2026.10.16-5555555"],
				[cli, ".tmp-2026.10.16-5555555-1760000000"],
				[cli, "not-a-version"],
				".local/bin",
			],
			async (home) => {
				await writeFile(
					join(home, cli, "2026.10.1-1111111", "cursor-agent"),
					"",
				);

				// The legacy launcher still points at an older version.
				await symlink(
					join(home, cli, "2026.10.1-1111111/cursor-agent"),
					join(home, ".local/bin/cursor-agent"),
				);

				await writeFile(
					join(home, cli, "2026.10.12-3333333/.running", String(process.pid)),
					"",
				);
				await writeFile(
					join(home, cli, "2026.10.14-4444444/.running/2147483646"),
					"",
				);
				const items = await cursorAgent.clean?.(
					{ ...testContext(), home },
					{
						path: join(home, ".local/bin/agent"),
						payload: join(home, cli, "2026.10.16-5555555/cursor-agent"),
						kind: "cli",
						version: "2026.10.16-5555555",
					},
				);
				expect(items?.map((item) => item.path)).toEqual([
					join(home, cli, "2026.10.9-2222222"),
					join(home, cli, "2026.10.14-4444444"),
					join(home, cli, ".tmp-2026.10.16-5555555-1760000000"),
				]);
			},
		);
	});

	it("resolves the Cursor agent release pinned by its installer", async () => {
		const release = await cursorAgent.update?.(
			{
				...testContext(),
				text: async () =>
					'DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.10.16-e3cb207/$OS/$ARCH/agent-cli-package.tar.gz"',
			},
			null,
		);
		expect(release).toMatchObject({
			version: "2026.10.16-e3cb207",
			url: "https://downloads.cursor.com/lab/2026.10.16-e3cb207/darwin/arm64/agent-cli-package.tar.gz",
			wholeArchive: true,
			verify: "cursor-agent-worker-sea",
		});
		await expect(
			cursorAgent.update?.(
				{ ...testContext(), text: async () => "<html/>" },
				null,
			),
		).rejects.toThrow("No Cursor Agent release");
	});
});
