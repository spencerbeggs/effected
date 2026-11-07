// The two workspace journals every package build appends to. The per-package issues.json stays what a reader
// trusts for one package; these are the view a watcher reads, at one guessable path under the workspace root.

import { dirname, join } from "node:path";
import type { AppendError, JournalWatcher } from "@effected/jsonl";
import { Journal, JsonlEvent } from "@effected/jsonl";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { BuildIssuesSchema, PlainDiagnosticSchema } from "../report/issues-artifact.js";

/** Each journal's place under the workspace root. */
const BUILD_JOURNAL_PATH = ".cache/effected/build.jsonl";
const ISSUE_JOURNAL_PATH = ".cache/effected/issues.jsonl";

/**
 * A journal's directory, which appending never creates. The journal itself is created through its own `create`.
 */
const ensureDirectoryOf = (path: string): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(dirname(path), { recursive: true });
	});

/**
 * The per-diagnostic journal: one line per error and warning of a build, in that order, scoped by package name.
 * Suppressed diagnostics stay in `issues.json` and are counted on the build's line.
 *
 * @public
 */
export class IssueJournal extends Journal.Service<IssueJournal>()("effected/IssueJournal", {
	events: [
		JsonlEvent.make("issue", {
			data: Schema.Struct({
				package: Schema.String,
				generatedAt: Schema.String,
				...PlainDiagnosticSchema.fields,
			}),
		}),
	],
	config: { path: ISSUE_JOURNAL_PATH },
}) {
	/**
	 * The journal at `<root>/.cache/effected/issues.jsonl`, with its directory and file created.
	 *
	 * @remarks
	 * Every call is a fresh layer, and every build of one an independent journal: bind it to one const.
	 *
	 * @param root - The workspace root.
	 */
	static readonly layerAt = (
		root: string,
	): Layer.Layer<IssueJournal, PlatformError.PlatformError, FileSystem.FileSystem | JournalWatcher> => {
		const path = join(root, ISSUE_JOURNAL_PATH);
		return Layer.effect(
			IssueJournal,
			ensureDirectoryOf(path).pipe(
				Effect.andThen(IssueJournal.make({ path })),
				Effect.tap((journal) => journal.create),
			),
		);
	};
}

/**
 * The per-build journal: one line per finished build, scoped by package name.
 *
 * @public
 */
export class BuildJournal extends Journal.Service<BuildJournal>()("effected/BuildJournal", {
	events: [
		JsonlEvent.make("build", {
			data: Schema.Struct({
				package: Schema.String,
				cwd: Schema.String,
				generatedAt: Schema.String,
				buildOk: Schema.Boolean,
				failure: BuildIssuesSchema.fields.failure,
				errors: Schema.Number,
				warnings: Schema.Number,
				suppressed: Schema.Number,
				issuesPath: Schema.String,
			}),
		}),
	],
	config: { path: BUILD_JOURNAL_PATH },
}) {
	/**
	 * The journal at `<root>/.cache/effected/build.jsonl`, with its directory and file created.
	 *
	 * @remarks
	 * Every call is a fresh layer, and every build of one an independent journal: bind it to one const.
	 *
	 * @param root - The workspace root.
	 */
	static readonly layerAt = (
		root: string,
	): Layer.Layer<BuildJournal, PlatformError.PlatformError, FileSystem.FileSystem | JournalWatcher> => {
		const path = join(root, BUILD_JOURNAL_PATH);
		return Layer.effect(
			BuildJournal,
			ensureDirectoryOf(path).pipe(
				Effect.andThen(BuildJournal.make({ path })),
				Effect.tap((journal) => journal.create),
			),
		);
	};

	/**
	 * Appends one finished build: a line per error and warning, then the build's own line.
	 *
	 * @remarks
	 * The build's line goes last, so a watcher that sees it finds that build's issues already written. Each line's
	 * `scope` is the package name, which is what a read filters on. Parallel builds may record at once: each line is
	 * one `O_APPEND` write.
	 *
	 * @param issues - The build's `issues.json`.
	 * @param cwd - The package directory the artifact sits under.
	 */
	static readonly record: (
		issues: typeof BuildIssuesSchema.Type,
		cwd: string,
	) => Effect.Effect<void, AppendError, BuildJournal | IssueJournal> = Effect.fn("BuildJournal.record")(function* (
		issues: typeof BuildIssuesSchema.Type,
		cwd: string,
	) {
		const builds = yield* BuildJournal;
		const journal = yield* IssueJournal;
		const scope = { scope: issues.package };
		for (const diagnostic of [...issues.errors, ...issues.warnings]) {
			yield* journal.append(
				"issue",
				{ package: issues.package, generatedAt: issues.generatedAt, ...diagnostic },
				scope,
			);
		}
		yield* builds.append(
			"build",
			{
				package: issues.package,
				cwd,
				generatedAt: issues.generatedAt,
				buildOk: issues.buildOk,
				...(issues.failure !== undefined ? { failure: issues.failure } : {}),
				errors: issues.errors.length,
				warnings: issues.warnings.length,
				suppressed: issues.suppressed.length,
				issuesPath: join(cwd, "dist", issues.target, "issues.json"),
			},
			scope,
		);
	});
}
