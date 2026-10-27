import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import {
	CurrentDistribution,
	Distribution,
	DistributionField,
	distributionSuffix,
	withDistribution,
	withDistributionVersion,
} from "../src/index.js";

describe("Distribution", () => {
	it("round-trips a plain { name, version } object", () => {
		const value = { name: "@okfit/plugin", version: "0.5.1" };
		const decoded = Schema.decodeUnknownSync(Distribution)(value);
		assert.deepStrictEqual(Schema.encodeSync(Distribution)(decoded), value);
	});

	it("DistributionField encodes a direct install as null", () => {
		assert.strictEqual(Schema.encodeSync(DistributionField)(null), null);
		assert.isNull(Schema.decodeUnknownSync(DistributionField)(null));
	});

	it("rejects a distribution missing its version", () => {
		assert.throws(() => Schema.decodeUnknownSync(Distribution)({ name: "@okfit/plugin" }));
	});
});

describe("CurrentDistribution", () => {
	it.effect("defaults to none when nothing provides it", () =>
		Effect.gen(function* () {
			const current = yield* CurrentDistribution;
			assert.isTrue(Option.isNone(current));
		}),
	);

	it.effect("reads back what main provided", () =>
		Effect.gen(function* () {
			const current = yield* CurrentDistribution;
			assert.deepStrictEqual(current, Option.some({ name: "@okfit/plugin", version: "0.5.1" }));
		}).pipe(Effect.provideService(CurrentDistribution, Option.some({ name: "@okfit/plugin", version: "0.5.1" }))),
	);
});

describe("distributionSuffix", () => {
	it("is empty for a direct install", () => {
		assert.strictEqual(distributionSuffix(Option.none()), "");
	});

	it("names the carrier when installed through one", () => {
		assert.strictEqual(
			distributionSuffix(Option.some({ name: "@okfit/plugin", version: "0.5.1" })),
			" via @okfit/plugin 0.5.1",
		);
	});
});

describe("withDistributionVersion", () => {
	const plain = (name: string, version: string) => `${name} ${version}`;

	it("leaves the wrapped line unchanged for a direct install", () => {
		assert.strictEqual(withDistributionVersion(Option.none())(plain)("mytool", "1.2.3"), "mytool 1.2.3");
	});

	it("appends the carrier to whatever the wrapped formatter produced", () => {
		const carrier = Option.some({ name: "@okfit/plugin", version: "0.5.1" });
		assert.strictEqual(
			withDistributionVersion(carrier)(plain)("okfit", "0.13.0"),
			"okfit 0.13.0 via @okfit/plugin 0.5.1",
		);
		assert.strictEqual(
			withDistributionVersion(carrier)((name, version) => `[${name}@${version}]`)("okfit", "0.13.0"),
			"[okfit@0.13.0] via @okfit/plugin 0.5.1",
		);
	});
});

const readCurrent = Effect.gen(function* () {
	return yield* CurrentDistribution;
});

describe("withDistribution", () => {
	it.effect("provides a carrier, and none for null or undefined", () =>
		Effect.gen(function* () {
			const carrier = { name: "@okfit/plugin", version: "0.5.1" };
			assert.deepStrictEqual(yield* withDistribution(carrier)(readCurrent), Option.some(carrier));
			assert.deepStrictEqual(yield* withDistribution(null)(readCurrent), Option.none());
			const inner = Effect.provideService(readCurrent, CurrentDistribution, Option.some(carrier));
			assert.deepStrictEqual(yield* withDistribution(undefined)(inner), Option.some(carrier));
		}),
	);
});
