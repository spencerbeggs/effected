// The built-in rule catalog (#129): the ordered rule array the facade
// exposes as `YamlLint.builtins`, and the per-rule options schemas the
// config layer validates against. Aggregates VALUES (an array and a map) —
// not a re-export barrel; rules are imported from their own modules.
//
// Rules accrete here batch by batch; `indentation` lands last (see the
// design doc).

import type { Schema } from "effect";
import type { YamlRule } from "../../YamlLintRule.js";
import { colonSpacing, colonSpacingOptions } from "./colon-spacing.js";
import { commentsSpacing, commentsSpacingOptions } from "./comments-spacing.js";
import { documentEnd, documentEndOptions } from "./document-end.js";
import { documentStart, documentStartOptions } from "./document-start.js";
import { emptyLines, emptyLinesOptions } from "./empty-lines.js";
import { eofNewline, eofNewlineOptions } from "./eof-newline.js";
import { hyphenSpacing, hyphenSpacingOptions } from "./hyphen-spacing.js";
import { indentation, indentationOptions } from "./indentation.js";
import { keyDuplicates, keyDuplicatesOptions } from "./key-duplicates.js";
import { lineLength, lineLengthOptions } from "./line-length.js";
import { parseValidity, parseValidityOptions } from "./parse-validity.js";
import { quotedStrings, quotedStringsOptions } from "./quoted-strings.js";
import { trailingSpaces, trailingSpacesOptions } from "./trailing-spaces.js";
import { truthy, truthyOptions } from "./truthy.js";

/** The built-in rules, in catalog order (parse-validity is rule #1). */
export const builtinRules: ReadonlyArray<YamlRule> = [
	parseValidity,
	lineLength,
	trailingSpaces,
	emptyLines,
	eofNewline,
	documentStart,
	documentEnd,
	keyDuplicates,
	quotedStrings,
	truthy,
	commentsSpacing,
	colonSpacing,
	hyphenSpacing,
	indentation,
];

/** Per-rule options schemas — the rule-aware half of config validation. */
export const builtinOptionsSchemas: ReadonlyMap<string, Schema.Top> = new Map<string, Schema.Top>([
	["parse-validity", parseValidityOptions],
	["line-length", lineLengthOptions],
	["trailing-spaces", trailingSpacesOptions],
	["empty-lines", emptyLinesOptions],
	["eof-newline", eofNewlineOptions],
	["document-start", documentStartOptions],
	["document-end", documentEndOptions],
	["key-duplicates", keyDuplicatesOptions],
	["quoted-strings", quotedStringsOptions],
	["truthy", truthyOptions],
	["comments-spacing", commentsSpacingOptions],
	["colon-spacing", colonSpacingOptions],
	["hyphen-spacing", hyphenSpacingOptions],
	["indentation", indentationOptions],
]);
