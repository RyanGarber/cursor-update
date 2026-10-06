import { unlinkSync } from "node:fs";

export interface DownloadProgress {
	downloadedBytes: number;
	totalBytes: number;
	percentage: number;
}

/**
 * Downloads a DMG file from the provided URL, streaming to destination with progress.
 */
export async function downloadDmg(
	url: string,
	destPath: string,
	onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to download DMG from ${url}: HTTP ${response.status} ${response.statusText}`,
		);
	}

	const contentLengthHeader = response.headers.get("content-length");
	const totalBytes = contentLengthHeader
		? Number.parseInt(contentLengthHeader, 10)
		: 0;

	if (!response.body) {
		throw new Error("Response body is empty or unavailable");
	}

	const file = Bun.file(destPath);
	const writer = file.writer();

	let downloadedBytes = 0;
	let lastRenderTime = 0;

	const reader = response.body.getReader();

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			writer.write(value);
			downloadedBytes += value.length;

			const now = Date.now();
			if (
				onProgress &&
				(now - lastRenderTime > 100 || downloadedBytes === totalBytes)
			) {
				lastRenderTime = now;
				const percentage =
					totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
				onProgress({ downloadedBytes, totalBytes, percentage });
			}
		}

		await writer.end();
	} catch (err) {
		try {
			writer.end();
		} catch {}
		try {
			unlinkSync(destPath);
		} catch {}
		throw err;
	}
}
