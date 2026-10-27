import type { Audience, TerminalEnv } from "@effected/env";
import { Console, Effect } from "effect";
import { Flag } from "effect/cli";
import type { CliLinks } from "./CliLinks.js";
import type { CliTheme } from "./CliTheme.js";
import type { Document } from "./Doc.js";
import { Doc } from "./Doc.js";
import { underGithubActions } from "./internal/autoFormat.js";
import { neutralizeJson } from "./internal/logSafety.js";

/**
 * An output format a `--format` flag can offer: `auto` (the renderer the audience gets, as `Doc.print` picks it),
 * one of the `Doc` renderers by name, or `json`, the command's data rather than its document.
 *
 * @public
 */
export type CliFormatName = "auto" | "plain" | "ansi" | "markdown" | "githubLog" | "json";

/**
 * Options for {@link CliFormat.flag}.
 *
 * @public
 */
export interface CliFormatFlagOptions<F extends CliFormatName> {
	/** The format when the flag is not given: `auto` when it is offered, otherwise the first one. */
	readonly default?: F | undefined;
	/** The flag's name; `format` by default. */
	readonly name?: string | undefined;
	/** The flag's description in help; one naming the offered formats by default. */
	readonly description?: string | undefined;
}

/**
 * What {@link CliFormat.print} prints: the command's document and, for `json`, its data.
 *
 * @public
 */
export interface CliFormatOutput {
	/** The document, built only when a document format is chosen. */
	readonly doc: () => Document;
	/** The data `json` prints, built only when `json` is chosen. A `json` format with no `json` here is a defect. */
	readonly json?: (() => unknown) | undefined;
}

/**
 * Options for {@link CliFormat.print}.
 *
 * @public
 */
export interface CliFormatPrintOptions {
	/** The stream to write to; stdout by default. */
	readonly stream?: "stdout" | "stderr" | undefined;
	/** The JSON indent, in spaces; `2` by default, `0` for one line. */
	readonly indent?: number | undefined;
}

/**
 * A `--format` flag and the one print that honours it, so a command builds its report once as a `Doc` and its data
 * once as a value, and never writes per-format output by hand.
 *
 * @remarks
 * The flag is core's `Flag.Literals` with the kit's names, default and description; the print hands every document
 * format to `Doc.print` and writes `json` itself.
 *
 * ```ts
 * const format = CliFormat.flag(["auto", "markdown", "json"])
 * const doctor = Command.make("doctor", { format }, ({ format }) =>
 *   CliFormat.print(format, { doc: () => report(results), json: () => results }),
 * )
 * ```
 *
 * @public
 */
export class CliFormat {
	private constructor() {}

	/**
	 * A `--format` flag offering `formats`.
	 *
	 * @remarks
	 * Its default is `options.default`, else `auto` when it is offered, else the first format. Any other value is a
	 * usage error from core's parser, naming the accepted ones.
	 *
	 * @param formats - the formats the command offers, at least one
	 * @param options - the default, the flag's name and its description
	 */
	static readonly flag = <const F extends CliFormatName>(
		formats: readonly [F, ...ReadonlyArray<F>],
		options?: CliFormatFlagOptions<F>,
	): Flag.Flag<F> => {
		const fallback: F = options?.default ?? (formats.includes("auto" as F) ? ("auto" as F) : formats[0]);
		return Flag.Literals(options?.name ?? "format", formats).pipe(
			Flag.withDefault(fallback),
			Flag.withDescription(options?.description ?? `Output format: ${formats.join(", ")} (default ${fallback})`),
		) as Flag.Flag<F>;
	};

	/**
	 * Print a command's output in `format`.
	 *
	 * @remarks
	 * `json` writes `output.json()` as JSON, one `Console.log` (or `Console.error` for stderr), indented by `indent`.
	 * Under GitHub Actions a `##[` inside it is written as the JSON escape `#\u0023[`, which decodes to the same text,
	 * so the runner cannot read it as a command. A value JSON cannot hold (a cycle, a bigint) is a defect. Every other
	 * format prints `output.doc()` with `Doc.print`, which renders it as `auto` or the named renderer would.
	 *
	 * @param format - the chosen format, usually the value of {@link CliFormat.flag}
	 * @param output - the document and the data
	 * @param options - the stream and the JSON indent
	 */
	static readonly print = (
		format: CliFormatName,
		output: CliFormatOutput,
		options?: CliFormatPrintOptions,
	): Effect.Effect<void, never, CliTheme | TerminalEnv | Audience | CliLinks> =>
		Effect.gen(function* () {
			const stream = options?.stream ?? "stdout";
			if (format !== "json") return yield* Doc.print(output.doc(), { stream, format });
			const data = output.json;
			if (data === undefined) {
				return yield* Effect.die(new Error("CliFormat.print: format json needs output.json"));
			}
			const text = yield* Effect.sync(() => JSON.stringify(data(), null, options?.indent ?? 2));
			if (text === undefined) return yield* Effect.die(new Error("CliFormat.print: output.json() is not JSON"));
			const safe = (yield* underGithubActions) ? neutralizeJson(text) : text;
			yield* stream === "stdout" ? Console.log(safe) : Console.error(safe);
		});
}
