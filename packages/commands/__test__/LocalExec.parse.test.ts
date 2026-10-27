import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Option, Schema } from "effect";
import { ExecKind, Launcher, LocalExec, PARSE_TABLE } from "../src/LocalExec.js";

const FIELD = { exec: "prefix", dlx: "dlxPrefix", script: "scriptPrefix" } as const;

/** A binary the refusal rule admits: non-empty, not starting with `-`. */
const binaryArb = Arbitrary.schema(Schema.NonEmptyString).pipe(Arbitrary.filter((s) => !s.startsWith("-")));

describe("LocalExec.parse", () => {
	it("round-trips every canonical prefix for a fixed matrix, including tricky binaries and rests", () => {
		for (const launcher of Launcher.literals) {
			for (const kind of ExecKind.literals) {
				const prefix = LocalExec.prefixes(launcher)[FIELD[kind]];
				for (const binary of ["vitest", "x", "run", "exec", "dlx"]) {
					for (const rest of [[], ["--run"], ["--", "a"], ["-x", "--no"], ["vitest"], ["--no-install"]]) {
						assert.deepStrictEqual(
							LocalExec.parse([...prefix, binary, ...rest]),
							Option.some({ launcher, kind, binary, rest }),
							`${prefix.join(" ")} ${binary} ${rest.join(" ")}`,
						);
					}
				}
			}
		}
	});

	it.prop(
		"round-trips any launcher, kind, admitted binary and rest",
		[Launcher, ExecKind, binaryArb, Schema.Array(Schema.String)],
		([launcher, kind, binary, rest]) => {
			const parsed = LocalExec.parse([...LocalExec.prefixes(launcher)[FIELD[kind]], binary, ...rest]);
			return (
				Option.isSome(parsed) &&
				parsed.value.launcher === launcher &&
				parsed.value.kind === kind &&
				parsed.value.binary === binary &&
				parsed.value.rest.length === rest.length &&
				parsed.value.rest.every((arg, index) => arg === rest[index])
			);
		},
	);

	it("tells the longer prefix from its shorter sibling", () => {
		assert.deepStrictEqual(
			LocalExec.parse(["bun", "x", "--no-install", "vitest"]),
			Option.some({ launcher: "bun", kind: "exec", binary: "vitest", rest: [] }),
		);
		assert.deepStrictEqual(
			LocalExec.parse(["bun", "x", "vitest"]),
			Option.some({ launcher: "bun", kind: "dlx", binary: "vitest", rest: [] }),
		);
		assert.deepStrictEqual(
			LocalExec.parse(["npx", "--no", "--", "vitest", "run"]),
			Option.some({ launcher: "npm", kind: "exec", binary: "vitest", rest: ["run"] }),
		);
		assert.deepStrictEqual(
			LocalExec.parse(["npx", "vitest"]),
			Option.some({ launcher: "npm", kind: "dlx", binary: "vitest", rest: [] }),
		);
		assert.deepStrictEqual(
			LocalExec.parse(["npm", "run", "--", "test", "--flag"]),
			Option.some({ launcher: "npm", kind: "script", binary: "test", rest: ["--flag"] }),
		);
	});

	it("recognizes the alternative spellings prefixes never emits", () => {
		const cases: ReadonlyArray<readonly [ReadonlyArray<string>, string, string]> = [
			[["npm", "exec", "vitest"], "npm", "dlx"],
			[["npm", "exec", "--no", "--", "vitest"], "npm", "exec"],
			[["npm", "x", "vitest"], "npm", "dlx"],
			[["npx", "-y", "vitest"], "npm", "dlx"],
			[["npx", "--yes", "vitest"], "npm", "dlx"],
			[["npx", "--no-install", "vitest"], "npm", "exec"],
			[["npx", "--no", "vitest"], "npm", "exec"],
			[["npm", "exec", "--", "vitest"], "npm", "dlx"],
			[["npm", "run", "test"], "npm", "script"],
			[["npm", "run-script", "test"], "npm", "script"],
			[["pnpx", "vitest"], "pnpm", "dlx"],
			[["bunx", "vitest"], "bun", "dlx"],
			[["bunx", "--no-install", "vitest"], "bun", "exec"],
		];
		for (const [argv, launcher, kind] of cases) {
			const parsed = LocalExec.parse(argv);
			assert.isTrue(Option.isSome(parsed), argv.join(" "));
			if (Option.isSome(parsed)) {
				assert.strictEqual(parsed.value.launcher, launcher, argv.join(" "));
				assert.strictEqual(parsed.value.kind, kind, argv.join(" "));
				assert.strictEqual(parsed.value.binary, argv[argv.length - 1]);
			}
		}
	});

	it("answers none for bare prefixes, flags in the binary position and implicit forms", () => {
		for (const argv of [
			[],
			["vitest"],
			["npx"],
			["npx", "--no", "--"],
			["npx", "--no"],
			["bun", "x", "--no-install"],
			["pnpm", "exec", ""],
			["pnpm", "vitest"],
			["yarn", "vitest"],
			["bun", "vitest"],
			["pnpm", "x", "vitest"],
		]) {
			assert.isTrue(Option.isNone(LocalExec.parse(argv)), argv.join(" "));
		}
	});

	it("the recognition table is longest-prefix first", () => {
		// Today the binary refusal rule (no leading "-") would rescue most order
		// mistakes on its own, because every longer prefix extends a shorter one
		// with a flag. The order is the contract regardless: a future alias whose
		// extra token is not a flag would be mis-parsed by a shorter row.
		for (let index = 1; index < PARSE_TABLE.length; index++) {
			const previous = PARSE_TABLE[index - 1]?.tokens.length ?? 0;
			const current = PARSE_TABLE[index]?.tokens.length ?? 0;
			assert.isAtLeast(previous, current, `row ${index} is longer than row ${index - 1}`);
		}
		// Every canonical prefix and every alias is in the table exactly once.
		const keys = PARSE_TABLE.map((row) => row.tokens.join(" "));
		assert.strictEqual(new Set(keys).size, keys.length);
		assert.include(keys, "npx --no --");
		assert.include(keys, "npx --no");
		assert.include(keys, "npm exec --");
	});
});
