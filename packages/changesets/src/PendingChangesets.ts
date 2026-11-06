import { readFileSync, readdirSync } from "node:fs";
import { Effect, FileSystem, Path, PlatformError, Result, Schema } from "effect";
import { ReleaseType } from "./BumpType.js";
import { ChangesetFile } from "./ChangesetFile.js";
import { ChangesetParseError } from "./errors.js";

/**
 * One pending changeset read from `.changeset/`.
 *
 * @public
 */
export class PendingChangeset extends Schema.Class<PendingChangeset>("PendingChangeset")({
	/** The file name, relative to `.changeset/`. */
	file: Schema.String,
	/** Package name to requested release type, in file order. */
	releases: Schema.ReadonlyMap(Schema.String, ReleaseType),
	/** The markdown after the front matter. */
	summary: Schema.String,
}) {}

const CONTEXT_FILES: ReadonlySet<string> = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);

const isChangesetName = (name: string): boolean =>
	name.endsWith(".md") && !name.startsWith(".") && !/^README\.md$/i.test(name) && !CONTEXT_FILES.has(name);

const selectNames = (names: ReadonlyArray<string>): ReadonlyArray<string> => names.filter(isChangesetName).sort();

const withFile = (file: string, error: ChangesetParseError): ChangesetParseError =>
	new ChangesetParseError({ reason: error.reason, file, ...(error.line === undefined ? {} : { line: error.line }) });

const toPending = (file: string, text: string): Result.Result<PendingChangeset, ChangesetParseError> =>
	Result.match(ChangesetFile.parseSync(text), {
		onFailure: (error) => Result.fail(withFile(file, error)),
		onSuccess: (parsed) =>
			Result.succeed(PendingChangeset.make({ file, releases: parsed.releases, summary: parsed.summary })),
	});

const nodeErrorTag = (code: unknown): PlatformError.SystemErrorTag => {
	switch (code) {
		case "ENOENT":
			return "NotFound";
		case "EACCES":
		case "EPERM":
			return "PermissionDenied";
		case "EISDIR":
		case "ENOTDIR":
			return "BadResource";
		default:
			return "Unknown";
	}
};

const toPlatformError = (method: string, path: string, cause: unknown): PlatformError.PlatformError =>
	PlatformError.systemError({
		_tag: nodeErrorTag((cause as { code?: unknown } | null)?.code),
		module: "PendingChangesets",
		method,
		pathOrDescriptor: path,
		cause,
	});

const isNotFound = (error: PlatformError.PlatformError): boolean => error.reason._tag === "NotFound";

/**
 * Reading the pending changesets under a repository's `.changeset/`
 * directory.
 *
 * @public
 */
export class PendingChangesets {
	/**
	 * Read every pending changeset under `<root>/.changeset/`, ordered by file
	 * name. A readme in any case, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, dotfiles
	 * and non-`.md` files are skipped; a missing directory answers `[]`.
	 *
	 * @param root - The repository root.
	 */
	static readonly read = Effect.fn("PendingChangesets.read")(function* (root: string) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = path.join(root, ".changeset");
		const names = yield* fs
			.readDirectory(dir)
			.pipe(Effect.catch((error) => (isNotFound(error) ? Effect.succeed([] as Array<string>) : Effect.fail(error))));
		return yield* Effect.forEach(selectNames(names), (file) =>
			fs.readFileString(path.join(dir, file)).pipe(Effect.flatMap((text) => Effect.fromResult(toPending(file, text)))),
		);
	});

	/**
	 * Synchronous {@link PendingChangesets.read} over `node:fs`, for callers
	 * that run before any Effect runtime exists.
	 *
	 * @param root - The repository root.
	 */
	static readSync(
		root: string,
	): Result.Result<ReadonlyArray<PendingChangeset>, ChangesetParseError | PlatformError.PlatformError> {
		const dir = `${root.replace(/[\\/]+$/, "")}/.changeset`;
		let names: Array<string>;
		try {
			names = readdirSync(dir);
		} catch (cause) {
			const error = toPlatformError("readDirectory", dir, cause);
			return isNotFound(error) ? Result.succeed([]) : Result.fail(error);
		}
		const pending: Array<PendingChangeset> = [];
		for (const file of selectNames(names)) {
			let text: string;
			try {
				text = readFileSync(`${dir}/${file}`, "utf8");
			} catch (cause) {
				return Result.fail(toPlatformError("readFile", `${dir}/${file}`, cause));
			}
			const parsed = toPending(file, text);
			if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
			pending.push(parsed.success);
		}
		return Result.succeed(pending);
	}
}
