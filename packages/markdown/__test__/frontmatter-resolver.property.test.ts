// Property coverage for the frontmatter $schema declaration grammar: any string
// classifies to exactly one shape, and the X[.Y[.Z]] integers-only version
// grammar round-trips. The unit coverage is in `frontmatter-resolver.test.ts`.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Result, Schema } from "effect";
import {
	SchemaDeclarationByName,
	SchemaDeclarationByPath,
	SchemaDeclarationByUrl,
	SchemaResolver,
} from "../src/FrontmatterResolver.js";

describe("SchemaResolver.classify — properties", () => {
	it.prop(
		"classification totality: any string classifies without throwing, to exactly one shape",
		[Schema.String],
		([s]) => {
			const result = SchemaResolver.classify(s);
			if (Result.isSuccess(result)) {
				const declaration = result.success;
				if (s.includes("://")) {
					assert.instanceOf(declaration, SchemaDeclarationByUrl);
				} else if (s.startsWith("./") || s.startsWith("../") || s.startsWith("/")) {
					assert.instanceOf(declaration, SchemaDeclarationByPath);
				} else {
					assert.instanceOf(declaration, SchemaDeclarationByName);
				}
			}
		},
		{ arbitrary: { runs: Depth.pick({ sample: 30, full: 300 }) } },
	);

	const Segments = Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9999 }))).check(
		Schema.isBetweenLength(1, 3),
	);

	it.prop(
		"grammar round-trip: generated integer segments always classify, junk suffixes never do",
		[Segments],
		([parts]) => {
			const version = parts.join(".");
			const result = SchemaResolver.classify(`skill@${version}`);
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) {
				const declaration = result.success;
				assert.instanceOf(declaration, SchemaDeclarationByName);
				if (declaration instanceof SchemaDeclarationByName) {
					assert.strictEqual(declaration.version, version);
				}
			}
			const junk = SchemaResolver.classify(`skill@${version}-beta`);
			assert.isTrue(Result.isFailure(junk));
		},
		{ arbitrary: { runs: Depth.pick({ sample: 20, full: 200 }) } },
	);
});
