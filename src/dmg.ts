import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface MountResult {
	mountPoint: string;
	appPath: string;
}

/**
 * Extracts all mount points from hdiutil XML plist output.
 */
export function parseMountPointsFromPlist(plistXml: string): string[] {
	const mountPoints: string[] = [];
	const regex = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g;
	let match = regex.exec(plistXml);
	while (match !== null) {
		if (match[1]) {
			mountPoints.push(match[1]);
		}
		match = regex.exec(plistXml);
	}
	return mountPoints;
}

/**
 * Mounts a macOS disk image (.dmg) in read-only and no-browse mode.
 */
export async function mountDmg(dmgPath: string): Promise<MountResult> {
	if (!existsSync(dmgPath)) {
		throw new Error(`DMG file does not exist at: ${dmgPath}`);
	}

	const proc = Bun.spawn(
		["hdiutil", "attach", dmgPath, "-nobrowse", "-readonly", "-plist"],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exitCode !== 0) {
		throw new Error(`Failed to mount DMG (${dmgPath}): ${stderr || stdout}`);
	}

	const mountPoints = parseMountPointsFromPlist(stdout);
	if (mountPoints.length === 0) {
		throw new Error(
			`hdiutil attached DMG but no mount point was found in output`,
		);
	}

	// Find the mount point containing Cursor.app or an .app bundle
	for (const mp of mountPoints) {
		const directCursorApp = join(mp, "Cursor.app");
		if (existsSync(directCursorApp)) {
			return { mountPoint: mp, appPath: directCursorApp };
		}

		try {
			const entries = readdirSync(mp);
			const app = entries.find((e) => e.endsWith(".app"));
			if (app) {
				return { mountPoint: mp, appPath: join(mp, app) };
			}
		} catch {}
	}

	// Fallback to the first mount point
	const firstMount = mountPoints[0];
	if (!firstMount) {
		throw new Error("No mount point found");
	}
	return {
		mountPoint: firstMount,
		appPath: join(firstMount, "Cursor.app"),
	};
}

/**
 * Unmounts a mounted volume using hdiutil detach with fallback.
 */
export async function unmountDmg(mountPoint: string): Promise<void> {
	if (!existsSync(mountPoint)) {
		return;
	}

	// Try hdiutil detach -force
	const proc = Bun.spawn(["hdiutil", "detach", mountPoint, "-force"], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	if (exitCode === 0) {
		return;
	}

	// Fallback to diskutil unmount force
	const diskutilProc = Bun.spawn(["diskutil", "unmount", "force", mountPoint], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const diskutilExitCode = await diskutilProc.exited;
	if (diskutilExitCode !== 0) {
		const err = await new Response(diskutilProc.stderr).text();
		throw new Error(`Failed to unmount DMG at ${mountPoint}: ${err}`);
	}
}
