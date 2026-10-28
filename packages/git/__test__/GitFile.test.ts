import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { GitFile, GitFileParseError } from "../src/GitFile.js";

// Each row's expectation is what git 2.56's `rev-parse --git-dir` did with
// the same bytes in a `.git` file (#1137): which texts it read as a pointer,
// what the pointer was, and which it refused and how.
const accepted: ReadonlyArray<readonly [string, string, string]> = [
	["a relative pointer", "gitdir: ../real\n", "../real"],
	["an absolute pointer", "gitdir: /srv/repo/.git/worktrees/wt\n", "/srv/repo/.git/worktrees/wt"],
	["no final newline", "gitdir: ../real", "../real"],
	["a CRLF ending", "gitdir: ../real\r\n", "../real"],
	["a run of trailing CR and LF", "gitdir: ../real\n\r\n\n", "../real"],
	["a second space, kept as part of the path", "gitdir:  lead\n", " lead"],
	["a trailing space, kept as part of the path", "gitdir: ../trail \n", "../trail "],
	["an embedded newline, kept as part of the path", "gitdir: ../real\nextra\n", "../real\nextra"],
	["a NUL, which ends the path", "gitdir: ../real\0junk\n", "../real"],
];

const refused: ReadonlyArray<readonly [string, string, "InvalidFormat" | "NoPath"]> = [
	["no space after the colon", "gitdir:../real\n", "InvalidFormat"],
	["a tab after the colon", "gitdir:\t../real\n", "InvalidFormat"],
	["an uppercase prefix", "GITDIR: ../real\n", "InvalidFormat"],
	["a leading blank line", "\ngitdir: ../real\n", "InvalidFormat"],
	["a byte-order mark", "﻿gitdir: ../real\n", "InvalidFormat"],
	["the prefix without its space", "gitdir:\n", "InvalidFormat"],
	["an empty text", "", "InvalidFormat"],
	["no path after the prefix", "gitdir: \n", "NoPath"],
	["only line endings after the prefix", "gitdir: \r\n\n", "NoPath"],
	["a NUL straight after the prefix", "gitdir: \0../real\n", "NoPath"],
];

describe("GitFile.parseResult", () => {
	for (const [name, text, gitdir] of accepted) {
		it(`reads ${name}`, () => {
			const parsed = GitFile.parseResult(text);
			assert.isTrue(Result.isSuccess(parsed));
			if (Result.isSuccess(parsed)) {
				assert.instanceOf(parsed.success, GitFile);
				assert.strictEqual(parsed.success.gitdir, gitdir);
			}
		});
	}

	for (const [name, text, code] of refused) {
		it(`refuses ${name} as ${code}`, () => {
			const parsed = GitFile.parseResult(text);
			assert.isTrue(Result.isFailure(parsed));
			if (Result.isFailure(parsed)) {
				assert.instanceOf(parsed.failure, GitFileParseError);
				assert.strictEqual(parsed.failure.code, code);
			}
		});
	}

	it("stays linear on a long run of trailing newlines", () => {
		const parsed = GitFile.parseResult(`gitdir: x${"\n".repeat(1_000_000)}`);
		assert.isTrue(Result.isSuccess(parsed) && parsed.success.gitdir === "x");
	});
});

describe("GitFile.parse", () => {
	it.effect("succeeds with the same value as parseResult", () =>
		Effect.gen(function* () {
			const parsed = yield* GitFile.parse("gitdir: ../.git/modules/lib\n");
			assert.strictEqual(parsed.gitdir, "../.git/modules/lib");
		}),
	);

	it.effect("fails typed, never as a defect", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(GitFile.parse("not a gitfile"));
			assert.strictEqual(error._tag, "GitFileParseError");
			assert.strictEqual(error.code, "InvalidFormat");
			assert.include(error.message, "gitdir: ");
		}),
	);
});
