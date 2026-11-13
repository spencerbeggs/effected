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

it.effect("consumption is per project: the ticket's example (attributed entry, matched by dir)", () =>
	Effect.gen(function* () {
		const ledger = yield* read(TICKET);
		const core = { name: "@example/core", dir: "packages/core" };
		assert.strictEqual(ledger.consumption("calm-cats-resolve", core), "stable");
		assert.strictEqual(
			ledger.consumption("calm-cats-resolve", { name: "@example/other", dir: "packages/other" }),
			"none",
		);
		assert.strictEqual(ledger.consumption("unknown-id", core), "none");
		assert.isTrue(ledger.consumedDir("calm-cats-resolve", "./packages/core/"));
	}),
);

it.effect(
	"a bare-list entry is matched by name; consumed ignores attributed entries (ledger.rs entry_project_dir)",
	() =>
		Effect.gen(function* () {
			const ledger = yield* read("bare@1.0.0:\n  - x\nattr@1.0.0:\n  dir: packages/attr\n  intents: [x]\n");
			assert.isTrue(ledger.consumed("x", "bare"));
			assert.isFalse(ledger.consumed("x", "attr"));
			assert.strictEqual(ledger.consumption("x", { name: "bare", dir: "anywhere" }), "stable");
		}),
);

it.effect("rename: an attributed entry matches the project's dir, not the old name in its key", () =>
	Effect.gen(function* () {
		const ledger = yield* read("old@1.0.0:\n  dir: packages/a\n  intents: [x]\n");
		assert.strictEqual(ledger.consumption("x", { name: "new", dir: "packages/a" }), "stable");
	}),
);

it.effect("name reuse: the same name at another dir is not consumed", () =>
	Effect.gen(function* () {
		const ledger = yield* read("a@1.0.0:\n  dir: packages/one\n  intents: [x]\n");
		assert.strictEqual(ledger.consumption("x", { name: "a", dir: "packages/two" }), "none");
		assert.isFalse(ledger.consumed("x", "a"));
	}),
);

it.effect("same-named projects are told apart by dir, with a normalised dir", () =>
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
	}),
);

// pnpm splits ids into stable and prerelease-only (`ledger.rs` `build_consumption_index`, `package_consumption`);
// a version whose part before `+` contains `-` is a prerelease (`is_prerelease_version`).
it.effect("consumption is three-state: none, prerelease-only, stable", () =>
	Effect.gen(function* () {
		const ledger = yield* read(
			[
				"p@2.1.0-alpha.0:",
				"  dir: packages/p",
				"  intents: [pre, both]",
				"p@2.1.0:",
				"  dir: packages/p",
				"  intents: [both, stable]",
				"p@3.0.0+build-1:",
				"  dir: packages/p",
				"  intents: [meta]",
				"",
			].join("\n"),
		);
		const p = { name: "p", dir: "packages/p" };
		assert.strictEqual(ledger.consumption("pre", p), "prerelease-only");
		assert.strictEqual(ledger.consumption("both", p), "stable");
		assert.strictEqual(ledger.consumption("stable", p), "stable");
		assert.strictEqual(ledger.consumption("meta", p), "stable");
		assert.strictEqual(ledger.consumption("none", p), "none");
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
			["pkg@1.0.0: [a]\npkg@1.0.0: [b]\n", "invalid-yaml"],
			[`${"[".repeat(20000)}${"]".repeat(20000)}\n`, "invalid-yaml"],
		];
		for (const [text, code] of cases) {
			const error = yield* Effect.flip(Ledger.read("/repo").pipe(Effect.provide(withLedger(text))));
			assert.strictEqual(error._tag, "LedgerError", text);
			assert.strictEqual(error._tag === "LedgerError" ? error.code : undefined, code, text);
		}
	}),
);

it.effect("treats __proto__ and inherited names as plain data, never polluting", () =>
	Effect.gen(function* () {
		const ledger = yield* read('"__proto__@1.0.0":\n  dir: p\n  intents: [a]\nconstructor@1.0.0: [b]\n');
		assert.strictEqual(ledger.consumption("a", { name: "__proto__", dir: "p" }), "stable");
		assert.strictEqual(ledger.consumption("a", { name: "constructor", dir: "q" }), "none");
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
