import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CacheCleanupResult } from "./types.ts";

/**
 * Calculates directory size recursively in bytes.
 */
export function getDirectorySize(dirPath: string): number {
	if (!existsSync(dirPath)) return 0;
	let totalSize = 0;
	try {
		const stat = statSync(dirPath);
		if (!stat.isDirectory()) return stat.size;

		const entries = readdirSync(dirPath);
		for (const entry of entries) {
			const fullPath = join(dirPath, entry);
			try {
				const entryStat = statSync(fullPath);
				if (entryStat.isDirectory()) {
					totalSize += getDirectorySize(fullPath);
				} else {
					totalSize += entryStat.size;
				}
			} catch {}
		}
	} catch {}
	return totalSize;
}

/**
 * Deletes caches specific to previous Cursor versions:
 * 1. ~/Library/Application Support/Cursor/CachedData/<old-commit-hash>
 * 2. ~/Library/Caches/cursor-compile-cache/<old-version-dir>
 * 3. ~/Library/Caches/com.todesktop.230313mzl4w4u92.ShipIt
 */
export function cleanPreviousCaches(
	newCommit: string,
	userHome = homedir(),
): CacheCleanupResult {
	const deletedDirs: string[] = [];
	let freedBytes = 0;
	const lowerNewCommit = newCommit.toLowerCase();

	// 1. Clean CachedData directories for other commit hashes
	const cachedDataDir = join(
		userHome,
		"Library",
		"Application Support",
		"Cursor",
		"CachedData",
	);

	if (existsSync(cachedDataDir)) {
		try {
			const entries = readdirSync(cachedDataDir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					const name = entry.name.toLowerCase();
					// Commit directories are 40-character hex strings
					const isCommitHash = /^[a-f0-9]{40}$/.test(name);
					if (isCommitHash && name !== lowerNewCommit) {
						const target = join(cachedDataDir, entry.name);
						const size = getDirectorySize(target);
						rmSync(target, { recursive: true, force: true });
						deletedDirs.push(target);
						freedBytes += size;
					}
				}
			}
		} catch {}
	}

	// 2. Clean cursor-compile-cache directories
	const compileCacheDir = join(
		userHome,
		"Library",
		"Caches",
		"cursor-compile-cache",
	);

	if (existsSync(compileCacheDir)) {
		try {
			const entries = readdirSync(compileCacheDir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					const target = join(compileCacheDir, entry.name);
					const size = getDirectorySize(target);
					rmSync(target, { recursive: true, force: true });
					deletedDirs.push(target);
					freedBytes += size;
				}
			}
		} catch {}
	}

	// 3. Clean ShipIt update caches
	const libraryCaches = join(userHome, "Library", "Caches");
	if (existsSync(libraryCaches)) {
		try {
			const entries = readdirSync(libraryCaches, { withFileTypes: true });
			for (const entry of entries) {
				if (
					entry.name.includes("230313mzl4w4u92.ShipIt") ||
					entry.name.toLowerCase().includes("cursor.shipit")
				) {
					const target = join(libraryCaches, entry.name);
					const size = getDirectorySize(target);
					rmSync(target, { recursive: true, force: true });
					deletedDirs.push(target);
					freedBytes += size;
				}
			}
		} catch {}
	}

	return {
		deletedDirs,
		freedBytes,
	};
}
