import { assert } from "@effect/vitest";
import { Result } from "effect";
import type { SectionParseError } from "../src/index.js";
import { CommentStyle, SectionDialect, SectionDocument, SectionId } from "../src/index.js";

/** A section identity in the default `#` style. */
export const id = (key: string) => SectionId.make({ key, commentStyle: CommentStyle.hash });

/** A section in the default `#` style. */
export const section = (key: string, content: string) => id(key).section(content);

export const begin = (key: string) => `# --- BEGIN ${key} MANAGED SECTION ---`;
export const end = (key: string) => `# --- END ${key} MANAGED SECTION ---`;

/** A rendered block as it appears in a document. */
export const block = (key: string, content: string) => [begin(key), content, end(key)].join("\n");

/** Join lines with LF; the trailing newline is explicit at each call site. */
export const lines = (...parts: ReadonlyArray<string>) => parts.join("\n");

/** Rewrite an LF fixture as CRLF. */
export const crlf = (text: string) => text.replace(/\n/g, "\r\n");

export const parse = (text: string, dialect: SectionDialect = SectionDialect.default): SectionDocument => {
	const result = SectionDocument.parseResult(text, dialect);
	if (!Result.isSuccess(result)) {
		assert.fail(`expected a parseable document, got ${result.failure.reason} at line ${result.failure.line}`);
	}
	return result.success;
};

export const parseFailure = (text: string, dialect: SectionDialect = SectionDialect.default): SectionParseError => {
	const result = SectionDocument.parseResult(text, dialect);
	if (!Result.isFailure(result)) {
		assert.fail("expected the document to be rejected");
	}
	return result.failure;
};
