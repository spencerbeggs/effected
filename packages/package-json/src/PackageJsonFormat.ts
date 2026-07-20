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
// This is a capability distinct from `Package.toJsonString`, not a weakening of
// it — the strict path keeps its guarantees exactly, and a caller picks between
// them by name at the call site. Nothing here decodes, so nothing here can
// normalize: field encodings that the model would canonicalize (string-form
// `author` shorthand above all) survive untouched because they are never
// looked at.

import { Result, Schema } from "effect";
import { renderJson, resolveIndent, sortKeys } from "./internal/format.js";

/**
 * Indicates that a text input could not be treated as a package.json document:
 * either it is not valid JSON (`"invalid-json"`, carrying the underlying
 * `SyntaxError` on `cause`) or it parsed to something other than a JSON object
 * (`"not-an-object"` — an array, a scalar or `null`).
 *
 * Raised by {@link PackageJsonFormat.formatToString}. This is a *syntactic*
 * failure only; it says nothing about whether the document is a valid package
 * manifest, which the decode-free path deliberately does not check.
 *
 * @public
 */
export class PackageJsonSyntaxError extends Schema.TaggedErrorClass<PackageJsonSyntaxError>()(
	"PackageJsonSyntaxError",
	{
		/** Which syntactic precondition failed. */
		reason: Schema.Literals(["invalid-json", "not-an-object"]),
		/** The underlying `SyntaxError` for `"invalid-json"`, preserved structurally. */
		cause: Schema.optionalKey(Schema.Defect()),
	},
) {
	override get message(): string {
		return this.reason === "invalid-json"
			? "package.json text is not valid JSON"
			: "package.json text is not a JSON object";
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

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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
		if (!isJsonObject(value)) return value;
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
		let parsed: unknown;
		try {
			parsed = JSON.parse(source) as unknown;
		} catch (cause) {
			return Result.fail(new PackageJsonSyntaxError({ reason: "invalid-json", cause }));
		}
		if (!isJsonObject(parsed)) {
			return Result.fail(new PackageJsonSyntaxError({ reason: "not-an-object" }));
		}
		return Result.succeed(
			renderJson(parsed, {
				indent: resolveIndent(options?.indent ?? "preserve", source),
				sort: options?.sort ?? true,
				stripEmpty: options?.stripEmpty ?? false,
				newline: options?.newline ?? true,
			}),
		);
	}
}
