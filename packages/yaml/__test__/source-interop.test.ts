// Two installed copies of `@effected/source` must interoperate: the public
// signatures that take a line index are typed with the structural
// `SourceIndex` interface, never the `LineIndex` class, whose `private`
// members make it nominal.

import { assert, describe, it } from "@effect/vitest";
import { YamlDiagnostic } from "../src/index.js";
import { SecondCopyLineIndex } from "./second-copy-index.js";

describe("YamlDiagnostic.fromRaw with a second copy's index", () => {
	it("accepts it and positions the record against it", () => {
		const copy = SecondCopyLineIndex.make("a: 1\nb: [\n");
		const d = YamlDiagnostic.fromRaw({ code: "MissingKey", message: "m", offset: 5, length: 1 }, copy);
		assert.deepStrictEqual([d.line, d.character], [1, 0]);
	});
});
