import { assert, describe, it } from "@effect/vitest";
import { parseSync } from "rolldown/utils";
import { stampSource } from "../../src/passes/stamp-versions.js";

const parse = (filename: string, code: string): unknown => parseSync(filename, code).program;
const SPELLED = "process.env.__PACKAGE_VERSION__";

describe("stampSource", () => {
	it("replaces the expression with a string literal of the version", () => {
		assert.strictEqual(
			stampSource(`export const v: string = ${SPELLED} ?? "0.0.0";`, "a.ts", "1.2.3", parse),
			'export const v: string = "1.2.3" ?? "0.0.0";',
		);
	});

	it("leaves strings, comments and other spellings alone, as define does", () => {
		const code = [
			`// ${SPELLED}`,
			`const s = "${SPELLED}";`,
			`const t = \`${SPELLED}\`;`,
			`const g = globalThis.${SPELLED};`,
			`const c = process.env["__PACKAGE_VERSION__"];`,
			`const x = ${SPELLED}X;`,
		].join("\n");
		assert.isUndefined(stampSource(code, "a.ts", "1.2.3", parse));
	});

	it("counts offsets in UTF-16 past non-ASCII text, and replaces every occurrence", () => {
		const code = `const a = "héllo — ünïcode 🚀"; const b = ${SPELLED}; const c = ${SPELLED};`;
		assert.strictEqual(
			stampSource(code, "a.js", "9.9.9", parse),
			'const a = "héllo — ünïcode 🚀"; const b = "9.9.9"; const c = "9.9.9";',
		);
	});

	it("answers undefined for code that never spells it", () => {
		assert.isUndefined(stampSource("export const a = 1;", "a.ts", "1.0.0", parse));
	});
});
