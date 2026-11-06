// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/api-extractor.messages.test.ts on 2026-11-06

import { assert, describe, it } from "@effect/vitest";
import { ExtractorLogLevel } from "@microsoft/api-extractor";
import { mapExtractorMessage } from "../../src/meta/api-extractor.js";

describe("mapExtractorMessage", () => {
	it("maps a warning message and preserves the source location", () => {
		const entry = mapExtractorMessage({
			logLevel: ExtractorLogLevel.Warning,
			messageId: "ae-forgotten-export",
			text: "ae-forgotten-export",
			sourceFilePath: "src/index.ts",
			sourceFileLine: 12,
			sourceFileColumn: 3,
		} as never);
		assert.deepStrictEqual(entry, {
			source: "api-extractor",
			level: "warn",
			code: "ae-forgotten-export",
			text: "ae-forgotten-export",
			file: "src/index.ts",
			line: 12,
			column: 3,
		});
	});

	it("preserves location for release-tag and unresolved-link codes alike", () => {
		for (const messageId of ["ae-missing-release-tag", "ae-incompatible-release-tags", "ae-unresolved-link"]) {
			const entry = mapExtractorMessage({
				logLevel: ExtractorLogLevel.Warning,
				messageId,
				text: `${messageId}: "SomeSymbol" ...`,
				sourceFilePath: "src/Real.ts",
				sourceFileLine: 11,
				sourceFileColumn: 46,
			} as never);
			assert.strictEqual(entry?.file, "src/Real.ts");
			assert.strictEqual(entry?.line, 11);
			assert.strictEqual(entry?.column, 46);
		}
	});

	it("omits location fields that are undefined", () => {
		const entry = mapExtractorMessage({ logLevel: ExtractorLogLevel.Error, text: "boom" } as never);
		assert.strictEqual(entry?.level, "error");
		assert.isUndefined(entry?.file);
	});

	it("returns undefined for info/none messages", () => {
		assert.isUndefined(mapExtractorMessage({ logLevel: ExtractorLogLevel.Info, text: "fyi" } as never));
	});
});
