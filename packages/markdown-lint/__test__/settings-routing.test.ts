// Every rule reads its settings through `src/internal/settings.ts`, where a value whose conversion throws reads as
// absent: a rule module that reached into its config itself could throw where markdownlint's coercion is total, or
// read a setting another way than the readers there do. The rule modules' own source is checked.

import { readFileSync, readdirSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";

const rulesDir = new URL("../src/rules/", import.meta.url);

// Whether a module's code (comments set aside, which quote markdownlint's own `params.config.x`) reads a property of
// a value named `config`: `context.config.x`, a destructured `config.x`, `config[...]`, `config?.x`. Passing the
// config whole to a reader (`flagSetting(context.config, ...)`) is the routed form. A comment is dropped from `//` to
// the line's end, which can also drop code after a `//` inside a string on that line: no rule holds one beside a read.
const readsConfig = (source: string): boolean =>
	/\bconfig\s*(?:\.|\[|\?\.)/.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));
const ruleFiles = readdirSync(rulesDir).filter((file) => /^MD\d{3}\.ts$/.test(file));

describe("rule settings", () => {
	it("reads every setting through the settings readers", () => {
		assert.isAtLeast(ruleFiles.length, 53);
		const direct = ruleFiles.filter((file) => readsConfig(readFileSync(new URL(file, rulesDir), "utf8")));
		assert.deepStrictEqual(direct, []);
	});

	it("catches a direct read however the config is reached", () => {
		assert.isTrue(readsConfig("const style = context.config.style;"));
		assert.isTrue(readsConfig('const style = context.config["style"];'));
		assert.isTrue(readsConfig("const { config } = context;\nconst style = config.style;"));
		assert.isTrue(readsConfig("const style = config?.style;"));
		assert.isFalse(readsConfig('const style = stringSetting(context.config, "style", "x");'));
		assert.isFalse(readsConfig("// markdownlint's `params.config.style`\nconst x = 1;"));
	});
});
