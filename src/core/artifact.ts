import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
	children,
	contains,
	exists,
	plist,
	response,
	usage,
} from "./system.ts";
import type { OperationContext, Release, Usage } from "./types.ts";

export interface Prepared {
	source: string;
	executable?: string;
	version: string;
	download: Usage;
	unpacked: Usage;
	dispose(): Promise<void>;
}
export function validateEntries(list: string): void {
	for (const path of list.split("\n").filter(Boolean)) {
		if (isAbsolute(path) || path.split("/").includes(".."))
			throw new Error(`Unsafe archive entry: ${path}`);
	}
}
async function hash(path: string): Promise<string> {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(path)) h.update(chunk);
	return h.digest("hex");
}
export async function prepare(
	context: OperationContext,
	release: Release,
	downloadResponse: typeof response = response,
): Promise<Prepared> {
	const temp = await realpath(await mkdtemp(join(tmpdir(), "sod-off-")));
	context.track?.(temp);
	const archive = join(temp, `download.${release.format}`);
	let mounted = false;
	const mount = join(temp, "volume");
	const dispose = async () => {
		// Keep the work directory if detach fails; never recursively delete a mounted volume.
		if (mounted) {
			await context.command(["/usr/bin/hdiutil", "detach", mount]);
			mounted = false;
		}
		await rm(temp, { recursive: true, force: true });
	};
	try {
		context.signal?.throwIfAborted();
		const res = await downloadResponse(release.url, context.signal);
		if (!res.body) throw new Error("Empty download response");
		await pipeline(
			Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
			createWriteStream(archive),
		);
		const download = await usage([archive]);
		if (release.sha256) {
			if (
				!/^[a-f0-9]{64}$/i.test(release.sha256) ||
				(await hash(archive)) !== release.sha256.toLowerCase()
			)
				throw new Error("Download SHA-256 mismatch");
		}
		let root = join(temp, "extracted");
		await mkdir(root);
		if (release.format === "dmg") {
			await mkdir(mount);
			await context.command([
				"/usr/bin/hdiutil",
				"attach",
				archive,
				"-mountpoint",
				mount,
				"-nobrowse",
				"-readonly",
				"-noautoopen",
			]);
			mounted = true;
			root = mount;
		} else if (release.format === "zip" || release.format === "tar.gz") {
			const entries = await context.command(
				release.format === "zip"
					? ["/usr/bin/unzip", "-Z1", archive]
					: ["/usr/bin/tar", "-tzf", archive],
			);
			validateEntries(entries);
			await context.command(
				release.format === "zip"
					? ["/usr/bin/ditto", "-x", "-k", archive, root]
					: ["/usr/bin/tar", "-xzf", archive, "-C", root],
			);
		}
		let source =
			release.format === "binary" ? archive : join(root, release.entry);
		if (!(await exists(source)) && release.format !== "binary") {
			// Some vendors wrap their payload in a single top-level directory.
			const candidates: string[] = [];
			for (const child of await children(root))
				if (await exists(join(child, release.entry)))
					candidates.push(join(child, release.entry));
			if (candidates.length === 1 && candidates[0]) {
				source = candidates[0];
				root = resolve(source, ...release.entry.split("/").map(() => ".."));
			}
		}
		if (!(await exists(source)))
			throw new Error(`Release is missing ${release.entry}`);
		if (!contains(temp, await realpath(source)))
			throw new Error("Release entry escapes staging directory");
		if (release.format === "binary") await chmod(source, 0o755);
		const signed = release.verify ? join(root, release.verify) : source;
		if (!(await exists(signed)) || !contains(temp, await realpath(signed)))
			throw new Error(`Release is missing ${release.verify}`);
		const isBundle = release.entry.endsWith(".app");
		// Authenticate vendor identity before running a downloaded CLI or reading a bundle for installation.
		await context.command([
			"/usr/bin/codesign",
			"--verify",
			"--deep",
			"--strict",
			"-R",
			`=anchor apple generic and certificate leaf[subject.OU] = "${release.teamId}"`,
			signed,
		]);
		let version: string;
		if (isBundle) {
			const id = await plist(context, source, "CFBundleIdentifier");
			if (!release.bundleIds?.includes(id))
				throw new Error(`Unexpected bundle identifier: ${id}`);
			version = await plist(context, source, "CFBundleShortVersionString");
			const minimum = await plist(context, source, "LSMinimumSystemVersion");
			const system = await context.command([
				"/usr/bin/sw_vers",
				"-productVersion",
			]);
			if (compareVersions(system, minimum) < 0)
				throw new Error(
					`This release requires macOS ${minimum}; installed: ${system}`,
				);
		} else {
			const output = await context.command([source, "--version"]);
			version = output.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? "";
		}
		if (!version || (release.version && version !== release.version))
			throw new Error(
				`Release version mismatch: expected ${release.version}, got ${version}`,
			);
		context.signal?.throwIfAborted();
		const executable = release.wholeArchive ? release.entry : undefined;
		if (release.wholeArchive) source = root;
		return {
			source,
			executable,
			version,
			download,
			unpacked: await usage([source]),
			dispose,
		};
	} catch (error) {
		try {
			await dispose();
		} catch (cleanup) {
			throw new AggregateError(
				[error, cleanup],
				`Preparation failed; cleanup also failed at ${temp}`,
			);
		}
		throw error;
	}
}
export function compareVersions(a: string, b: string): number {
	const aa = a.split(/[.-]/);
	const bb = b.split(/[.-]/);
	for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
		const x = aa[i] ?? "0";
		const y = bb[i] ?? "0";
		const n =
			/^\d+$/.test(x) && /^\d+$/.test(y)
				? Number(x) - Number(y)
				: x.localeCompare(y);
		if (n) return n;
	}
	return 0;
}
