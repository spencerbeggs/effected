import { assert, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { ChangesetFile } from "../src/ChangesetFile.js";

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
		assert.strictEqual(parsed.summary, "## Features\n\nText.\n");
	}),
);

it.effect("rejects a bump outside patch|minor|major", () =>
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
		assert.strictEqual(sync.success.summary, "## Features\n\nText.\n");
		assert.strictEqual(sync.success.releases.get("@effected/a"), "minor");
	}
	const bad = ChangesetFile.parseSync("nope");
	assert.isTrue(Result.isFailure(bad));
});
