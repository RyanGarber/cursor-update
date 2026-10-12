import type { AppModule } from "../core/types.ts";
import { chatgpt } from "./chatgpt.ts";
import { claude } from "./claude.ts";
import { claudeCode } from "./claude-code.ts";
import { codex } from "./codex.ts";
import { cursor } from "./cursor.ts";
import { idea } from "./idea.ts";
export const apps: readonly AppModule[] = [
	cursor,
	idea,
	claude,
	claudeCode,
	chatgpt,
	codex,
];
export function registry(
	modules: readonly AppModule[],
): Map<string, AppModule> {
	const result = new Map<string, AppModule>();
	for (const app of modules) {
		if (!/^[a-z][a-z0-9-]*$/.test(app.name) || result.has(app.name))
			throw new Error(`Invalid or duplicate app name: ${app.name}`);
		result.set(app.name, app);
	}
	return result;
}
