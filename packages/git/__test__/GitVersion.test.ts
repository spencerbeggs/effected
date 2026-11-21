import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { GitVersion } from "../src/GitVersion.js";

const parsed = (text: string): GitVersion => {
	const result = GitVersion.parse(text);
	assert.isTrue(Option.isSome(result));
	return Option.getOrThrow(result);
};

describe("GitVersion", () => {
	it("parses a plain version line", () => {
		const v = parsed("git version 2.56.0\n");
		assert.deepStrictEqual([v.major, v.minor, v.patch], [2, 56, 0]);
		assert.strictEqual(v.toString(), "2.56.0");
	});

	it("parses an Apple suffix", () => {
		assert.strictEqual(parsed("git version 2.39.5 (Apple Git-154)").toString(), "2.39.5");
	});

	it("parses a Windows suffix", () => {
		assert.strictEqual(parsed("git version 2.47.1.windows.1").toString(), "2.47.1");
	});

	it("returns none for garbage", () => {
		assert.isTrue(Option.isNone(GitVersion.parse("garbage")));
		assert.isTrue(Option.isNone(GitVersion.parse("git version x.y")));
	});

	it("atLeast compares major, minor, patch", () => {
		const floor = new GitVersion({ major: 2, minor: 39, patch: 0 });
		assert.isTrue(GitVersion.atLeast(parsed("git version 2.39.5"), floor));
		assert.isTrue(GitVersion.atLeast(parsed("git version 2.39.0"), floor));
		assert.isFalse(GitVersion.atLeast(parsed("git version 2.38.9"), floor));
		assert.isTrue(GitVersion.atLeast(parsed("git version 3.0.0"), floor));
	});
});
