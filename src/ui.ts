export const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	magenta: "\x1b[35m",
	blue: "\x1b[34m",
	gray: "\x1b[90m",
};

export function info(message: string): void {
	console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

export function success(message: string): void {
	console.log(`${colors.green}✔${colors.reset} ${message}`);
}

export function warn(message: string): void {
	console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

export function error(message: string): void {
	console.error(`${colors.red}✖${colors.reset} ${message}`);
}

export function step(
	stepNumber: number,
	totalSteps: number,
	title: string,
): void {
	console.log(
		`\n${colors.bold}${colors.blue}[${stepNumber}/${totalSteps}]${colors.reset} ${colors.bold}${title}${colors.reset}`,
	);
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const size = bytes / 1024 ** i;
	return `${size.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatProgressBar(
	current: number,
	total: number,
	width = 30,
): string {
	if (total <= 0) return "";
	const ratio = Math.min(1, Math.max(0, current / total));
	const filled = Math.round(ratio * width);
	const empty = width - filled;
	const bar = `${colors.green}${"━".repeat(filled)}${colors.dim}${"━".repeat(empty)}${colors.reset}`;
	const percentage = (ratio * 100).toFixed(1);
	return `[${bar}] ${percentage}% (${formatBytes(current)} / ${formatBytes(total)})`;
}
