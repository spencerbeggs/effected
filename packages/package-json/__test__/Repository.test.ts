// `repository`, `bugs` and `homepage` — the manifest fields a consumer reaches
// for when it needs to say where a package LIVES.
//
// The motivating evidence is silk-release-action's `infer-sbom-metadata.ts`,
// which hand-rolls `parseRepository` / `parseBugs` because this package offered
// `repository` as an untyped `Union([String, Record])` and no `bugs` at all.
// The hand-roll handles four git-URL rewrites and misses every npm shorthand
// (`github:user/repo`, bare `user/repo`), which is the "improve on it where it
// is sloppy" half of this gap-fill.
//
// Wire fidelity is the same hard requirement the rest of this package holds: a
// formatter must not rewrite one legal encoding into another, so a shorthand
// string round-trips as that exact string.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { Bugs, Repository } from "../src/index.js";

const decode = <A, I>(schema: Schema.Codec<A, I>, input: I) => Schema.decodeUnknownEffect(schema)(input);
const encode = <A, I>(schema: Schema.Codec<A, I>, value: A) => Schema.encodeUnknownEffect(schema)(value);

describe("Repository — the npm shorthands", () => {
	it.effect("a bare `user/repo` browses to GitHub", () =>
		Effect.gen(function* () {
			// The default host. `parseRepository` missed this entirely and returned
			// the string unchanged, so a consumer got `"user/repo"` where it wanted
			// a URL.
			const repo = yield* decode(Repository.FromValue, "effected/kit");
			assert.deepStrictEqual(repo.browseUrl, Option.some("https://github.com/effected/kit"));
		}),
	);

	it.effect("the host-prefixed shorthands resolve to their hosts", () =>
		Effect.gen(function* () {
			const cases = [
				["github:effected/kit", "https://github.com/effected/kit"],
				["gitlab:effected/kit", "https://gitlab.com/effected/kit"],
				["bitbucket:effected/kit", "https://bitbucket.org/effected/kit"],
				["gist:abc123def", "https://gist.github.com/abc123def"],
			] as const;
			for (const [input, expected] of cases) {
				const repo = yield* decode(Repository.FromValue, input);
				assert.deepStrictEqual(repo.browseUrl, Option.some(expected), input);
			}
		}),
	);
});

describe("Repository — git URL normalization", () => {
	it.effect("normalizes every form the hand-roll handled", () =>
		Effect.gen(function* () {
			const cases = [
				"git+https://github.com/effected/kit.git",
				"git://github.com/effected/kit.git",
				"git@github.com:effected/kit.git",
				"https://github.com/effected/kit.git",
				"https://github.com/effected/kit",
			] as const;
			for (const input of cases) {
				const repo = yield* decode(Repository.FromValue, input);
				assert.deepStrictEqual(repo.browseUrl, Option.some("https://github.com/effected/kit"), input);
			}
		}),
	);

	it.effect("handles the `git+ssh://` form the hand-roll missed", () =>
		Effect.gen(function* () {
			// `git+ssh://git@github.com/u/r.git` survived `parseRepository` with its
			// scheme intact, because the `git@host:` rewrite only matched the scp
			// form.
			const repo = yield* decode(Repository.FromValue, "git+ssh://git@github.com/effected/kit.git");
			assert.deepStrictEqual(repo.browseUrl, Option.some("https://github.com/effected/kit"));
		}),
	);

	it.effect("a non-GitHub host keeps its host", () =>
		Effect.gen(function* () {
			const repo = yield* decode(Repository.FromValue, "git@git.example.com:team/thing.git");
			assert.deepStrictEqual(repo.browseUrl, Option.some("https://git.example.com/team/thing"));
		}),
	);

	it.effect("`gitUrl` is the canonical clone URL", () =>
		Effect.gen(function* () {
			const repo = yield* decode(Repository.FromValue, "git@github.com:effected/kit.git");
			assert.deepStrictEqual(repo.gitUrl, Option.some("https://github.com/effected/kit.git"));
		}),
	);

	it.effect("an underivable url yields None rather than a guess", () =>
		Effect.gen(function* () {
			// Total by construction: `repository` is caller data, and a value we
			// cannot interpret is a missing answer, not a failure — the same
			// posture the rest of the kit takes on absence.
			const repo = yield* decode(Repository.FromValue, "not a url at all");
			assert.isTrue(Option.isNone(repo.browseUrl));
			assert.isTrue(Option.isNone(repo.gitUrl));
			// The raw value is still there for a caller that knows better.
			assert.strictEqual(repo.url, "not a url at all");
		}),
	);
});

