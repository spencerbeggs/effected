import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Option } from "effect";
import { Ledger } from "../src/Ledger.js";

const withLedger = (text: string | undefined) =>
	MemoryFileSystem.layerWithPath({
		"/repo/.changeset/README.md": "x",
		...(text === undefined ? {} : { "/repo/.changeset/ledger.yaml": text }),
	});

const read = (text: string | undefined) =>
	Ledger.read("/repo").pipe(Effect.provide(withLedger(text)), Effect.map(Option.getOrThrow));

// The attributed shape, as `render_ledger` writes it (pnpm `crates/versioning/src/ledger.rs`:
// `render_ledger_entry`, and `ledger/tests.rs:18` for the scoped, quoted key).
const TICKET = [
	'"@example/core@1.0.0":',
	"  dir: packages/core",
	"  intents:",
	"    - calm-cats-resolve",
	"    - wild-wombats-do",
	"",
].join("\n");

it.effect("reads the attributed entry shape, splitting a scoped key on the last @", () =>
	Effect.gen(function* () {
		const ledger = yield* read(TICKET);
		assert.lengthOf(ledger.entries, 1);
		const entry = ledger.entries[0];
		assert.strictEqual(entry?.name, "@example/core");
		assert.strictEqual(entry?.version, "1.0.0");
		assert.strictEqual(entry?.dir, "packages/core");
		assert.deepStrictEqual(entry?.intents, ["calm-cats-resolve", "wild-wombats-do"]);
	}),
);

it.effect("accepts the bare id-list form (ledger.rs LedgerEntry::Ids), with no dir", () =>
	Effect.gen(function* () {
		const ledger = yield* read("pkg@1.0.0:\n  - a\n  - b\n");
		assert.strictEqual(ledger.entries[0]?.dir, undefined);
		assert.deepStrictEqual(ledger.entries[0]?.intents, ["a", "b"]);
	}),
);

it.effect("reads null and missing intent lists as empty (ledger/tests.rs:78)", () =>
	Effect.gen(function* () {
		const ledger = yield* read(
			"pkg@1.0.0:\nother@2.0.0:\n  dir: packages/other\npacquet@12.0.0-alpha.13:\n  dir: x\n  intents:\n",
		);
		assert.lengthOf(ledger.entries, 3);
		assert.isTrue(ledger.entries.every((entry) => entry.intents.length === 0));
		assert.strictEqual(ledger.entries[2]?.version, "12.0.0-alpha.13");
	}),
);

it.effect("answers none for a missing file and an empty ledger for a blank one", () =>
	Effect.gen(function* () {
		const missing = yield* Ledger.read("/repo").pipe(Effect.provide(withLedger(undefined)));
		assert.isTrue(Option.isNone(missing));
		const blank = yield* read("  \n");
		assert.lengthOf(blank.entries, 0);
	}),
);

it.effect("consumed is per package: the ticket's example", () =>
	Effect.gen(function* () {
		const ledger = yield* read(TICKET);
		assert.isTrue(ledger.consumed("calm-cats-resolve", "@example/core"));
		assert.isFalse(ledger.consumed("calm-cats-resolve", "@example/other"));
		assert.isFalse(ledger.consumed("unknown-id", "@example/core"));
	}),
);

it.effect("consumedDir matches by normalised project directory, not name (same-named projects)", () =>
	Effect.gen(function* () {
		const ledger = yield* read(
			[
				"a@1.0.0:",
				"  dir: packages/one",
				"  intents: [x]",
				"a@2.0.0:",
				"  dir: ./tools/two/",
				"  intents: [y]",
				"",
			].join("\n"),
		);
		assert.isTrue(ledger.consumedDir("x", "packages/one"));
		assert.isFalse(ledger.consumedDir("x", "tools/two"));
		assert.isTrue(ledger.consumedDir("y", "tools/two"));
		// A bare name read cannot tell the twins apart: it matches either.
		assert.isTrue(ledger.consumed("x", "a"));
	}),
);

it.effect("fails with a typed LedgerError on malformed input", () =>
	Effect.gen(function* () {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["[1,2", "invalid-yaml"],
			["- a\n", "not-a-mapping"],
			["pkg@1.0.0: 5\n", "invalid-entry"],
			["pkg@1.0.0:\n  intents: [a]\n", "invalid-entry"],
			["pkg@1.0.0:\n  dir: x\n  intents: [1]\n", "invalid-entry"],
			["pkg@1.0.0: [{a: 1}]\n", "invalid-entry"],
		];
		for (const [text, code] of cases) {
			const error = yield* Effect.flip(Ledger.read("/repo").pipe(Effect.provide(withLedger(text))));
			assert.isTrue(error._tag === "LedgerError" && error.code === code, `${text} -> ${error._tag}`);
		}
	}),
);

it.effect("treats __proto__ and inherited names as plain data, never polluting", () =>
	Effect.gen(function* () {
		const ledger = yield* read('"__proto__@1.0.0":\n  dir: p\n  intents: [a]\nconstructor@1.0.0: [b]\n');
		assert.isTrue(ledger.consumed("a", "__proto__"));
		assert.isFalse(ledger.consumed("a", "constructor"));
		assert.isTrue(ledger.consumed("b", "constructor"));
		assert.strictEqual(({} as Record<string, unknown>).dir, undefined);
	}),
);

it.effect("skips a key with no name@version split, as pnpm does", () =>
	Effect.gen(function* () {
		const ledger = yield* read('noversion:\n  - a\n"@1.0.0":\n  - b\nok@1.0.0:\n  - c\n');
		assert.deepStrictEqual(
			ledger.entries.map((entry) => entry.name),
			["ok"],
		);
	}),
);
