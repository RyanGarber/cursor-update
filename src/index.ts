#!/usr/bin/env bun

import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanPreviousCaches } from "./cache.ts";
import {
	checkForUpdate,
	DEFAULT_APP_PATH,
	DEFAULT_UPDATE_URL,
	getInstalledInfo,
} from "./check.ts";
import { mountDmg, unmountDmg } from "./dmg.ts";
import { downloadDmg } from "./download.ts";
import { replaceApp } from "./install.ts";
import type { CliOptions } from "./types.ts";
import {
	colors,
	error,
	formatBytes,
	formatProgressBar,
	info,
	step,
	success,
	warn,
} from "./ui.ts";

const CLI_VERSION = "1.0.0";

function printHelp(): void {
	console.log(`
${colors.bold}Cursor Update CLI${colors.reset} (v${CLI_VERSION})
A Bun CLI to check, update, and clean Cursor installations on macOS.

${colors.bold}USAGE:${colors.reset}
  cursor-update [options]
  bun run src/index.ts [options]

${colors.bold}OPTIONS:${colors.reset}
  -c, --check            Check for updates without downloading or installing
  -f, --force            Force download and re-installation even if up to date
  -d, --dry-run          Simulate the update process without making changes
  --app-path <path>      Custom path to Cursor.app (default: /Applications/Cursor.app)
  --no-cache-clean       Skip deleting previous version caches
  -v, --version          Show version number
  -h, --help             Show this help message

${colors.bold}WORKFLOW:${colors.reset}
  1. Inspects remote update endpoint with manual redirect (no premature DMG download)
  2. Compares redirect commit hash with /Applications/Cursor.app/.../product.json
  3. If version differs:
     • Streams DMG download with progress indicator
     • Mounts the DMG via macOS hdiutil
     • Safely replaces /Applications/Cursor.app using ditto
     • Deletes previous version caches from CachedData and compile-cache
     • Unmounts volume and cleans up downloaded DMG
`);
}

export function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		checkOnly: false,
		force: false,
		dryRun: false,
		help: false,
		version: false,
		appPath: DEFAULT_APP_PATH,
		skipCacheCleanup: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === "-h" || arg === "--help") {
			options.help = true;
		} else if (arg === "-v" || arg === "--version") {
			options.version = true;
		} else if (arg === "-c" || arg === "--check") {
			options.checkOnly = true;
		} else if (arg === "-f" || arg === "--force") {
			options.force = true;
		} else if (arg === "-d" || arg === "--dry-run") {
			options.dryRun = true;
		} else if (arg === "--no-cache-clean") {
			options.skipCacheCleanup = true;
		} else if (arg === "--app-path" && i + 1 < args.length) {
			const next = args[++i];
			if (next) options.appPath = next;
		}
	}

	return options;
}

