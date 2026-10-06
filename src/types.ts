export interface InstalledInfo {
	exists: boolean;
	appPath: string;
	commit: string | null;
	realCommit: string | null;
	version: string | null;
}

export interface RemoteReleaseInfo {
	downloadUrl: string;
	commit: string;
}

export interface UpdateCheckResult {
	installed: InstalledInfo;
	remote: RemoteReleaseInfo;
	isUpdateAvailable: boolean;
}

export interface CliOptions {
	checkOnly: boolean;
	force: boolean;
	dryRun: boolean;
	help: boolean;
	version: boolean;
	appPath: string;
	skipCacheCleanup: boolean;
}

export interface CacheCleanupResult {
	deletedDirs: string[];
	freedBytes: number;
}
