import { Yaml } from "@effected/yaml";
import { Effect } from "effect";
import type { ParseFailure } from "./shared.js";
import { framingFailure, syntaxFailure } from "./shared.js";

/**
 * A document selected out of a YAML stream, with the stream's document count
 * carried alongside so a framing failure can report it.
 *
 * @internal
 */
export interface SelectedDocument {
	readonly document: unknown;
	readonly documents: number;
}

/**
 * An empty YAML document composes to `null` (`Yaml.parseAll("")` is `[null]`,
 * and the trailing document of an env-only `pnpm-lock.yaml` is `null` too).
 * A *present* scalar — `42` — is not empty; it is a shape error, and must
 * reach validation rather than be reported as a framing failure.
 *
 * @internal
 */
const isEmptyDocument = (document: unknown): boolean => document === null || document === undefined;

/**
 * Select the lockfile document from a `pnpm-lock.yaml` YAML stream.
 *
 * @remarks
 * pnpm 11 writes `pnpm-lock.yaml` as **up to two YAML documents** when the
 * workspace uses `configDependencies`: an optional config-dependencies
 * ("env") preamble, then the lockfile proper. The rule for picking the right
 * one is **deterministic, not a heuristic** — it is pnpm's own writer
 * contract. `writeEnvLockfile` emits `${env}---${main}`, composing the
 * preamble as a *prefix*, and `extractMainDocument` reads back everything
 * after the first separator. So the preamble is always first and the lockfile
 * is always **last**.
 *
 * Both documents declare `lockfileVersion`, `importers` and `packages`, so
 * they are not told apart by which keys they carry — only by position. That
 * is exactly why the previous single-document assumption failed *silently*:
 * the preamble validates against the pnpm schema, yielding a `Lockfile`
 * reporting one package and an empty workspace instead of an error.
 *
 * An env-only lockfile (`---` preamble `---` and nothing after it, which
 * pnpm writes when there is no main lockfile yet) has an **empty** trailing
 * document. pnpm reads that as "no lockfile"; so do we, through the typed
 * framing failure — never by silently falling back to the preamble.
 *
 * It takes the last document of a stream of **any** count and never fails
 * with `unexpectedDocuments`; only {@link selectPnpmEnvDocument}, the env
 * reader's selector, enforces the at-most-two limit.
 *
 * @internal
 */
export const selectPnpmDocument = (content: string): Effect.Effect<SelectedDocument, ParseFailure> =>
	Effect.gen(function* () {
		const documents = yield* Yaml.parseAll(content).pipe(Effect.mapError(syntaxFailure));
		const document = documents.at(-1);
		if (documents.length === 0 || isEmptyDocument(document)) {
			return yield* Effect.fail(framingFailure("noLockfileDocument", documents.length));
		}
		return { document, documents: documents.length };
	});

/**
 * Select the sole document of a YAML lockfile format that defines **no**
 * document framing — yarn Berry's `yarn.lock`.
 *
 * @remarks
 * yarn never writes a multi-document `yarn.lock`, so there is no writer
 * contract to read a "main" document out of one. Rather than silently taking
 * the first document (which is what a single-document parse does, and how the
 * pnpm bug stayed invisible), a stream carrying more than one document fails
 * through the typed framing channel: we refuse to guess where the format
 * defines no rule.
 *
 * @internal
 */
export const selectSoleDocument = (content: string): Effect.Effect<SelectedDocument, ParseFailure> =>
	Effect.gen(function* () {
		const documents = yield* Yaml.parseAll(content).pipe(Effect.mapError(syntaxFailure));
		if (documents.length > 1) {
			return yield* Effect.fail(framingFailure("unexpectedDocuments", documents.length));
		}
		const document = documents.at(0);
		if (documents.length === 0 || isEmptyDocument(document)) {
			return yield* Effect.fail(framingFailure("noLockfileDocument", documents.length));
		}
		return { document, documents: documents.length };
	});

/**
 * The number of documents pnpm's env-lockfile writer can compose: the env
 * preamble and the main lockfile. See {@link selectPnpmEnvDocument}.
 *
 * @internal
 */
const MAX_PNPM_DOCUMENTS = 2;

/**
 * Select the env ("preamble") document from a `pnpm-lock.yaml` YAML stream,
 * or `undefined` when the stream carries none.
 *
 * @remarks
 * The same position rule as {@link selectPnpmDocument}, read from the other
 * end: pnpm's `writeEnvLockfile` composes `${env}---${main}`, so the preamble
 * is the **first** of exactly two documents. A single-document stream has no
 * preamble — that is how pnpm writes a lockfile for a workspace that declares
 * neither `configDependencies` nor `devEngines.packageManager` — and neither
 * does an empty one. An empty first document is no preamble either: there is
 * nothing in it to read.
 *
 * A stream carrying **more** than two documents is outside the writer
 * contract, so no position identifies the preamble in it. Rather than guess —
 * this selection feeds integrity verification, where a guess is a trust
 * decision — it fails through the typed framing channel. That limit is this
 * selector's alone: {@link selectPnpmDocument}, behind `Lockfile.parse`, takes
 * the last document of a stream of any count.
 *
 * @internal
 */
export const selectPnpmEnvDocument = (content: string): Effect.Effect<SelectedDocument | undefined, ParseFailure> =>
	Effect.gen(function* () {
		const documents = yield* Yaml.parseAll(content).pipe(Effect.mapError(syntaxFailure));
		if (documents.length > MAX_PNPM_DOCUMENTS) {
			return yield* Effect.fail(framingFailure("unexpectedDocuments", documents.length));
		}
		if (documents.length < MAX_PNPM_DOCUMENTS) return undefined;
		const document = documents.at(0);
		if (isEmptyDocument(document)) return undefined;
		return { document, documents: documents.length };
	});
