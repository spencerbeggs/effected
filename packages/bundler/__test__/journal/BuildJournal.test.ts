import { assert, describe, it } from "@effect/vitest";
import { JournalWatcher } from "@effected/jsonl";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Stream } from "effect";
import { BuildJournal, IssueJournal } from "../../src/journal/BuildJournal.js";
import type { BuildIssues, PlainDiagnostic } from "../../src/report/issues-artifact.js";

const ROOT = "/repo";
const BUILD_PATH = `${ROOT}/.cache/effected/build.jsonl`;
const ISSUE_PATH = `${ROOT}/.cache/effected/issues.jsonl`;

/** Watches that arm and never report: these suites only append and query. */
const idleWatcher = Layer.succeed(JournalWatcher, { watch: () => Effect.succeed(Stream.never) });

/** A fresh pair of journals over the root; every `Effect.provide` of it builds its own instances. */
const journalsAt = Layer.mergeAll(BuildJournal.layerAt(ROOT), IssueJournal.layerAt(ROOT));

const warning: PlainDiagnostic = { source: "tsdown", level: "warn", text: "a warning", code: "W1" };
const error: PlainDiagnostic = {
	source: "meta",
	level: "error",
	text: "an error",
	file: "src/a.ts",
	line: 3,
	column: 7,
};
const suppressed: PlainDiagnostic = {
	source: "api-extractor",
	level: "warn",
	text: "hidden",
	code: "ae-forgotten-export",
};

const issuesOf = (overrides: Partial<BuildIssues> = {}): BuildIssues => ({
	generatedAt: "2026-11-06T12:00:00.000Z",
	package: "@scope/a",
	target: "prod",
	buildOk: true,
	warnings: [],
	errors: [],
	suppressed: [],
	...overrides,
});

const volume = () => MemoryFileSystem.makeHandle({ [`${ROOT}/package.json`]: "{}" });

const textOf = (fs: { readonly volume: { readonly text: (path: string) => string | undefined } }, path: string) => {
	const text = fs.volume.text(path);
	assert.isDefined(text, `${path} was never created`);
	return text as string;
};

// biome-ignore lint/suspicious/noExplicitAny: a raw journal line, asserted on field by field
const linesOf = (fs: Parameters<typeof textOf>[0], path: string): ReadonlyArray<any> =>
	textOf(fs, path)
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line));

