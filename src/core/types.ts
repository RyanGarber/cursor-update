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
export type Architecture = "arm64" | "x64";
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
	/** Signed executable to authenticate, relative to the entry's root; defaults to the entry. */
	verify?: string;
	/** Install the complete archive, including CLI companion binaries. */
	wholeArchive?: boolean;
}
export interface AppContext {
	signal?: AbortSignal;
	platform: Platform;
	architecture: Architecture;
	home: string;
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
	inspect(context: AppContext): Promise<Installation | null>;
	update?(
		context: AppContext,
		installed: Installation | null,
	): Promise<Release>;
	clean?(
		context: AppContext,
		installed: Installation | null,
	): Promise<CleanupTarget[]>;
}
export interface UI {
	log(message: string): void;
	warn(message: string): void;
	success(message: string): void;
	/** A titled block, such as a preview of what a confirmation would change. */
	note(title: string, body: string): void;
	/** Runs one step of work, shown as it runs and as done or failed. */
	task<T>(title: string, run: () => Promise<T>): Promise<T>;
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
