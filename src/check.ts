import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	InstalledInfo,
	RemoteReleaseInfo,
	UpdateCheckResult,
} from "./types.ts";

export const DEFAULT_UPDATE_URL =
	"https://api2.cursor.sh/updates/download/golden/darwin-arm64/cursor/latest";
export const DEFAULT_APP_PATH = "/Applications/Cursor.app";

/**
 * Extracts a 40-character git commit hash from a Cursor download URL.
 */
export function extractCommitFromUrl(url: string): string | null {
	// e.g. https://downloads.cursor.com/production/3a92974361033b2051526321308c2740fe5912c5/darwin/arm64/Cursor-darwin-arm64.dmg
	const productionMatch = url.match(/\/production\/([a-f0-9]{40})/i);
	if (productionMatch?.[1]) {
		return productionMatch[1].toLowerCase();
	}

	const generalMatch = url.match(/([a-f0-9]{40})/i);
	if (generalMatch?.[1]) {
		return generalMatch[1].toLowerCase();
	}

	return null;
}

/**
 * Fetches the Cursor update endpoint with manual redirect handling to retrieve
 * the DMG download URL and the latest commit hash without downloading the DMG.
 */
export async function getLatestReleaseInfo(
	updateUrl = DEFAULT_UPDATE_URL,
): Promise<RemoteReleaseInfo> {
	const response = await fetch(updateUrl, {
		method: "GET",
		redirect: "manual",
	});

	// Manual redirect response will have status 301, 302, 307, or 308
	const redirectLocation = response.headers.get("location");
	if (!redirectLocation) {
		throw new Error(
			`Update endpoint did not return a redirect location (HTTP status ${response.status})`,
		);
	}

	const commit = extractCommitFromUrl(redirectLocation);
	if (!commit) {
		throw new Error(
			`Failed to extract commit hash from redirect location: ${redirectLocation}`,
		);
	}

	return {
		downloadUrl: redirectLocation,
		commit,
	};
}

/**
 * Reads local Cursor application info from product.json
 */
export function getInstalledInfo(appPath = DEFAULT_APP_PATH): InstalledInfo {
	if (!existsSync(appPath)) {
		return {
			exists: false,
			appPath,
			commit: null,
			realCommit: null,
			version: null,
		};
	}

	const productJsonPath = join(
		appPath,
		"Contents",
		"Resources",
		"app",
		"product.json",
	);
	if (!existsSync(productJsonPath)) {
		return {
			exists: true,
			appPath,
			commit: null,
			realCommit: null,
			version: null,
		};
	}

	try {
		const content = readFileSync(productJsonPath, "utf8");
		const data = JSON.parse(content) as {
			commit?: string;
			realCommit?: string;
			version?: string;
		};

		return {
			exists: true,
			appPath,
			commit: data.commit?.toLowerCase() ?? null,
			realCommit: data.realCommit?.toLowerCase() ?? null,
			version: data.version ?? null,
		};
	} catch (err) {
		throw new Error(
			`Failed to parse ${productJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Compares installed vs remote Cursor release.
 */
export async function checkForUpdate(
	appPath = DEFAULT_APP_PATH,
	updateUrl = DEFAULT_UPDATE_URL,
): Promise<UpdateCheckResult> {
	const [installed, remote] = await Promise.all([
		Promise.resolve(getInstalledInfo(appPath)),
		getLatestReleaseInfo(updateUrl),
	]);

	// An update is available if Cursor is not installed, or if the commit hash differs
	const isUpdateAvailable =
		!installed.exists ||
		!installed.commit ||
		(installed.commit !== remote.commit &&
			installed.realCommit !== remote.commit);

	return {
		installed,
		remote,
		isUpdateAvailable,
	};
}