export async function run(args = process.argv.slice(2)): Promise<void> {
	const options = parseArgs(args);

	if (options.help) {
		printHelp();
		return;
	}

	if (options.version) {
		console.log(`cursor-update v${CLI_VERSION}`);
		return;
	}

	console.log(
		`${colors.bold}${colors.cyan}Cursor Auto-Updater (macOS)${colors.reset}`,
	);
	console.log(`${colors.dim}Target app: ${options.appPath}${colors.reset}\n`);

	// Step 1: Check version
	step(1, 5, "Checking for Cursor updates...");
	info("Fetching latest release info (using manual redirect)...");

	let checkResult: Awaited<ReturnType<typeof checkForUpdate>>;
	try {
		checkResult = await checkForUpdate(options.appPath, DEFAULT_UPDATE_URL);
	} catch (err) {
		error(
			`Failed to check for updates: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}

	const { installed, remote, isUpdateAvailable } = checkResult;

	console.log(
		`  Installed commit:  ${colors.yellow}${installed.commit ?? "Not installed"}${colors.reset}${installed.version ? ` (${installed.version})` : ""}`,
	);
	console.log(
		`  Latest commit:     ${colors.green}${remote.commit}${colors.reset}`,
	);
	console.log(
		`  DMG URL:           ${colors.dim}${remote.downloadUrl}${colors.reset}\n`,
	);

	if (!isUpdateAvailable && !options.force) {
		success("Cursor is already up to date! Nothing to do.");
		return;
	}

	if (options.force && !isUpdateAvailable) {
		warn(
			"Cursor is already up to date, but --force was specified. Proceeding...",
		);
	} else {
		info("A new version of Cursor is available!");
	}

	if (options.checkOnly) {
		info("Check-only mode enabled. Exiting without updating.");
		return;
	}

	if (options.dryRun) {
		console.log(
			`\n${colors.bold}${colors.magenta}[DRY RUN MODE]${colors.reset}`,
		);
		info(`Would download DMG from: ${remote.downloadUrl}`);
		info("Would mount DMG via hdiutil");
		info(`Would replace application at: ${options.appPath}`);
		if (!options.skipCacheCleanup) {
			info(
				"Would clean previous version caches in CachedData and compile-cache",
			);
		}
		info("Would unmount DMG and remove temporary download file");
		success("Dry run completed successfully.");
		return;
	}

	// Prepare temporary DMG path
	const tempDmgPath = join(
		tmpdir(),
		`Cursor-${remote.commit.slice(0, 10)}-${Date.now()}.dmg`,
	);
	let mountPoint: string | null = null;

	try {
		// Step 2: Download DMG
		step(2, 5, "Downloading latest Cursor DMG...");
		info(`Saving to: ${tempDmgPath}`);

		await downloadDmg(remote.downloadUrl, tempDmgPath, (progress) => {
			const bar = formatProgressBar(
				progress.downloadedBytes,
				progress.totalBytes,
			);
			const line = `\r  ${bar}`;
			process.stdout.write(line);
		});

		process.stdout.write("\n");
		success(
			`DMG download complete (${formatBytes(Bun.file(tempDmgPath).size)})`,
		);

		// Step 3: Mount DMG
		step(3, 5, "Mounting disk image...");
		const mountResult = await mountDmg(tempDmgPath);
		mountPoint = mountResult.mountPoint;
		success(`Mounted DMG at: ${mountPoint}`);
		info(`Found application bundle: ${mountResult.appPath}`);

		// Step 4: Replace installed application
		step(4, 5, `Installing new version to ${options.appPath}...`);
		await replaceApp(mountResult.appPath, options.appPath);
		success("Successfully updated Cursor.app!");

		// Step 5: Clean previous version caches
		step(5, 5, "Cleaning previous version caches...");
		if (!options.skipCacheCleanup) {
			const cacheResult = cleanPreviousCaches(remote.commit);
			if (cacheResult.deletedDirs.length > 0) {
				success(
					`Deleted ${cacheResult.deletedDirs.length} previous version cache directories (freed ${formatBytes(cacheResult.freedBytes)})`,
				);
				for (const dir of cacheResult.deletedDirs) {
					console.log(`  ${colors.dim}-${colors.reset} ${dir}`);
				}
			} else {
				info("No previous version caches found to clean.");
			}
		} else {
			info("Cache cleanup skipped (--no-cache-clean).");
		}
	} finally {
		// Cleanup: Always unmount DMG and delete downloaded file
		if (mountPoint) {
			info(`Unmounting ${mountPoint}...`);
			try {
				await unmountDmg(mountPoint);
				success("Unmounted disk image.");
			} catch (unmountErr) {
				warn(
					`Failed to unmount disk image cleanly: ${unmountErr instanceof Error ? unmountErr.message : String(unmountErr)}`,
				);
			}
		}

		if (existsSync(tempDmgPath)) {
			try {
				rmSync(tempDmgPath, { force: true });
				info("Deleted downloaded DMG file.");
			} catch (rmErr) {
				warn(
					`Failed to remove temporary DMG: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
				);
			}
		}
	}

	// Verify post-installation
	const updatedInfo = getInstalledInfo(options.appPath);
	console.log(
		`\n${colors.bold}${colors.green}🎉 Update completed successfully!${colors.reset}`,
	);
	console.log(`  Installed commit: ${updatedInfo.commit ?? "unknown"}`);
	if (updatedInfo.version) {
		console.log(`  Installed version: ${updatedInfo.version}`);
	}
}

// Execute CLI when run directly
if (import.meta.main) {
	run().catch((err) => {
		error(
			`Unexpected error: ${err instanceof Error ? err.stack || err.message : String(err)}`,
		);
		process.exit(1);
	});
}
