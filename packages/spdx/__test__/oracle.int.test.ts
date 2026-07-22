import { assert, describe, it } from "@effect/vitest";
import spdxParse from "spdx-expression-parse";
import { ACTIVE_LICENSE_IDS } from "../src/internal/licenseIds.js";
import { isValidExpression } from "../src/SpdxExpression.js";

const oracleAccepts = (s: string): boolean => {
	try {
		spdxParse(s);
		return true;
	} catch {
		return false;
	}
};

const CORPUS = [
	"MIT",
	"Apache-2.0+",
	"(MIT OR Apache-2.0)",
	"MIT AND BSD-3-Clause",
	"GPL-2.0-or-later WITH Bison-exception-2.2",
	"LicenseRef-Foo",
	"(MIT AND (Apache-2.0 OR BSD-3-Clause))",
	"NOPE-1.0",
	"MIT AND",
	"(MIT",
	"MIT OR OR Apache-2.0",
	"",
	"GPL-3.0",
	"Apache-2.0 WITH Bogus-exception",
	"DocumentRef-spdx-tool-1.2:LicenseRef-MIT-Style-2",
	"MIT and BSD-3-Clause",
	"MIT or Apache-2.0",
	"GPL-2.0-or-later with Bison-exception-2.2",
];

describe("differential oracle: @effected/spdx vs spdx-expression-parse", () => {
	it("agrees on every active license id", () => {
		for (const id of ACTIVE_LICENSE_IDS) {
			assert.strictEqual(isValidExpression(id), oracleAccepts(id), `id ${id}`);
		}
	});
	it("agrees across the expression corpus", () => {
		for (const s of CORPUS) {
			assert.strictEqual(isValidExpression(s), oracleAccepts(s), `expr ${JSON.stringify(s)}`);
		}
	});
});
