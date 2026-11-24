// Every rule reads its settings through `src/internal/settings.ts`, where a value whose conversion throws reads as
// absent: a rule module that reached into its config itself could throw where markdownlint's coercion is total, or
// read a setting another way than the readers there do. The rule modules' own source is checked.

import { readFileSync, readdirSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";

const rulesDir = new URL("../src/rules/", import.meta.url);
const ruleFiles = readdirSync(rulesDir).filter((file) => /^MD\d{3}\.ts$/.test(file));

describe("rule settings", () => {
	it("reads every setting through the settings readers", () => {
		assert.isAtLeast(ruleFiles.length, 53);
		const direct = ruleFiles.filter((file) =>
			/context\.config\s*(?:\.|\[|\?\.)|\bconfig\s*\[/.test(readFileSync(new URL(file, rulesDir), "utf8")),
		);
		assert.deepStrictEqual(direct, []);
	});
});
