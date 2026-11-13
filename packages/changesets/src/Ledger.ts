import { Yaml } from "@effected/yaml";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { LedgerError } from "./errors.js";

/** `./`-less, `/`-separated, no trailing `/`: pnpm's `normalize_project_dir`. */
const normalizeDir = (dir: string): string => {
	let normalized = dir.replaceAll("\\", "/");
	while (normalized.startsWith("./")) normalized = normalized.slice(2);
	let end = normalized.length;
	while (end > 0 && normalized[end - 1] === "/") end--;
	return normalized.slice(0, end);
};

/**
 * One consumed release in the ledger: the package, the version it released,
 * the project directory, and the ids of the intent files that release
 * consumed.
 *
 * @public
 */
export class LedgerEntry extends Schema.Class<LedgerEntry>("LedgerEntry")({
	/** The package name; a scoped name keeps its `@scope/`. */
	name: Schema.String,
	/** The released version, the part of the ledger key after its last `@`. */
	version: Schema.String,
	/**
	 * The released project's workspace-relative directory as recorded, the
	 * engine's unit of identity. Absent on an entry written as a bare list of
	 * ids, which names no directory.
	 */
	dir: Schema.optionalKey(Schema.String),
	/** The ids (file names without `.md`) of the intents the release consumed. */
	intents: Schema.Array(Schema.String),
}) {}

/**
 * Split `name@version` on the LAST `@` after position 0, as pnpm's
 * `split_ledger_key` does, so a scoped name keeps its leading `@`.
 */
const splitKey = (key: string): Option.Option<readonly [string, string]> => {
	const at = key.lastIndexOf("@");
	return at > 0 ? Option.some([key.slice(0, at), key.slice(at + 1)] as const) : Option.none();
};

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const invalid = (key: string, why: string): LedgerError =>
	new LedgerError({ code: "invalid-entry", detail: `${key}: ${why}` });

const toEntry = (
	key: string,
	name: string,
	version: string,
	value: unknown,
): Result.Result<LedgerEntry, LedgerError> => {
	// A bare `pkg@1.0.0:` key is YAML null; pnpm reads it as an empty id list.
	if (value === null || value === undefined) return Result.succeed(LedgerEntry.make({ name, version, intents: [] }));
	if (Array.isArray(value)) {
		return isStringArray(value)
			? Result.succeed(LedgerEntry.make({ name, version, intents: [...value] }))
			: Result.fail(invalid(key, "an intent id list must hold strings"));
	}
	if (!isRecord(value)) return Result.fail(invalid(key, "an entry is a list of intent ids or a dir/intents mapping"));
	// Own-property reads only: a parsed mapping may carry any key, `constructor` included.
	const dir = Object.hasOwn(value, "dir") ? value.dir : undefined;
	if (typeof dir !== "string") return Result.fail(invalid(key, 'a mapping entry needs a string "dir"'));
	const intents = Object.hasOwn(value, "intents") ? value.intents : undefined;
	if (intents !== null && intents !== undefined && !isStringArray(intents)) {
		return Result.fail(invalid(key, '"intents" must be a list of strings'));
	}
	return Result.succeed(
		LedgerEntry.make({ name, version, dir, intents: intents === null || intents === undefined ? [] : [...intents] }),
	);
};

/**
 * The decoded `.changeset/ledger.yaml`: pnpm's committed, append-only record
 * of which intent files each release consumed.
 *
 * @remarks
 * pnpm does not delete an intent file when a release consumes it. The file
 * stays until every project it names has released, so whether an intent is
 * still pending is a per-project question: an intent is pending for a project
 * exactly when no ledger entry for that project lists its id. Entries are
 * matched to a project by `dir` (the engine's unit of identity, since package
 * names may collide across projects), and an entry written as a bare id list
 * carries no `dir` and is matched by name. The file maps
 * `<name>@<version>` to `{ dir, intents }` or to a bare list of ids; a key
 * with no `@` after its first character is skipped, as pnpm skips it.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect";
 * import { Ledger } from "@effected/changesets";
 *
 * // `FileSystem` and `Path` come from the platform layer at the edge.
 * const program = Ledger.read("/repo").pipe(
 * 	Effect.map(Option.map((ledger) => ledger.consumed("calm-cats-resolve", "@example/core"))),
 * );
 * ```
 *
 * @public
 */
