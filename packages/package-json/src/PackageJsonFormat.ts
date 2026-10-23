// Decode-free canonical sort and format. Two entry points over the same
// ordering rules, carried as statics on `PackageJsonFormat`:
// `sortValue` for value→value hosts and `formatToString` for bytes→bytes
// hosts, mirroring the two shapes `sort-package-json` offers.
//
// The class shape and the `formatToString` name are the kit formatter
// convention, already spelled the same way by `JsoncFormatter`, `YamlFormat`
// and `TomlFormat` — a consumer who has met one kit formatter has met all
// four. `sortValue` carries the value→value shape that only this package
// needs.
//
// `parseObjectResult` / `parseObject` live here too: "is this text a JSON
// object at all?" is the syntactic precondition the formatter and the modifier
// already share, so the one primitive that answers it — with the typed
// `invalid-json` versus `not-an-object` split — belongs beside them rather than
// in a decode module. Other kit packages (`@effected/workspaces` above all)
// read package.json text through it instead of re-deriving the split.
//
// This is a capability distinct from `Package.toJsonString`, not a weakening of
// it — the strict path keeps its guarantees exactly, and a caller picks between
// them by name at the call site. Nothing here decodes, so nothing here can
// normalize: field encodings that the model would canonicalize (string-form
// `author` shorthand above all) survive untouched because they are never
// looked at.

import type { JsoncPath } from "@effected/jsonc";
import { JsoncEdit, JsoncModifier } from "@effected/jsonc";
import { Effect, Predicate, Result, Schema } from "effect";
import { detectIndent, renderJson, resolveIndent, sortKeys } from "./internal/format.js";

// The message of a preserved `cause`, when it carries one. A `Schema.Defect()`
// field holds whatever was thrown, so the read is guarded rather than assumed.
const causeMessage = (cause: unknown): string | undefined =>
	Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) && cause.message.length > 0
		? cause.message
		: undefined;

/**
 * Indicates that a text input could not be treated as a package.json document:
 * either it is not valid JSON (`"invalid-json"`, carrying the underlying
 * `SyntaxError` on `cause`) or it parsed to something other than a JSON object
 * (`"not-an-object"` — an array, a scalar or `null`).
 *
 * Raised by {@link PackageJsonFormat.parseObjectResult} and every text-path
 * static built on it. This is a *syntactic* failure only; it says nothing
 * about whether the document is a valid package manifest, which the
 * decode-free path deliberately does not check.
 *
 * @remarks
 * For `"invalid-json"` the message appends the `SyntaxError`'s own text, which
 * carries the JSON position (`"... at position 1 (line 1 column 2)"`).
 * Callers that splice this error's `message` into their own — `@effected/npm`'s
 * `CatalogAssemblyError` does — would otherwise lose the one detail that tells
 * a person where the file is broken.
 *
 * @public
 */
