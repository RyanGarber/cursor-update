#!/usr/bin/env node
import { log } from "@clack/prompts";
import { run } from "./index.ts";

run().catch((error) => {
	log.error(error instanceof Error ? error.message : String(error), {
		output: process.stderr,
	});
	process.exitCode = 1;
});
