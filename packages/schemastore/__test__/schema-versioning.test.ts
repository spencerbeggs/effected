import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import type { SchemaVersion, WriteChange } from "../src/index.js";
import { CanonicalJson, InvalidSchemaVersionError, SchemaVersioning } from "../src/index.js";

const version = (label: string): SchemaVersion => Result.getOrThrow(SchemaVersioning.parseResult(label));

// Exhaustiveness that actually holds. `[...] as const satisfies
// ReadonlyArray<WriteChange>` only checks the members PRESENT are in the
// union — it says nothing about the ones missing, so a new `WriteChange`
// member would have slipped past it silently. A `Record` keyed by the union
// cannot: adding a member makes the object literal below a compile error for
// the missing property.
const changesOf = <K extends WriteChange>(members: Record<K, null>): ReadonlyArray<K> =>
	Object.keys(members) as Array<K>;

describe("SchemaVersioning", () => {
	describe("parse", () => {
		it("accepts full three-component SemVer labels with optional prerelease", () => {
			for (const label of ["1.2.3", "0.4.0", "2.0.0-beta", "1.2.0-rc.1", "10.20.30"]) {
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("accepts one-, two- and three-component labels with optional prerelease", () => {
			for (const label of ["1", "12", "1.2", "0.4", "1.2.3", "2-beta", "1.2-rc.1", "1.2.0-rc.1"]) {
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("preserves the label verbatim rather than normalizing it", () => {
			assert.strictEqual(version("1.2"), "1.2");
			assert.strictEqual(version("1"), "1");
		});

		it("still rejects build metadata, whitespace, leading v, and empty components", () => {
			for (const label of ["1.2.3+build", "1.2+1", " 1.2 ", "v1.2", "1.", ".2", "1..2", "1.2.3.4", "", "abc"]) {
				assert.isTrue(Result.isFailure(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("accepts SemVer §9-legal prerelease identifiers: zero itself and leading-zero alphanumerics", () => {
			for (const label of ["1.2.0-0", "1.2.0-0abc", "1.2.0-rc.0", "1.2.0-01a", "1.2.0-0.3.7"]) {
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("rejects leading-zero NUMERIC prerelease identifiers", () => {
			for (const label of ["1.2.0-01", "1.2.0-00", "1.2.0-1.02", "1.2.3-01"]) {
				const result = SchemaVersioning.parseResult(label);
				assert.isTrue(Result.isFailure(result), label);
				assert.instanceOf(
					(result as Result.Failure<SchemaVersion, InvalidSchemaVersionError>).failure,
					InvalidSchemaVersionError,
				);
			}
		});

		it("rejects malformed labels typed", () => {
			for (const label of [
				"",
				"v1.2.3",
				"1.2.3.4",
				"01.2.3",
				"1..2",
				"1.2.3-",
				"1.2.3+build",
				// SemVer.parseResult trims, so these parse if the label is not
				// guarded — and the padding would survive into the emitted
				// file name and URL verbatim.
				" 1.2.3",
				"1.2.3 ",
				" 1.2.3 ",
				"\t1.2.3",
			]) {
				const result = SchemaVersioning.parseResult(label);
				assert.isTrue(Result.isFailure(result), label);
				const error = (result as Result.Failure<SchemaVersion, InvalidSchemaVersionError>).failure;
				assert.instanceOf(error, InvalidSchemaVersionError);
				assert.strictEqual(error.input, label);
			}
		});

		it.effect("Effect form derives from the Result primitive", () =>
			Effect.gen(function* () {
				const parsed = yield* SchemaVersioning.parse("1.2.0");
				assert.strictEqual(parsed, "1.2.0");
				const error = yield* Effect.flip(SchemaVersioning.parse("nope"));
				assert.strictEqual(error._tag, "InvalidSchemaVersionError");
			}),
		);
	});

	describe("components", () => {
		it("counts the numeric components present in the label", () => {
			assert.strictEqual(SchemaVersioning.components(version("1")), 1);
			assert.strictEqual(SchemaVersioning.components(version("1.2")), 2);
			assert.strictEqual(SchemaVersioning.components(version("1.2.3")), 3);
			assert.strictEqual(SchemaVersioning.components(version("1.2-rc.1")), 2);
		});
	});

	describe("isPinned", () => {
		it("a stable label is pinned", () => {
			assert.isTrue(SchemaVersioning.isPinned(version("1.2.3")));
		});

		// SemVer §9: a prerelease declares its own instability, so a contract
		// change inside one breaks nobody's pin.
		it("a prerelease label is not pinned", () => {
			assert.isFalse(SchemaVersioning.isPinned(version("2.0.0-beta.1")));
			assert.isFalse(SchemaVersioning.isPinned(version("2.0.0-0")));
		});
	});

	describe("next", () => {
		// Exhaustive over the non-contract WriteChange members: a new one added
		// to the union fails to compile here rather than silently defaulting.
		it("is the identity for every non-contract classification", () => {
			const nonContract = changesOf<Exclude<WriteChange, "contract">>({
				none: null,
				annotations: null,
				created: null,
			});
			for (const change of nonContract) {
				assert.strictEqual(SchemaVersioning.next(version("1.2.3"), change), "1.2.3", change);
			}
		});

		it("suggests a MINOR bump on a contract change, preserving the component count", () => {
			assert.strictEqual(SchemaVersioning.next(version("5.0.0"), "contract"), "5.1.0");
			assert.strictEqual(SchemaVersioning.next(version("1.2.3"), "contract"), "1.3.0");
			assert.strictEqual(SchemaVersioning.next(version("1.2"), "contract"), "1.3");
			assert.strictEqual(SchemaVersioning.next(version("0.4"), "contract"), "0.5");
			assert.strictEqual(SchemaVersioning.next(version("1"), "contract"), "2");
			assert.strictEqual(SchemaVersioning.next(version("0"), "contract"), "1");
		});

		// A delegation straight to `bump.major()` would have answered "3.0.0"
		// here — and the pipeline's "block-versioned" guard, which shares
		// `isPinned`, never refuses a prerelease write in the first place, so
		// bumping one would offer a label nobody was asked to move to.
		it("leaves a prerelease label alone even on a contract change", () => {
			assert.strictEqual(SchemaVersioning.next(version("2.0.0-beta.1"), "contract"), "2.0.0-beta.1");
			assert.strictEqual(SchemaVersioning.next(version("2.0.0-0"), "contract"), "2.0.0-0");
		});

		it("is monotonic, and strictly greater exactly when it bumps", () => {
			const labels = ["0.0.1", "0.4.0", "1.2.3", "5.0.0", "10.20.30", "2.0.0-beta.1", "1.0.0-0"].map(version);
			const changes = changesOf<WriteChange>({
				none: null,
				annotations: null,
				created: null,
				contract: null,
			});
			let bumps = 0;
			for (const label of labels) {
				for (const change of changes) {
					const next = SchemaVersioning.next(label, change);
					const order = SchemaVersioning.Order(next, label);
					assert.isAtLeast(order, 0, `${label} + ${change}`);
					const shouldBump = change === "contract" && SchemaVersioning.isPinned(label);
					assert.strictEqual(order > 0, shouldBump, `${label} + ${change}`);
					if (shouldBump) {
						bumps += 1;
					}
				}
			}
			// Not vacuous: five of the seven labels are pinned, one bump each.
			assert.strictEqual(bumps, 5);
		});

		it("every returned label re-parses and embeds verbatim in a file name", () => {
			for (const label of ["0.4.0", "1.2.3", "5.0.0", "2.0.0-beta.1"].map(version)) {
				const next = SchemaVersioning.next(label, "contract");
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(next)), next);
				assert.strictEqual(SchemaVersioning.fileName("cfg", next), `cfg-${next}.json`);
			}
		});

		it("never mints a prerelease from a pinned input", () => {
			for (const label of ["0.0.1", "0.4.0", "1.2.3", "5.0.0", "10.20.30"].map(version)) {
				assert.notInclude(SchemaVersioning.next(label, "contract"), "-");
			}
		});

		// The bump cannot represent a component past MAX_SAFE_INTEGER; the
		// module's own invariant error names the cap instead of a raw schema
		// failure escaping from SemVer.make.
		it("dies with the named invariant when a component cannot be bumped", () => {
			// Three components: `next` bumps MINOR, so only an exhausted minor
			// overflows.
			assert.throws(
				() => SchemaVersioning.next(version(`0.${Number.MAX_SAFE_INTEGER}.0`), "contract"),
				/Number\.MAX_SAFE_INTEGER/,
			);
			// One component: MAJOR is the only axis, so it overflows there instead.
			assert.throws(
				() => SchemaVersioning.next(version(`${Number.MAX_SAFE_INTEGER}`), "contract"),
				/Number\.MAX_SAFE_INTEGER/,
			);
		});
	});

	describe("Order and latest", () => {
		it("orders numerically, not lexically", () => {
			assert.isAbove(SchemaVersioning.Order(version("1.10.0"), version("1.9.0")), 0);
			assert.isBelow(SchemaVersioning.Order(version("1.2.0"), version("1.2.1")), 0);
		});

		it("ranks prereleases below their release", () => {
			assert.isBelow(SchemaVersioning.Order(version("2.0.0-beta"), version("2.0.0")), 0);
		});

		it("reads a missing component as zero, so 1, 1.0 and 1.0.0 compare equal", () => {
			assert.strictEqual(SchemaVersioning.Order(version("1"), version("1.0.0")), 0);
			assert.strictEqual(SchemaVersioning.Order(version("1.0"), version("1.0.0")), 0);
			assert.isBelow(SchemaVersioning.Order(version("1.9"), version("1.10")), 0);
			assert.isBelow(SchemaVersioning.Order(version("1"), version("1.0.1")), 0);
		});

		it("every accepted label orders without throwing (the closure invariant)", () => {
			// The brand's filter and Order's parse are now the SAME call, so
			// this can no longer diverge the way the padded grammar could —
			// the sweep stays as a regression pin on that property.
			const cores = ["0.0.0", "1.0.0", "1.2.0", "1.2.3", "10.20.30"];
			const prereleases = [
				"",
				"-0",
				"-1",
				"-01",
				"-00",
				"-0abc",
				"-01a",
				"-alpha",
				"-alpha.1",
				"-0.3.7",
				"-x-y-z",
				"--",
			];
			let accepted = 0;
			for (const core of cores) {
				for (const prerelease of prereleases) {
					const label = `${core}${prerelease}`;
					const result = SchemaVersioning.parseResult(label);
					if (Result.isSuccess(result)) {
						accepted += 1;
						// Order calls the pad on both sides; a pad failure throws.
						assert.strictEqual(SchemaVersioning.Order(result.success, result.success), 0, label);
					}
				}
			}
			// The sweep must not be vacuous: only the two leading-zero numeric
			// prerelease suffixes ("-01", "-00") are rejected per core.
			assert.strictEqual(accepted, cores.length * (prereleases.length - 2));
		});

		it("latest picks the highest label and none for empty input", () => {
			const labels = ["1.9.0", "1.10.0", "1.2.3"].map(version);
			assert.deepStrictEqual(SchemaVersioning.latest(labels), Option.some(version("1.10.0")));
			// A higher-major prerelease still outranks a lower major.
			assert.deepStrictEqual(
				SchemaVersioning.latest([...labels, version("2.0.0-beta")]),
				Option.some(version("2.0.0-beta")),
			);
			assert.deepStrictEqual(SchemaVersioning.latest([]), Option.none());
		});
	});

	describe("fileName and schemaUrl", () => {
		it("derives unversioned and versioned file names", () => {
			assert.strictEqual(SchemaVersioning.fileName("agripparc"), "agripparc.json");
			// SchemaStore's own suffix convention, with a full SemVer label.
			assert.strictEqual(SchemaVersioning.fileName("agripparc", version("1.2.0")), "agripparc-1.2.0.json");
		});

		it("throws on names that are not simple file base names", () => {
			assert.throws(() => SchemaVersioning.fileName(""));
			assert.throws(() => SchemaVersioning.fileName("a/b"));
			assert.throws(() => SchemaVersioning.fileName("a b"));
		});

		it("joins baseUrl without doubling slashes", () => {
			assert.strictEqual(
				SchemaVersioning.schemaUrl("https://example.com/schemas/", "cfg"),
				"https://example.com/schemas/cfg.json",
			);
			assert.strictEqual(
				SchemaVersioning.schemaUrl("https://example.com/schemas", "cfg"),
				"https://example.com/schemas/cfg.json",
			);
		});
	});

	describe("catalogUrls", () => {
		it("unversioned mode: url only, no versions map", () => {
			const urls = SchemaVersioning.catalogUrls({ baseUrl: "https://example.com", name: "cfg" });
			assert.deepStrictEqual(urls, { url: "https://example.com/cfg.json" });
		});

		it("versioned mode: ascending versions map with url at the latest", () => {
			const urls = SchemaVersioning.catalogUrls({
				baseUrl: "https://example.com",
				name: "agripparc",
				versions: ["1.4.0", "1.2.0", "1.3.0"].map(version),
			});
			assert.strictEqual(urls.url, "https://example.com/agripparc-1.4.0.json");
			assert.deepStrictEqual(urls.versions, {
				"1.2.0": "https://example.com/agripparc-1.2.0.json",
				"1.3.0": "https://example.com/agripparc-1.3.0.json",
				"1.4.0": "https://example.com/agripparc-1.4.0.json",
			});
			assert.deepStrictEqual(Object.keys(urls.versions ?? {}), ["1.2.0", "1.3.0", "1.4.0"]);
		});

		// Requiring three components RETIRES the JS-object caveat the docs
		// used to record: a bare-major label ("2") is array-index-like and
		// enumerated ahead of every dotted key regardless of insertion order.
		// No SemVer label can be integer-like, so insertion order now holds
		// all the way through serialization.
		it("no label is array-index-like, so ascending insertion order survives serialization", () => {
			const urls = SchemaVersioning.catalogUrls({
				baseUrl: "https://example.com",
				name: "cfg",
				versions: ["2.0.0", "1.5.0"].map(version),
			});
			assert.strictEqual(urls.url, "https://example.com/cfg-2.0.0.json");
			assert.deepStrictEqual(Object.keys(urls.versions ?? {}), ["1.5.0", "2.0.0"]);
			const text = Result.getOrThrow(CanonicalJson.serializeResult(urls.versions));
			assert.isBelow(text.indexOf('"1.5.0"'), text.indexOf('"2.0.0"'));
		});

		it("throws on the versioned/empty contradiction", () => {
			assert.throws(() => SchemaVersioning.catalogUrls({ baseUrl: "https://example.com", name: "cfg", versions: [] }));
		});
	});
});