export class Ledger extends Schema.Class<Ledger>("Ledger")({
	/** Every release the ledger records, in file order. */
	entries: Schema.Array(LedgerEntry),
}) {
	/**
	 * Parse the text of a ledger. A blank file is an empty ledger. Fails with
	 * {@link LedgerError} on text that is not YAML, a document that is not a
	 * mapping, or an entry of the wrong shape; never throws.
	 *
	 * @param text - The contents of `.changeset/ledger.yaml`.
	 */
	static parseResult(text: string): Result.Result<Ledger, LedgerError> {
		if (text.trim() === "") return Result.succeed(Ledger.make({ entries: [] }));
		const parsed = Yaml.parseResult(text);
		if (Result.isFailure(parsed)) {
			return Result.fail(new LedgerError({ code: "invalid-yaml", detail: parsed.failure.message }));
		}
		const document = parsed.success;
		if (document === null || document === undefined) return Result.succeed(Ledger.make({ entries: [] }));
		if (!isRecord(document)) {
			return Result.fail(
				new LedgerError({ code: "not-a-mapping", detail: "the ledger must map name@version to a release" }),
			);
		}
		const entries: Array<LedgerEntry> = [];
		for (const [key, value] of Object.entries(document)) {
			const split = splitKey(key);
			if (Option.isNone(split)) continue;
			const entry = toEntry(key, split.value[0], split.value[1], value);
			if (Result.isFailure(entry)) return Result.fail(entry.failure);
			entries.push(entry.success);
		}
		return Result.succeed(Ledger.make({ entries }));
	}

	/**
	 * Read `<root>/.changeset/ledger.yaml`: `Option.none()` when the file does
	 * not exist, which is the state of a repository pnpm has not yet released.
	 *
	 * Fails with {@link LedgerError} when the file is malformed.
	 *
	 * @param root - The repository root.
	 */
	static readonly read = Effect.fn("Ledger.read")(function* (root: string) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const text = yield* fs.readFileString(path.join(root, ".changeset", "ledger.yaml")).pipe(
			Effect.map(Option.some),
			Effect.catch(
				(error): Effect.Effect<Option.Option<string>, PlatformError.PlatformError> =>
					error.reason._tag === "NotFound" ? Effect.succeed(Option.none()) : Effect.fail(error),
			),
		);
		if (Option.isNone(text)) return Option.none<Ledger>();
		return Option.some(yield* Effect.fromResult(Ledger.parseResult(text.value)));
	});

	/**
	 * Whether a release of the package called `name` consumed the intent with
	 * id `intent`. Matches by name alone, so for two projects that share a name
	 * it answers for either; {@link Ledger.consumedDir} tells them apart.
	 *
	 * @param intent - The intent id: the file name without `.md`.
	 * @param name - The package name.
	 */
	consumed(intent: string, name: string): boolean {
		return this.entries.some((entry) => entry.name === name && entry.intents.includes(intent));
	}

	/**
	 * Whether a release of the project in `dir` consumed the intent. `dir` is
	 * normalised as pnpm normalises it (backslashes to `/`, leading `./` and
	 * trailing `/` removed). An entry with no recorded `dir` never matches.
	 *
	 * @param intent - The intent id: the file name without `.md`.
	 * @param dir - The project's workspace-relative directory.
	 */
	consumedDir(intent: string, dir: string): boolean {
		const wanted = normalizeDir(dir);
		return this.entries.some(
			(entry) => entry.dir !== undefined && normalizeDir(entry.dir) === wanted && entry.intents.includes(intent),
		);
	}
}
