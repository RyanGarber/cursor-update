export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.min(
		units.length - 1,
		Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))),
	);
	const size = bytes / 1024 ** i;
	return `${size.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