describe("BuildJournal.record", () => {
	it.effect("creates each journal and its missing parents, and writes one build line and one line per issue", () =>
		Effect.gen(function* () {
			const fs = yield* volume();
			assert.strictEqual(fs.volume.bytes(BUILD_PATH), undefined);
			assert.strictEqual(fs.volume.bytes(ISSUE_PATH), undefined);

			const issues = issuesOf({
				buildOk: false,
				failure: { name: "Error", message: "boom" },
				warnings: [warning, warning],
				errors: [error],
				suppressed: [suppressed],
			});
			yield* BuildJournal.record(issues, "/repo/packages/a").pipe(
				Effect.provide(journalsAt),
				Effect.provide(idleWatcher),
				Effect.provide(fs.layer),
			);

			const buildLines = linesOf(fs, BUILD_PATH);
			assert.strictEqual(buildLines.length, 1);
			assert.strictEqual(buildLines[0].event, "build");
			assert.strictEqual(buildLines[0].scope, "@scope/a");
			assert.deepStrictEqual(buildLines[0].data, {
				package: "@scope/a",
				cwd: "/repo/packages/a",
				generatedAt: "2026-11-06T12:00:00.000Z",
				buildOk: false,
				failure: { name: "Error", message: "boom" },
				errors: 1,
				warnings: 2,
				suppressed: 1,
				issuesPath: "/repo/packages/a/dist/prod/issues.json",
			});

			const issueLines = linesOf(fs, ISSUE_PATH);
			assert.strictEqual(issueLines.length, 3);
			assert.deepStrictEqual(
				issueLines.map((line) => [line.event, line.scope, line.data.level]),
				[
					["issue", "@scope/a", "error"],
					["issue", "@scope/a", "warn"],
					["issue", "@scope/a", "warn"],
				],
			);
			assert.deepStrictEqual(issueLines[0].data, {
				package: "@scope/a",
				generatedAt: "2026-11-06T12:00:00.000Z",
				source: "meta",
				level: "error",
				text: "an error",
				file: "src/a.ts",
				line: 3,
				column: 7,
			});
		}),
	);

	it.effect("a clean build leaves an envelope with no failure key and an empty issue journal", () =>
		Effect.gen(function* () {
			const fs = yield* volume();
			yield* BuildJournal.record(issuesOf({ suppressed: [suppressed] }), "/repo/packages/a").pipe(
				Effect.provide(journalsAt),
				Effect.provide(idleWatcher),
				Effect.provide(fs.layer),
			);

			const [line] = linesOf(fs, BUILD_PATH);
			assert.strictEqual(line.data.buildOk, true);
			assert.isFalse("failure" in line.data);
			assert.strictEqual(line.data.suppressed, 1);
			// The file exists, so a reader can tell "no issues" from "never recorded".
			assert.strictEqual(textOf(fs, ISSUE_PATH), "");
		}),
	);

	it.effect("two concurrent records through independent journal instances both land, and query by package", () =>
		Effect.gen(function* () {
			// memfs completes without suspending, so hand over at every open: one writer alone would run to its end.
			const fs = yield* MemoryFileSystem.makeHandle(
				{},
				{ faults: (base) => ({ open: (path, options) => Effect.andThen(Effect.yieldNow, base.open(path, options)) }) },
			);
			const a = issuesOf({ package: "@scope/a", warnings: Array.from({ length: 5 }, () => warning) });
			const b = issuesOf({ package: "@scope/b", errors: Array.from({ length: 5 }, () => error) });
			const recordIn = (issues: BuildIssues, cwd: string) =>
				BuildJournal.record(issues, cwd).pipe(Effect.provide(journalsAt), Effect.provide(fs.layer));

			yield* Effect.all([recordIn(a, "/repo/packages/a"), recordIn(b, "/repo/packages/b")], {
				concurrency: "unbounded",
				discard: true,
			});

			const pick = <A extends { readonly data: { readonly package: string } }>(stream: Stream.Stream<A, unknown>) =>
				stream.pipe(
					Stream.runCollect,
					Effect.map((envelopes) => Array.from(envelopes, (envelope) => envelope.data.package)),
				);
			const reader = Effect.gen(function* () {
				const builds = yield* BuildJournal;
				const issues = yield* IssueJournal;
				return {
					buildsA: yield* pick(builds.query({ scopes: ["@scope/a"] })),
					buildsB: yield* pick(builds.query({ scopes: ["@scope/b"] })),
					issuesA: yield* pick(issues.query({ scopes: ["@scope/a"] })),
					issuesB: yield* pick(issues.query({ scopes: ["@scope/b"] })),
				};
			}).pipe(Effect.provide(journalsAt), Effect.provide(fs.layer));
			const seen = yield* reader;

			assert.deepStrictEqual(seen.buildsA, ["@scope/a"]);
			assert.deepStrictEqual(seen.buildsB, ["@scope/b"]);
			assert.deepStrictEqual(
				seen.issuesA,
				Array.from({ length: 5 }, () => "@scope/a"),
			);
			assert.deepStrictEqual(
				seen.issuesB,
				Array.from({ length: 5 }, () => "@scope/b"),
			);
			// The positive control: the two writers really overlapped in the one file, so this is not two sequential runs.
			const order = linesOf(fs, ISSUE_PATH).map((line) => line.scope as string);
			assert.isFalse(order.join() === [...order].sort().join() || order.join() === [...order].sort().reverse().join());
		}).pipe(Effect.provide(idleWatcher)),
	);
});
