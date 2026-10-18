import { copyFile, lstat, mkdir, rename, rm, symlink } from "node:fs/promises";
import { dirname } from "node:path";
import { exists, safePath } from "./system.ts";
import type { OperationContext } from "./types.ts";

/** Same-filesystem staging + rollback. An unrecoverable backup is deliberately retained. */
export async function replace(
	context: OperationContext,
	source: string,
	target: string,
	verify: () => Promise<void>,
): Promise<void> {
	await safePath(target);
	await mkdir(dirname(target), { recursive: true });
	const stage = `${target}.sod-off-stage-${crypto.randomUUID()}`;
	const backup = `${target}.sod-off-backup-${crypto.randomUUID()}`;
	context.track?.(backup);
	let backedUp = false;
	context.track?.(stage);
	let promoted = false;
	try {
		if ((await lstat(source)).isDirectory())
			await context.command(["/usr/bin/ditto", source, stage]);
		else await copyFile(source, stage);
		if (await exists(target)) {
			await rename(target, backup);
			backedUp = true;
		}
		try {
			await rename(stage, target);
			promoted = true;
			await verify();
		} catch (error) {
			if (promoted) await rm(target, { recursive: true, force: true });
			if (backedUp) {
				await rename(backup, target);
				backedUp = false;
			}
			throw error;
		}
		if (backedUp) {
			await rm(backup, { recursive: true });
			backedUp = false;
		}
	} catch (error) {
		if (backedUp)
			throw new Error(
				`Replacement failed; recovery copy retained at ${backup}`,
				{ cause: error },
			);
		throw error;
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}
/** Atomically switches a launcher; retains its old contents until verification passes. */
export async function link(
	context: OperationContext,
	payload: string,
	target: string,
	verify: () => Promise<void>,
): Promise<void> {
	await safePath(target);
	await mkdir(dirname(target), { recursive: true });
	const source = `${target}.sod-off-link-${crypto.randomUUID()}`;
	context.track?.(source);
	await symlink(payload, source);
	// copyFile follows symlinks, so use a separate rename transaction for launchers.
	const backup = `${target}.sod-off-backup-${crypto.randomUUID()}`;
	context.track?.(backup);
	let backedUp = false;
	try {
		if (await exists(target)) {
			await rename(target, backup);
			backedUp = true;
		}
		try {
			await rename(source, target);
			await verify();
		} catch (error) {
			await rm(target, { force: true });
			if (backedUp) {
				await rename(backup, target);
				backedUp = false;
			}
			throw error;
		}
		if (backedUp) {
			await rm(backup, { recursive: true });
			backedUp = false;
		}
	} catch (error) {
		if (backedUp)
			throw new Error(
				`Launcher replacement failed; recovery copy retained at ${backup}`,
				{ cause: error },
			);
		throw error;
	} finally {
		await rm(source, { force: true });
	}
}
