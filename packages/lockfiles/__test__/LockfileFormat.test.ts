import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Lockfile, LockfileParseError } from "../src/Lockfile.js";
import { LockfileFormat, filenameFor, filenamesFor, fromFilename } from "../src/LockfileFormat.js";

// A real yarn Berry lockfile: valid YAML, so every format's parser must reject
// it on shape rather than mis-normalize it.
const YARN_BERRY = [
	"__metadata:",
	"  version: 8",
	"  cacheKey: 10c0",
	"",
	'"lodash@npm:^4.17.21":',
	"  version: 4.17.21",
	'  resolution: "lodash@npm:4.17.21"',
	"  checksum: 10c0/d8cbea072bb08655bb4c989da418994b073a608dffa608b09ac04b43a791b12aeae7cd7ad919aa4c925f33b48490b5cfe6c1f71d827956071dae2e7bb3a6b74c",
	"  languageName: node",
	"  linkType: hard",
	"",
].join("\n");

describe("LockfileFormat", () => {
	it("names the three supported formats", () => {
		assert.deepStrictEqual([...LockfileFormat.literals], ["bun", "npm", "pnpm"]);
	});

	describe("refuses yarn.lock with a typed failure", () => {
		it("does not identify yarn.lock as a format", () => {
			assert.isTrue(Option.isNone(fromFilename("yarn.lock")));
		});

		for (const format of ["bun", "npm", "pnpm"] as const) {
			it.effect(`fails LockfileParseError when yarn content is parsed as ${format}`, () =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(Lockfile.parse(YARN_BERRY, { format }));
					assert.instanceOf(error, LockfileParseError);
					assert.strictEqual(error.format, format);
				}),
			);
		}
	});

	describe("filenameFor", () => {
		it("maps every format to its conventional filename", () => {
			assert.strictEqual(filenameFor("bun"), "bun.lock");
			assert.strictEqual(filenameFor("npm"), "package-lock.json");
			assert.strictEqual(filenameFor("pnpm"), "pnpm-lock.yaml");
		});
	});

	describe("filenamesFor", () => {
		it("pins the full table — genuine lockfile spellings only, primary first", () => {
			// npm honours npm-shrinkwrap.json; bun has shipped two formats (the
			// current text bun.lock and the older binary bun.lockb). Workspace-config
			// extras (pnpm-workspace.yaml, .pnpmfile.cjs) are a
			// consumer's cache policy and must never appear here.
			assert.deepStrictEqual(filenamesFor("bun"), ["bun.lock", "bun.lockb"]);
			assert.deepStrictEqual(filenamesFor("npm"), ["package-lock.json", "npm-shrinkwrap.json"]);
			assert.deepStrictEqual(filenamesFor("pnpm"), ["pnpm-lock.yaml"]);
		});

		it("keeps filenameFor as the first element for every format — one source of truth", () => {
			for (const format of LockfileFormat.literals) {
				assert.strictEqual(filenameFor(format), filenamesFor(format)[0]);
			}
		});
	});

	describe("fromFilename", () => {
		it("recognizes every conventional filename", () => {
			assert.deepStrictEqual(fromFilename("bun.lock"), Option.some("bun"));
			assert.deepStrictEqual(fromFilename("package-lock.json"), Option.some("npm"));
			assert.deepStrictEqual(fromFilename("pnpm-lock.yaml"), Option.some("pnpm"));
		});

		it("round-trips filenameFor for every format", () => {
			for (const format of LockfileFormat.literals) {
				assert.deepStrictEqual(fromFilename(filenameFor(format)), Option.some(format));
			}
		});

		it("returns none for unknown names, paths and near-misses", () => {
			assert.isTrue(Option.isNone(fromFilename("package.json")));
			// The filenamesFor alternates deliberately do not identify: bun.lockb is
			// a detection alternate, not a parse target (the format is binary).
			assert.isTrue(Option.isNone(fromFilename("bun.lockb")));
			assert.isTrue(Option.isNone(fromFilename("npm-shrinkwrap.json")));
			assert.isTrue(Option.isNone(fromFilename("some/dir/pnpm-lock.yaml")));
			assert.isTrue(Option.isNone(fromFilename("PNPM-LOCK.YAML")));
			assert.isTrue(Option.isNone(fromFilename("")));
		});
	});
});
