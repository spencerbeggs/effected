import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { ChangesetFile } from "../src/ChangesetFile.js";
import { loadParse } from "./support/oracle.js";

const TEXT = '---\n"@effected/a": minor\n"@effected/b": patch\n---\n\n## Features\n\nText.\n';

it.effect("parses front matter releases and the summary", () =>
	Effect.gen(function* () {
		const parsed = yield* ChangesetFile.parse(TEXT);
		assert.deepStrictEqual(
			[...parsed.releases],
			[
				["@effected/a", "minor"],
				["@effected/b", "patch"],
			],
		);
		assert.strictEqual(parsed.summary, "## Features\n\nText.");
	}),
);

it.effect("accepts none, which names a package and moves no version", () =>
	Effect.gen(function* () {
		const parsed = yield* ChangesetFile.parse('---\n"@effected/a": none\n"@effected/b": patch\n---\n');
		assert.deepStrictEqual(
			[...parsed.releases],
			[
				["@effected/a", "none"],
				["@effected/b", "patch"],
			],
		);
	}),
);

it.effect("rejects a release type outside patch|minor|major|none", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(ChangesetFile.parse('---\n"@effected/a": huge\n---\n'));
		assert.strictEqual(error._tag, "ChangesetParseError");
	}),
);

it.effect("rejects a file with no front matter", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(ChangesetFile.parse("just text\n"));
		assert.strictEqual(error._tag, "ChangesetParseError");
		assert.include(error.reason, "front matter");
	}),
);

it.effect("rejects an unterminated front matter block", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(ChangesetFile.parse('---\n"@effected/a": minor\n'));
		assert.include(error.reason, "front matter");
	}),
);

it.effect("an empty release map is a valid empty changeset", () =>
	Effect.gen(function* () {
		const parsed = yield* ChangesetFile.parse("---\n---\n");
		assert.strictEqual(parsed.releases.size, 0);
		assert.strictEqual(parsed.summary, "");
	}),
);

it.effect("tolerates CRLF line endings", () =>
	Effect.gen(function* () {
		const parsed = yield* ChangesetFile.parse('---\r\n"@effected/a": major\r\n---\r\n\r\nText.\r\n');
		assert.deepStrictEqual([...parsed.releases], [["@effected/a", "major"]]);
	}),
);

it("parseSync agrees with parse on the same text", () => {
	const sync = ChangesetFile.parseSync(TEXT);
	assert.isTrue(Result.isSuccess(sync));
	if (Result.isSuccess(sync)) {
		assert.strictEqual(sync.success.summary, "## Features\n\nText.");
		assert.strictEqual(sync.success.releases.get("@effected/a"), "minor");
	}
	const bad = ChangesetFile.parseSync("nope");
	assert.isTrue(Result.isFailure(bad));
});

describe("the summary against @changesets/parse", async () => {
	const parse = await loadParse();
	// Whitespace around the summary in every place a hand-written or generated file puts it.
	const corpus: ReadonlyArray<readonly [string, string]> = [
		["blank line, trailing newline", '---\n"a": patch\n---\n\nFixed.\n'],
		["no blank line", '---\n"a": patch\n---\nFixed.'],
		["several blank lines and trailing blanks", '---\n"a": patch\n---\n\n\n\nFixed.\n\n\n'],
		["indented first line and trailing spaces", '---\n"a": patch\n---\n\n   Fixed.   \n'],
		["CRLF line endings", '---\r\n"a": patch\r\n---\r\n\r\nFixed.\r\n'],
		["inner blank lines kept", '---\n"a": minor\n---\n\n## Features\n\nText.\n\n- one\n'],
		["tabs around the text", '---\n"a": patch\n---\n\t\nFixed.\t\n'],
		["empty summary", '---\n"a": patch\n---\n'],
		["whitespace-only summary", '---\n"a": patch\n---\n\n  \n\n'],
	];
	for (const [label, text] of corpus) {
		it(`${label}: the summary is the oracle's`, () => {
			const ours = ChangesetFile.parseSync(text);
			assert.isTrue(Result.isSuccess(ours));
			if (Result.isSuccess(ours)) assert.strictEqual(ours.success.summary, parse(text).summary);
		});
	}
});

it.effect("keeps a pnpm directory key verbatim", () =>
	Effect.gen(function* () {
		const parsed = yield* ChangesetFile.parse('---\n"./packages/b": patch\n"@p/a": minor\n---\n\nText.\n');
		assert.deepStrictEqual(
			[...parsed.releases],
			[
				["./packages/b", "patch"],
				["@p/a", "minor"],
			],
		);
	}),
);
