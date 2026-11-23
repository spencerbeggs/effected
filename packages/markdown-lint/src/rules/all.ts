/**
 * Every ported markdownlint rule as one array, in markdownlint's own order,
 * and the first names of the built-in rules not yet ported.
 *
 * @remarks
 * The one place the kit collects its rules: importing it reaches every rule
 * module, so a consumer who wants a few imports them from
 * `@effected/markdown-lint/rules` instead.
 *
 * @packageDocumentation
 */

import type { LintRule } from "@effected/markdown-lint";
import { MD001 } from "./MD001.js";
import { MD003 } from "./MD003.js";
import { MD009 } from "./MD009.js";
import { MD010 } from "./MD010.js";
import { MD012 } from "./MD012.js";
import { MD013 } from "./MD013.js";
import { MD018 } from "./MD018.js";
import { MD047 } from "./MD047.js";

/**
 * Every ported markdownlint rule, in markdownlint's own order.
 *
 * @public
 */
export const rules: ReadonlyArray<LintRule> = [MD001, MD003, MD009, MD010, MD012, MD013, MD018, MD047];

/**
 * The first names of markdownlint's built-in rules that have no port yet,
 * in markdownlint's order.
 *
 * @public
 */
export const uncovered: ReadonlyArray<string> = [
	"MD004",
	"MD005",
	"MD007",
	"MD011",
	"MD014",
	"MD019",
	"MD020",
	"MD021",
	"MD022",
	"MD023",
	"MD024",
	"MD025",
	"MD026",
	"MD027",
	"MD028",
	"MD029",
	"MD030",
	"MD031",
	"MD032",
	"MD033",
	"MD034",
	"MD035",
	"MD036",
	"MD037",
	"MD038",
	"MD039",
	"MD040",
	"MD041",
	"MD042",
	"MD043",
	"MD044",
	"MD045",
	"MD046",
	"MD048",
	"MD049",
	"MD050",
	"MD051",
	"MD052",
	"MD053",
	"MD054",
	"MD055",
	"MD056",
	"MD058",
	"MD059",
	"MD060",
];
