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
import { MD004 } from "./MD004.js";
import { MD005 } from "./MD005.js";
import { MD007 } from "./MD007.js";
import { MD009 } from "./MD009.js";
import { MD010 } from "./MD010.js";
import { MD012 } from "./MD012.js";
import { MD013 } from "./MD013.js";
import { MD014 } from "./MD014.js";
import { MD018 } from "./MD018.js";
import { MD019 } from "./MD019.js";
import { MD020 } from "./MD020.js";
import { MD021 } from "./MD021.js";
import { MD022 } from "./MD022.js";
import { MD023 } from "./MD023.js";
import { MD024 } from "./MD024.js";
import { MD025 } from "./MD025.js";
import { MD026 } from "./MD026.js";
import { MD027 } from "./MD027.js";
import { MD028 } from "./MD028.js";
import { MD029 } from "./MD029.js";
import { MD030 } from "./MD030.js";
import { MD031 } from "./MD031.js";
import { MD032 } from "./MD032.js";
import { MD033 } from "./MD033.js";
import { MD035 } from "./MD035.js";
import { MD036 } from "./MD036.js";
import { MD037 } from "./MD037.js";
import { MD038 } from "./MD038.js";
import { MD040 } from "./MD040.js";
import { MD041 } from "./MD041.js";
import { MD043 } from "./MD043.js";
import { MD045 } from "./MD045.js";
import { MD046 } from "./MD046.js";
import { MD047 } from "./MD047.js";
import { MD048 } from "./MD048.js";
import { MD060 } from "./MD060.js";

/**
 * Every ported markdownlint rule, in markdownlint's own order.
 *
 * @public
 */
export const rules: ReadonlyArray<LintRule> = [
	MD001,
	MD003,
	MD004,
	MD005,
	MD007,
	MD009,
	MD010,
	MD012,
	MD013,
	MD014,
	MD018,
	MD019,
	MD020,
	MD021,
	MD022,
	MD023,
	MD024,
	MD025,
	MD026,
	MD027,
	MD028,
	MD029,
	MD030,
	MD031,
	MD032,
	MD033,
	MD035,
	MD036,
	MD037,
	MD038,
	MD040,
	MD041,
	MD043,
	MD045,
	MD046,
	MD047,
	MD048,
	MD060,
];

/**
 * The first names of markdownlint's built-in rules that have no port yet,
 * in markdownlint's order.
 *
 * @public
 */
export const uncovered: ReadonlyArray<string> = [
	"MD011",
	"MD034",
	"MD039",
	"MD042",
	"MD044",
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
];
