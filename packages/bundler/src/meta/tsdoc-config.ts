import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { StandardTags } from "@microsoft/tsdoc";
import type { TsdocOptions } from "./config.js";

const TSDOC_SCHEMA = "https://developer.microsoft.com/json-schemas/tsdoc/v0/tsdoc.schema.json";

const SYNTAX_KIND_MAP = { block: "block", inline: "inline", modifier: "modifier" } as const;

/** Build the tsdoc.json object: standard tags enabled, every standard tag marked supported, plus any custom tags. */
export function buildTsdocConfig(tsdoc: {
	suppressWarnings: ReadonlyArray<unknown>;
	tagDefinitions: ReadonlyArray<{
		tagName: string;
		syntaxKind: "block" | "inline" | "modifier";
		allowMultiple?: boolean | undefined;
	}>;
}): Record<string, unknown> {
	// api-extractor requires explicit support flags for standard tags when they are enabled.
	const supportForTags: Record<string, boolean> = {};
	for (const def of StandardTags.allDefinitions) {
		supportForTags[def.tagName] = true;
	}

	const tagDefinitions = tsdoc.tagDefinitions.map((t) => ({
		tagName: t.tagName,
		syntaxKind: SYNTAX_KIND_MAP[t.syntaxKind],
		...(t.allowMultiple !== undefined ? { allowMultiple: t.allowMultiple } : {}),
	}));
	for (const t of tagDefinitions) {
		supportForTags[t.tagName] = true;
	}

	const config: Record<string, unknown> = {
		$schema: TSDOC_SCHEMA,
		noStandardTags: false,
		reportUnsupportedHtmlElements: true,
		supportForTags,
	};
	if (tagDefinitions.length > 0) config.tagDefinitions = tagDefinitions;
	return config;
}

/** Write tsdoc.json to `cwd`. Deterministic and idempotent: skips the write when the existing file is byte-equal to the computed config. Returns the path. */
export function writeTsdocConfig(cwd: string, tsdoc: TsdocOptions): string {
	const path = join(cwd, "tsdoc.json");
	const config = buildTsdocConfig({
		suppressWarnings: tsdoc.suppressWarnings ?? [],
		tagDefinitions: tsdoc.tagDefinitions ?? [],
	});
	if (existsSync(path)) {
		try {
			const existing = JSON.parse(readFileSync(path, "utf-8")) as unknown;
			if (isDeepStrictEqual(existing, config)) return path;
		} catch {
			// fall through to rewrite
		}
	}
	writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`, "utf-8");
	return path;
}
