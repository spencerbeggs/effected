import { assert, describe, it } from "@effect/vitest";
import { KeywordFamilies } from "../src/index.js";

describe("KeywordFamilies", () => {
	it("declares the vscode-json-languageservice set by exact name", () => {
		for (const key of [
			"allowTrailingCommas",
			"defaultSnippets",
			"enumDescriptions",
			"markdownDescription",
			"markdownEnumDescriptions",
		]) {
			assert.isTrue(KeywordFamilies.isDeclared(key), key);
		}
		// Exact names: a near-miss is not declared.
		assert.isFalse(KeywordFamilies.isDeclared("markdownDescriptions"));
		assert.isFalse(KeywordFamilies.isDeclared("AllowTrailingCommas"));
	});

	it("declares the taplo, tombi and IntelliJ prefixes", () => {
		for (const key of [
			"x-taplo",
			"x-taplo-info",
			"x-tombi-toml-version",
			"x-tombi-array-values-order",
			"x-tombi-array-values-order-by",
			"x-tombi-table-keys-order",
			"x-tombi-string-formats",
			"x-tombi-additional-key-label",
			"x-intellij-language-injection",
			"x-intellij-html-description",
			"x-intellij-enum-metadata",
		]) {
			assert.isTrue(KeywordFamilies.isDeclared(key), key);
		}
	});

	it("does not declare Draft-07 keywords, bare prefixed lookalikes or arbitrary keys", () => {
		for (const key of ["type", "properties", "$ref", "x-tombi", "x-intellij", "x-custom", "unevaluatedProperties"]) {
			assert.isFalse(KeywordFamilies.isDeclared(key), key);
		}
	});
});