export class PackageJsonSyntaxError extends Schema.TaggedError<PackageJsonSyntaxError>()("PackageJsonSyntaxError", {
	/** Which syntactic precondition failed. */
	reason: Schema.Literals(["invalid-json", "not-an-object"]),
	/** The underlying `SyntaxError` for `"invalid-json"`, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const detail = causeMessage(this.cause);
		return this.reason === "not-an-object"
			? "package.json text is not a JSON object"
			: detail === undefined
				? "package.json text is not valid JSON"
				: `package.json text is not valid JSON: ${detail}`;
	}
}

/**
 * Options for {@link PackageJsonFormat.formatToString}.
 *
 * Deliberately not `PackageFormatOptions`: there is no `sourceText` member,
 * because the text being formatted *is* the source text, and the defaults for
 * `indent` and `stripEmpty` differ — see each member.
 *
 * @public
 */
export interface PackageFormatTextOptions {
	/**
	 * Indentation: a spaces count, `"tab"`, or `"preserve"`. Defaults to
	 * `"preserve"` — unlike `Package.toJsonString`, this path always has the
	 * original text in hand, and reformatting a file in place should not
	 * silently restyle its indentation.
	 */
	readonly indent?: number | "tab" | "preserve";
	/** Order top-level keys canonically and alphabetize dependency maps (default `true`). */
	readonly sort?: boolean;
	/**
	 * Strip dependency-map keys whose value is an empty object (default
	 * `false`). The strict path defaults this on because the model materializes
	 * absent maps as empty ones; here an empty map is a key the author actually
	 * wrote, and removing it would be a silent edit rather than a format.
	 */
	readonly stripEmpty?: boolean;
	/** Append a trailing newline (default `true`). */
	readonly newline?: boolean;
}

/**
 * Indicates that a surgical modification could not be applied, for one of two
 * reasons the `cause` tells apart:
 *
 * - **navigation** — the value on the path is not the container kind the next
 *   path segment requires. `cause` is `@effected/jsonc`'s
 *   `JsoncModificationError`, which names the expected container and the
 *   1-based depth of the mismatch.
 * - **serialization** — the value to write has no JSON representation (a
 *   `bigint`, a circular structure, or a function or symbol where a value is
 *   written). `cause` is `@effected/jsonc`'s `JsoncStringifyError`, whose
 *   `code` names the problem (`"BigIntValue"`, `"CircularReference"`, …).
 *
 * Either way the underlying error is preserved on the structured `cause`
 * field, never stringified, and the message appends its text.
 *
 * Raised by {@link PackageJsonFormat.modifyResult} and every modify static
 * built on it.
 *
 * @remarks
 * `JsoncStringifyError` carries no path of its own; `path` here is the path the
 * caller passed, so a serialization failure still says where it was being
 * written. Navigation runs first: a path that cannot be navigated reports the
 * navigation cause even when the value is also unserializable.
 *
 * @public
 */
export class PackageJsonModifyError extends Schema.TaggedError<PackageJsonModifyError>()("PackageJsonModifyError", {
	/** The field path that was being modified. */
	path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
	/** The underlying `JsoncModificationError` or `JsoncStringifyError`, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const detail = causeMessage(this.cause);
		const base = `Failed to modify package.json at path [${this.path.join(", ")}]`;
		return detail === undefined ? base : `${base}: ${detail}`;
	}
}

/**
 * Decode-free canonical sort and format statics. Not instantiable.
 *
 * @remarks
 * The guarantee both statics make is that they are **source-preserving**:
 * neither decodes into a `Package`, so neither can normalize a field encoding.
 * String-form `author` shorthand, unknown fields, unusual value shapes and
 * empty maps all survive untouched, because they are never looked at. Key
 * order, indentation and the trailing newline are the only things that change.
 *
 * That is what makes this usable as a lint-hook handler where the strict path
 * is not: any syntactically valid JSON object formats, including the
 * version-less workspace roots and `{"private": true}` manifests that
 * `Package.decode` rejects. Reach for `Package.decode` +
 * `Package.toJsonString` instead when the job needs the validated model and an
 * invalid manifest should fail loudly.
 *
 * @public
 */
export class PackageJsonFormat {
	private constructor() {}

	/**
	 * Parse package.json text into a plain JSON object, **without decoding it
	 * into a `Package`**, keeping the two syntactic failures apart: text that is
	 * not JSON at all fails `"invalid-json"` (the `SyntaxError` preserved on
	 * `cause`), and valid JSON that is not an object — `null`, an array, a
	 * number, a string, a boolean — fails `"not-an-object"`.
	 *
	 * The sync primitive behind {@link PackageJsonFormat.parseObject}, and the
	 * precondition every other text-path static here checks first.
	 *
	 * @remarks
	 * Reach for this, not a hand-written `JSON.parse`, whenever package.json text
	 * has to become an object. `JSON.parse` returns `null`, numbers and strings
	 * for *valid* input, so the common `=== undefined` or `typeof === "object"`
	 * guard after it lets `null` through, and the next property read throws a
	 * `TypeError` that escapes as a defect.
	 *
	 * Prefer it over `Schema.fromJsonString(...)` when the caller needs to tell
	 * "not JSON" from "wrong shape", or needs the JSON position: a schema decode
	 * separates the two only by an internal issue tag and reports bad JSON as
	 * `"Expected a valid JSON string"`, dropping the `SyntaxError` text.
	 *
	 * A `"__proto__"` key survives as an ordinary own data property, exactly as
	 * `JSON.parse` leaves it, so the result carries no prototype-pollution
	 * surface. Copy it with `obj[key] = value` and you add one.
	 *
	 * @param text - the package.json file contents
	 * @returns the parsed object, or a {@link PackageJsonSyntaxError}
	 *
	 * @example
	 * ```ts
	 * import { PackageJsonFormat } from "@effected/package-json";
	 * import { Result } from "effect";
	 *
	 * const parsed = PackageJsonFormat.parseObjectResult("null");
	 * if (Result.isFailure(parsed)) console.log(parsed.failure.reason);
	 * // => "not-an-object"
	 * ```
	 */
	static parseObjectResult(text: string): Result.Result<Record<string, unknown>, PackageJsonSyntaxError> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text) as unknown;
		} catch (cause) {
			return Result.fail(new PackageJsonSyntaxError({ reason: "invalid-json", cause }));
		}
		return Predicate.isObject(parsed)
			? Result.succeed(parsed as Record<string, unknown>)
			: Result.fail(new PackageJsonSyntaxError({ reason: "not-an-object" }));
	}

	/**
	 * Parse package.json text into a plain JSON object. The `Effect` form of
	 * {@link PackageJsonFormat.parseObjectResult}, adding the tracing span;
	 * synchronous callers use that instead.
	 *
	 * @param text - the package.json file contents
	 * @returns an Effect resolving to the parsed object, failing with
	 * {@link PackageJsonSyntaxError}
	 *
	 * @example
	 * ```ts
	 * import { PackageJsonFormat } from "@effected/package-json";
	 * import { Effect } from "effect";
	 *
	 * const program = PackageJsonFormat.parseObject('{"name": "p"}').pipe(
	 *   Effect.catchTag("PackageJsonSyntaxError", (error) => Effect.succeed({ reason: error.reason })),
	 * );
	 * ```
	 */
	static readonly parseObject = Effect.fn("PackageJsonFormat.parseObject")((text: string) =>
		Effect.fromResult(PackageJsonFormat.parseObjectResult(text)),
	);

	/**
	 * Order a package.json object's keys canonically **without decoding it into
	 * a `Package`**: known top-level keys in `sort-package-json`'s order, then
	 * unknown public keys alphabetically, then `_`-prefixed keys, with the
	 * dependency maps and `scripts` / `engines` / `bin` alphabetized.
	 *
	 * Value in, value out — for hosts that already hold parsed JSON and never
	 * want a string. {@link PackageJsonFormat.formatToString} is the same
	 * ordering for hosts holding file text. Pure and total.
	 *
	 * Returns a new object; nested values are shared by reference rather than
	 * cloned, except the maps whose own keys are reordered. A value that is not
	 * a JSON object (an array, a scalar, `null`) is returned unchanged rather
	 * than mangled, so a mistyped `Json` union cannot silently lose data.
	 *
	 * Reordering keys is the whole of it — **no key is ever added or removed**,
	 * which is what lets the return type be the input type `T` and makes this a
	 * drop-in. Use {@link PackageJsonFormat.formatToString} with `stripEmpty`
	 * when removing empty maps is wanted; it returns a string and so carries no
	 * such obligation.
	 *
	 * @param value - the parsed package.json object
	 * @returns a new object with canonically ordered keys
	 *
	 * @example
	 * ```ts
	 * import { PackageJsonFormat } from "@effected/package-json";
	 *
	 * const sorted = PackageJsonFormat.sortValue({ version: "1.0.0", name: "p" });
	 * // => { name: "p", version: "1.0.0" }
	 * ```
	 */
	static sortValue<T extends { readonly [k: string]: unknown }>(value: T): T {
		if (!Predicate.isObject(value)) return value;
		return sortKeys(value) as T;
	}

	/**
	 * Sort and format package.json text **without decoding it into a
	 * `Package`**. Text in, text out — for hosts that hold file contents and
	 * cannot afford a decode. {@link PackageJsonFormat.sortValue} is the same
	 * ordering for hosts that already hold parsed JSON.
	 *
	 * Any syntactically valid JSON object formats, whatever it contains: a
	 * version-less root, `{"private": true}`, a malformed `packageManager`
	 * integrity. Nothing is decoded, so nothing is normalized — string-form
	 * `author` shorthand, unknown fields, unusual value shapes and empty maps
	 * all survive byte-for-byte. Only key order, indentation and the trailing
	 * newline change.
	 *
	 * Pure and synchronous: it returns a `Result` rather than an `Effect`, so
	 * synchronous hosts can call it directly. Lift it with `Effect.fromResult`.
	 *
	 * @param source - the package.json file contents
	 * @param options - formatting options; see {@link PackageFormatTextOptions}
	 * @returns the formatted text, or a {@link PackageJsonSyntaxError}
	 *
	 * @example
	 * ```ts
	 * import { PackageJsonFormat } from "@effected/package-json";
	 * import { Effect, Result } from "effect";
	 *
	 * const formatted = PackageJsonFormat.formatToString('{"private": true}');
	 * if (Result.isSuccess(formatted)) console.log(formatted.success);
	 *
	 * // In an Effect program:
	 * const program = Effect.fromResult(PackageJsonFormat.formatToString('{"private": true}'));
	 * ```
	 */
	static formatToString(
		source: string,
		options?: PackageFormatTextOptions,
	): Result.Result<string, PackageJsonSyntaxError> {
		// Shares `sortKeys` with `sortValue` via `renderJson`, so the two entry
		// points cannot drift in ordering.
		return Result.map(PackageJsonFormat.parseObjectResult(source), (parsed) =>
			renderJson(parsed, {
				indent: resolveIndent(options?.indent ?? "preserve", source),
				sort: options?.sort ?? true,
				stripEmpty: options?.stripEmpty ?? false,
				newline: options?.newline ?? true,
			}),
		);
	}

	/**
	 * Compute the surgical edits that set, replace or delete the value at
	 * `path` **without decoding, sorting or reformatting anything else**. The
	 * opposite posture to {@link PackageJsonFormat.formatToString}: where the
	 * formatter's job is the canonical order, the mutator's job is to leave
	 * every untouched byte untouched — key order, indentation, line endings and
	 * the trailing newline all survive, because only the edited span changes.
	 * That is what makes the result reviewable when a tool commits a one-field
	 * change to someone else's repository.
	 *
	 * The sync primitive behind {@link PackageJsonFormat.modify}. Built on
	 * `@effected/jsonc`'s scanner-based edit engine. Inserted content matches the
	 * source's own style: indentation (tab vs N spaces) is detected from the
	 * first indented line and the line ending from the first `\r\n`.
	 *
	 * Passing `value === undefined` deletes the target key (including its
	 * comma) — the `@effected/jsonc` / `@effected/yaml` modify convention. A
	 * missing insertion target appends after the last key of its container.
	 *
	 * @remarks
	 * Fails {@link PackageJsonSyntaxError} when `source` is not a JSON object,
	 * and {@link PackageJsonModifyError} when the path cannot be navigated *or*
	 * the value cannot be serialized (a `bigint`, a circular structure, a
	 * function or symbol). Both jsonc failures are wrapped, with the original on
	 * `cause`, so this package's error surface stays its own.
	 *
	 * This and {@link PackageJsonFormat.modifyToStringResult} are the package's
	 * first `*Result`-suffixed statics. The older
	 * {@link PackageJsonFormat.formatToString} returns a `Result` with no
	 * suffix because it has no `Effect` twin; these two do, and follow the kit's
	 * sync-primitive naming.
	 *
	 * @param source - the package.json file contents (strict JSON — npm does
	 *   not accept comments, and neither does this)
	 * @param path - the field path, e.g. `["packageManager"]` or
	 *   `["devEngines", "runtime", "version"]`
	 * @param value - the plain JSON value to write, or `undefined` to delete
	 * @returns the edits to apply via `JsoncEdit.applyAll`, or the failure
	 *
	 * @example
	 * ```ts
	 * import { PackageJsonFormat } from "@effected/package-json";
	 * import { Result } from "effect";
	 *
	 * const edits = PackageJsonFormat.modifyResult('{"private": true}', ["private"], undefined);
	 * if (Result.isSuccess(edits)) console.log(edits.success.length); // => 1
	 * ```
	 */
	static modifyResult(
		source: string,
		path: JsoncPath,
		value: unknown,
	): Result.Result<ReadonlyArray<JsoncEdit>, PackageJsonSyntaxError | PackageJsonModifyError> {
		// package.json is strict JSON; a syntactic precondition keeps garbage
		// input a typed failure instead of undefined scanner behavior.
		return Result.flatMap(PackageJsonFormat.parseObjectResult(source), () => {
			const indent = detectIndent(source);
			const formattingOptions = {
				insertSpaces: indent !== "\t",
				tabSize: indent === undefined || indent === "\t" ? 2 : indent.length,
				eol: source.includes("\r\n") ? "\r\n" : "\n",
			};
			return Result.mapError(
				JsoncModifier.modifyResult(source, path, value, { formattingOptions }),
				// Both jsonc failures — JsoncModificationError (navigation) and
				// JsoncStringifyError (serialization) — become this package's error.
				(cause) => new PackageJsonModifyError({ path, cause }),
			);
		});
	}

	/**
	 * Compute the surgical edits that set, replace or delete the value at
	 * `path`. The `Effect` form of {@link PackageJsonFormat.modifyResult},
	 * adding the tracing span; see it for the full contract and the error
	 * channel.
	 *
	 * @param source - the package.json file contents (strict JSON)
	 * @param path - the field path, e.g. `["packageManager"]`
	 * @param value - the plain JSON value to write, or `undefined` to delete
	 * @returns the edits to apply via `JsoncEdit.applyAll` — or use
	 *   {@link PackageJsonFormat.modifyToString} for the applied text in one step
	 */
	static readonly modify = Effect.fn("PackageJsonFormat.modify")((source: string, path: JsoncPath, value: unknown) =>
		Effect.fromResult(PackageJsonFormat.modifyResult(source, path, value)),
	);

	/**
	 * Modify `source` and apply the resulting edits in one step
	 * (`JsoncEdit.applyAll` composed over
	 * {@link PackageJsonFormat.modifyResult}). Text in, text out; every byte
	 * outside the edited span is preserved. The sync primitive behind
	 * {@link PackageJsonFormat.modifyToString}, with the same error channel as
	 * `modifyResult`.
	 *
	 * @param source - the package.json file contents (strict JSON)
	 * @param path - the field path, e.g. `["packageManager"]`
	 * @param value - the plain JSON value to write, or `undefined` to delete
	 * @returns the modified text, or the failure
	 *
	 * @example
	 * ```ts
	 * import { PackageJsonFormat } from "@effected/package-json";
	 * import { Result } from "effect";
	 *
	 * const text = PackageJsonFormat.modifyToStringResult('{\n  "private": true\n}\n', ["private"], false);
	 * if (Result.isSuccess(text)) console.log(text.success);
	 * // => '{\n  "private": false\n}\n'
	 * ```
	 */
	static modifyToStringResult(
		source: string,
		path: JsoncPath,
		value: unknown,
	): Result.Result<string, PackageJsonSyntaxError | PackageJsonModifyError> {
		return Result.map(PackageJsonFormat.modifyResult(source, path, value), (edits) =>
			JsoncEdit.applyAll(source, edits),
		);
	}

	/**
	 * Modify `source` and apply the resulting edits in one step. The `Effect`
	 * form of {@link PackageJsonFormat.modifyToStringResult}, adding the
	 * tracing span. Inherits the modify error channel:
	 * {@link PackageJsonSyntaxError} when the source is not a JSON object,
	 * {@link PackageJsonModifyError} when the path cannot be navigated or the
	 * value cannot be serialized.
	 *
	 * @example
	 * ```ts
	 * import { PackageJsonFormat } from "@effected/package-json";
	 * import { Effect } from "effect";
	 *
	 * const program = PackageJsonFormat.modifyToString(
	 *   '{\n  "private": true,\n  "packageManager": "pnpm@11.2.0"\n}\n',
	 *   ["packageManager"],
	 *   "pnpm@11.3.0",
	 * ); // only the packageManager value changes; every other byte survives
	 * ```
	 */
	static readonly modifyToString = Effect.fn("PackageJsonFormat.modifyToString")(
		(source: string, path: JsoncPath, value: unknown) =>
			Effect.fromResult(PackageJsonFormat.modifyToStringResult(source, path, value)),
	);
}
