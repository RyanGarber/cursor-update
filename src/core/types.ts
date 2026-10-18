/** App modules describe intent. Only the core executes filesystem mutations. */
export interface Installation {
	path: string;
	version: string | null;
	kind: "bundle" | "cli";
	/** Resolved payload; the launcher itself may be a symlink. */
	payload: string;
	/** Full package root when the executable has companion resources. */
	storage?: string;
	bundleId?: string;
}
/** Operating systems sod-off runs on; each app declares which it supports. */
export type Platform = "darwin" | "linux" | "win32";
export interface CleanupTarget {
	path: string;
	label: string;
	kind: "cache" | "version";
}
export interface Release {
	url: string;
	version?: string;
	format: "dmg" | "zip" | "tar.gz" | "binary";
	/** Bundle names or relative executable path inside an archive. */
	entry: string;
	sha256?: string;
	teamId: string;
	bundleIds?: readonly string[];
	/** Install the complete archive, including CLI companion binaries. */
	wholeArchive?: boolean;
}
export interface AppContext {
	signal?: AbortSignal;
	platform: Platform;
	home: string;
	arch: "arm64" | "x64";
	appPath?: string;
	command(args: string[]): Promise<string>;
	text(url: string): Promise<string>;
	json<T>(url: string): Promise<T>;
}
/** Internal mutation context. App discovery modules receive only AppContext. */
export interface OperationContext extends AppContext {
	track?(path: string): void;
}
export interface AppModule {
	/** Registers the first CLI subcommand. */
	name: string;
	displayName: string;
	/** Operating systems this module supports; it is hidden on any other. */
	platforms: readonly Platform[];
	inspect(ctx: AppContext): Promise<Installation | null>;
	update?(ctx: AppContext, installed: Installation | null): Promise<Release>;
	clean?(
		ctx: AppContext,
		installed: Installation | null,
	): Promise<CleanupTarget[]>;
}
export interface UI {
	log(message: string): void;
	confirm(message: string): Promise<boolean>;
}
export interface Usage {
	bytes: number;
	allocated: number;
}
export interface CommandStats {
	before: Usage;
	after: Usage;
}
