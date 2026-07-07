import { assert, describe, it } from "@effect/vitest";
import { Effect, Equal, Hash, Option, Schema } from "effect";
import { InvalidVersionError, SemVer } from "../src/index.js";

const parse = (input: string) => Effect.runSync(SemVer.parse(input));

describe("SemVer", () => {
	describe("parse", () => {
		it.effect("parses a full version", () =>
			Effect.gen(function* () {
				const v = yield* SemVer.parse("1.2.3-beta.1+build.42");
				assert.strictEqual(v.major, 1);
				assert.strictEqual(v.minor, 2);
				assert.strictEqual(v.patch, 3);
				assert.deepStrictEqual([...v.prerelease], ["beta", 1]);
				assert.deepStrictEqual([...v.build], ["build", "42"]);
			}),
		);

		it.effect("fails with InvalidVersionError carrying input and position", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(SemVer.parse("01.2.3"));
				assert.instanceOf(error, InvalidVersionError);
				assert.strictEqual(error._tag, "InvalidVersionError");
				assert.strictEqual(error.input, "01.2.3");
				assert.strictEqual(error.position, 0);
				assert.strictEqual(error.message, 'Invalid version string: "01.2.3" at position 0');
			}),
		);

		it.effect("rejects v-prefixed versions", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(SemVer.parse("v1.0.0"));
				assert.strictEqual(error._tag, "InvalidVersionError");
			}),
		);
	});

	describe("FromString", () => {
		it.effect("decodes a version string to a SemVer instance", () =>
			Effect.gen(function* () {
				const v = yield* Schema.decodeUnknownEffect(SemVer.FromString)("2.0.0-rc.1");
				assert.instanceOf(v, SemVer);
				assert.strictEqual(v.major, 2);
				assert.deepStrictEqual([...v.prerelease], ["rc", 1]);
			}),
		);

		it.effect("encodes back to the canonical string", () =>
			Effect.gen(function* () {
				const v = yield* SemVer.parse("1.2.3-beta.1+build.42");
				const encoded = yield* Schema.encodeUnknownEffect(SemVer.FromString)(v);
				assert.strictEqual(encoded, "1.2.3-beta.1+build.42");
			}),
		);

		it.effect("fails decoding invalid input with a SchemaError", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Schema.decodeUnknownEffect(SemVer.FromString)("nope"));
				assert.strictEqual(error._tag, "SchemaError");
			}),
		);

		it.effect.prop("round-trips decode(encode(v))", [SemVer], ([v]) =>
			Effect.gen(function* () {
				const encoded = yield* Schema.encodeUnknownEffect(SemVer.FromString)(v);
				const decoded = yield* Schema.decodeUnknownEffect(SemVer.FromString)(encoded);
				assert.isTrue(Equal.equals(decoded, v), `expected ${decoded.toString()} to equal ${v.toString()}`);
				assert.deepStrictEqual([...decoded.build], [...v.build]);
			}),
		);
	});

	describe("make validation", () => {
		it("rejects negative components", () => {
			assert.throws(() => SemVer.make({ major: -1, minor: 0, patch: 0, prerelease: [], build: [] }));
		});

		it("rejects fractional components", () => {
			assert.throws(() => SemVer.make({ major: 1.5, minor: 0, patch: 0, prerelease: [], build: [] }));
		});

		it("rejects malformed prerelease identifiers", () => {
			assert.throws(() => SemVer.make({ major: 1, minor: 0, patch: 0, prerelease: ["not ok"], build: [] }));
		});

		it("rejects all-digit string prerelease identifiers", () => {
			assert.throws(() => SemVer.make({ major: 1, minor: 0, patch: 0, prerelease: ["007"], build: [] }));
		});
	});

	describe("comparison", () => {
		it.effect("instance methods agree with the spec", () =>
			Effect.gen(function* () {
				const a = yield* SemVer.parse("1.0.0");
				const b = yield* SemVer.parse("2.0.0");
				assert.strictEqual(a.compare(b), -1);
				assert.isTrue(a.lt(b));
				assert.isTrue(a.lte(b));
				assert.isTrue(b.gt(a));
				assert.isTrue(b.gte(a));
				assert.isTrue(a.neq(b));
				assert.isFalse(a.equal(b));
			}),
		);

		it("dual statics support both call forms", () => {
			const a = parse("1.0.0");
			const b = parse("2.0.0");
			assert.strictEqual(SemVer.compare(a, b), -1);
			assert.strictEqual(SemVer.compare(b)(a), -1);
			assert.isTrue(SemVer.lt(a, b));
			// Data-last: gt(that)(self) tests self > that.
			assert.isTrue(SemVer.gt(a)(b));
			assert.isTrue(SemVer.equal(a, parse("1.0.0+different.build")));
		});

		it("Order ignores build metadata; OrderWithBuild breaks ties", () => {
			const plain = parse("1.0.0");
			const withBuild = parse("1.0.0+abc");
			assert.strictEqual(SemVer.Order(plain, withBuild), 0);
			assert.isBelow(SemVer.OrderWithBuild(plain, withBuild), 0);
		});
	});

	describe("equality and hashing", () => {
		it("ignores build metadata but not prerelease (SemVer §10/§11)", () => {
			const a = parse("1.2.3-alpha.1+build.1");
			const b = parse("1.2.3-alpha.1+build.2");
			const c = parse("1.2.3-alpha.2+build.1");
			assert.isTrue(Equal.equals(a, b));
			assert.isFalse(Equal.equals(a, c));
		});

		it("hash agrees with equality across build metadata", () => {
			const a = parse("1.2.3-alpha.1+build.1");
			const b = parse("1.2.3-alpha.1+build.2");
			assert.strictEqual(Hash.hash(a), Hash.hash(b));
		});
	});

	describe("predicates", () => {
		it("isStable / isPrerelease", () => {
			assert.isTrue(parse("1.0.0").isStable);
			assert.isFalse(parse("1.0.0").isPrerelease);
			assert.isTrue(parse("1.0.0-rc.1").isPrerelease);
			assert.isFalse(parse("1.0.0-rc.1").isStable);
		});
	});

	describe("bump", () => {
		it("major/minor/patch reset lower components and metadata", () => {
			const v = parse("1.2.3-beta.1+build");
			assert.strictEqual(v.bump.major().toString(), "2.0.0");
			assert.strictEqual(v.bump.minor().toString(), "1.3.0");
			assert.strictEqual(v.bump.patch().toString(), "1.2.4");
		});

		it("prerelease bump on a stable version starts the next patch prerelease", () => {
			assert.strictEqual(parse("1.0.0").bump.prerelease().toString(), "1.0.1-0");
			assert.strictEqual(parse("1.0.0").bump.prerelease("alpha").toString(), "1.0.1-alpha.0");
		});

		it("prerelease bump increments a trailing numeric identifier", () => {
			assert.strictEqual(parse("1.0.1-alpha.0").bump.prerelease().toString(), "1.0.1-alpha.1");
			assert.strictEqual(parse("1.0.1-alpha.0").bump.prerelease("alpha").toString(), "1.0.1-alpha.1");
		});

		it("switching prerelease identifiers resets the counter", () => {
			assert.strictEqual(parse("1.0.1-alpha.4").bump.prerelease("beta").toString(), "1.0.1-beta.0");
		});

		it("appends a counter to a non-numeric tail", () => {
			assert.strictEqual(parse("1.0.1-alpha").bump.prerelease().toString(), "1.0.1-alpha.0");
		});

		it("release strips prerelease and build", () => {
			assert.strictEqual(parse("1.2.3-rc.1+meta").bump.release().toString(), "1.2.3");
		});
	});

	describe("truncate", () => {
		it("truncates to release or to prerelease-with-no-build", () => {
			const v = parse("1.2.3-alpha.1+build");
			assert.strictEqual(SemVer.truncate(v, "prerelease").toString(), "1.2.3");
			assert.strictEqual(SemVer.truncate(v, "build").toString(), "1.2.3-alpha.1");
			assert.strictEqual(SemVer.truncate("build")(v).toString(), "1.2.3-alpha.1");
		});
	});

	describe("collections", () => {
		const versions = ["2.0.0", "1.0.0-alpha", "1.0.0", "1.5.0"].map(parse);

		it("sort ascending / rsort descending", () => {
			assert.deepStrictEqual(SemVer.sort(versions).map(String), ["1.0.0-alpha", "1.0.0", "1.5.0", "2.0.0"]);
			assert.deepStrictEqual(SemVer.rsort(versions).map(String), ["2.0.0", "1.5.0", "1.0.0", "1.0.0-alpha"]);
		});

		it("max / min return Options", () => {
			assert.deepStrictEqual(SemVer.max(versions).pipe(Option.map(String)), Option.some("2.0.0"));
			assert.deepStrictEqual(SemVer.min(versions).pipe(Option.map(String)), Option.some("1.0.0-alpha"));
			assert.isTrue(Option.isNone(SemVer.max([])));
			assert.isTrue(Option.isNone(SemVer.min([])));
		});

		it("groupBy returns an immutable record keyed by strategy", () => {
			const grouped = SemVer.groupBy(["1.0.0", "1.5.0", "2.0.0"].map(parse), "major");
			assert.deepStrictEqual(Object.keys(grouped), ["1", "2"]);
			assert.deepStrictEqual(grouped["1"].map(String), ["1.0.0", "1.5.0"]);
		});

		it("latestByMajor / latestByMinor keep the highest per group", () => {
			const input = ["1.0.0", "1.5.0", "1.5.9", "2.0.0", "2.1.0"].map(parse);
			assert.deepStrictEqual(SemVer.latestByMajor(input).map(String), ["1.5.9", "2.1.0"]);
			assert.deepStrictEqual(SemVer.latestByMinor(input).map(String), ["1.0.0", "1.5.9", "2.0.0", "2.1.0"]);
		});
	});

	describe("of", () => {
		it("constructs positionally with validation", () => {
			assert.strictEqual(SemVer.of(1, 2, 3, ["rc", 1], ["sha"]).toString(), "1.2.3-rc.1+sha");
		});
	});
});