describe("Repository — the object form", () => {
	it.effect("reads type, url and directory", () =>
		Effect.gen(function* () {
			const repo = yield* decode(Repository.FromValue, {
				type: "git",
				url: "git+https://github.com/effected/kit.git",
				directory: "packages/package-json",
			});
			assert.strictEqual(repo.type, "git");
			assert.strictEqual(repo.directory, "packages/package-json");
			assert.deepStrictEqual(repo.browseUrl, Option.some("https://github.com/effected/kit"));
		}),
	);

	it.effect("keeps unknown keys instead of dropping them", () =>
		Effect.gen(function* () {
			const wire = { type: "git", url: "https://github.com/effected/kit", custom: "keep me" };
			const repo = yield* decode(Repository.FromValue, wire);
			const encoded = yield* encode(Repository.FromValue, repo);
			assert.deepStrictEqual<unknown>(encoded, wire);
		}),
	);
});

describe("Repository — wire fidelity", () => {
	it.effect("a shorthand string re-encodes as that exact string", () =>
		Effect.gen(function* () {
			// The load-bearing property: formatting a manifest must not rewrite
			// `"effected/kit"` into `{ "url": "effected/kit" }`.
			for (const input of ["effected/kit", "github:effected/kit", "git@github.com:effected/kit.git"]) {
				const repo = yield* decode(Repository.FromValue, input);
				const encoded = yield* encode(Repository.FromValue, repo);
				assert.strictEqual(encoded, input, input);
			}
		}),
	);

	it.effect("an object re-encodes as an object", () =>
		Effect.gen(function* () {
			const wire = { type: "git", url: "https://github.com/effected/kit" };
			const encoded = yield* encode(Repository.FromValue, yield* decode(Repository.FromValue, wire));
			assert.deepStrictEqual<unknown>(encoded, wire);
		}),
	);

	it.effect("a STALE wire is not replayed once the url no longer matches", () =>
		Effect.gen(function* () {
			// `Schema.Class` instances are not frozen at runtime (probed), so a
			// mutated instance keeps its provenance entry while no longer being
			// described by it. Without the url check on the replay, this re-encodes
			// as the ORIGINAL shorthand and silently writes the wrong repository
			// back to the manifest. Found by a surviving mutant — the guard was
			// there, the test was not.
			const repo = yield* decode(Repository.FromValue, "effected/kit");
			(repo as { url: string }).url = "effected/other";
			const encoded = yield* encode(Repository.FromValue, repo);
			assert.notStrictEqual(encoded, "effected/kit");
			assert.deepStrictEqual<unknown>(encoded, { url: "effected/other" });
		}),
	);

	it.effect("a hand-built repository encodes canonically as an object", () =>
		Effect.gen(function* () {
			// No provenance to replay, so the canonical form is the honest answer —
			// the `Person` precedent exactly.
			const repo = Repository.make({ url: "https://github.com/effected/kit" });
			const encoded = yield* encode(Repository.FromValue, repo);
			assert.deepStrictEqual<unknown>(encoded, { url: "https://github.com/effected/kit" });
		}),
	);
});

describe("Bugs", () => {
	it.effect("a string is the issue-tracker url", () =>
		Effect.gen(function* () {
			const bugs = yield* decode(Bugs.FromValue, "https://github.com/effected/kit/issues");
			assert.strictEqual(bugs.url, "https://github.com/effected/kit/issues");
			assert.isUndefined(bugs.email);
		}),
	);

	it.effect("the object form carries url and email", () =>
		Effect.gen(function* () {
			const bugs = yield* decode(Bugs.FromValue, {
				url: "https://github.com/effected/kit/issues",
				email: "bugs@example.com",
			});
			assert.strictEqual(bugs.url, "https://github.com/effected/kit/issues");
			assert.strictEqual(bugs.email, "bugs@example.com");
		}),
	);

	it.effect("an email-only object is legal — npm permits it", () =>
		Effect.gen(function* () {
			const bugs = yield* decode(Bugs.FromValue, { email: "bugs@example.com" });
			assert.isUndefined(bugs.url);
			assert.strictEqual(bugs.email, "bugs@example.com");
		}),
	);

	it.effect("a string round-trips as a string", () =>
		Effect.gen(function* () {
			const input = "https://github.com/effected/kit/issues";
			const encoded = yield* encode(Bugs.FromValue, yield* decode(Bugs.FromValue, input));
			assert.strictEqual(encoded, input);
		}),
	);
});
