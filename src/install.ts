import { existsSync, renameSync, rmSync } from "node:fs";
import { warn } from "./ui.ts";

/**
 * Checks if Cursor is currently running.
 */
export async function isCursorRunning(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["pgrep", "-x", "Cursor"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		return exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Attempts to gracefully quit Cursor via AppleScript.
 */
export async function quitCursorIfRunning(): Promise<boolean> {
	if (!(await isCursorRunning())) {
		return true;
	}

	warn("Cursor is currently running. Requesting graceful shutdown...");
	try {
		const quitProc = Bun.spawn(["osascript", "-e", 'quit app "Cursor"'], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await quitProc.exited;

		// Give it a brief moment to cleanly close
		for (let i = 0; i < 10; i++) {
			await Bun.sleep(500);
			if (!(await isCursorRunning())) {
				return true;
			}
		}
	} catch {}

	return !(await isCursorRunning());
}

/**
 * Safely replaces the installed Cursor.app with the new version using staging and atomic swap.
 */
export async function replaceApp(
	sourceAppPath: string,
	targetAppPath = "/Applications/Cursor.app",
): Promise<void> {
	if (!existsSync(sourceAppPath)) {
		throw new Error(`Source app does not exist at: ${sourceAppPath}`);
	}

	const isRunning = await isCursorRunning();
	if (isRunning) {
		const quitSuccess = await quitCursorIfRunning();
		if (!quitSuccess) {
			warn(
				"Cursor is still running. Replacing files while running may cause active sessions to restart.",
			);
		}
	}

	const timestamp = Date.now();
	const stagingPath = `${targetAppPath}.staging-${timestamp}`;
	const backupPath = `${targetAppPath}.backup-${timestamp}`;

	try {
		// 1. Copy source to staging path using macOS ditto (preserves all permissions and signatures)
		const dittoProc = Bun.spawn(["ditto", sourceAppPath, stagingPath], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const [dittoStderr, dittoExit] = await Promise.all([
			new Response(dittoProc.stderr).text(),
			dittoProc.exited,
		]);

		if (dittoExit !== 0) {
			throw new Error(
				`ditto failed to copy application bundle: ${dittoStderr}`,
			);
		}

		// 2. If target app currently exists, rename it to backup
		const targetExists = existsSync(targetAppPath);
		if (targetExists) {
			renameSync(targetAppPath, backupPath);
		}

		// 3. Move staged app to target location
		try {
			renameSync(stagingPath, targetAppPath);
		} catch (swapErr) {
			// Rollback backup if target rename failed
			if (targetExists && existsSync(backupPath)) {
				try {
					renameSync(backupPath, targetAppPath);
				} catch {}
			}
			throw swapErr;
		}

		// 4. Remove backup now that swap succeeded
		if (existsSync(backupPath)) {
			rmSync(backupPath, { recursive: true, force: true });
		}
	} finally {
		// Clean up staging directory if left over
		if (existsSync(stagingPath)) {
			rmSync(stagingPath, { recursive: true, force: true });
		}
	}
}
