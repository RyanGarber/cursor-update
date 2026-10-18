#!/usr/bin/env node
import { run } from "./index.ts";

run().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
