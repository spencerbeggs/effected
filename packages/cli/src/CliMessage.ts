import { Audience } from "@effected/env";
import { Console, Effect } from "effect";
import { CliTheme } from "./CliTheme.js";
import { Status } from "./Status.js";

/**
 * Options for {@link CliMessage.status}.
 *
 * @public
 */
export interface CliMessageOptions {
	/**
	 * Where the line goes. Defaults to stderr for a status whose rank is at or above `warning`'s in its
	 * vocabulary, stdout otherwise.
	 */
	readonly stream?: "stdout" | "stderr" | undefined;
}

/**
 * One-line status messages: a glyph and some text, themed for a person and plain for an agent.
 *
 * @remarks
 * Each line goes through `Console`, `log` for stdout and `error` for stderr, never through the logger, so no
 * log level can silence it. Only the glyph is painted; the text stays plain. An `agent` audience gets the glyph
 * and the text and never colour, even when the theme has colour. `success` and `info` go to stdout, `warning`
 * and `failure` to stderr.
 *
 * @public
 */
export class CliMessage {
	private constructor() {}

	/**
	 * Print a status line from a vocabulary.
	 *
	 * @remarks
	 * The stream defaults to stderr when the status ranks at or above `warning` in `vocab`, and stdout
	 * otherwise, so a custom status follows its own rank: a `timeout` ranked 85 goes to stderr.
	 *
	 * @param vocab - the vocabulary the status belongs to
	 * @param name - the status
	 * @param text - the text after the glyph
	 * @param options - the stream override
	 */
	static readonly status = <N extends string>(
		vocab: Status<N>,
		name: N,
		text: string,
		options?: CliMessageOptions,
	): Effect.Effect<void, never, CliTheme | Audience> =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			const audience = yield* Audience;
			const def = vocab.def(name);

			let line: string;
			if (audience.kind === "agent") {
				line = `${theme.glyphs.kind === "ascii" ? def.ascii : def.glyph} ${text}`;
			} else {
				line = theme.status(vocab, name, text);
			}

			// Every vocabulary is built from Status.core, so "warning" is always there; the cast only widens the name.
			const warning = (vocab as unknown as Status<"warning">).def("warning").rank;
			const stream = options?.stream ?? (def.rank >= warning ? "stderr" : "stdout");
			yield* stream === "stderr" ? Console.error(line) : Console.log(line);
		});

	/**
	 * A success line, on stdout.
	 *
	 * @param text - the text after the glyph
	 */
	static readonly success = (text: string): Effect.Effect<void, never, CliTheme | Audience> =>
		CliMessage.status(Status.core, "success", text);

	/**
	 * An informational line, on stdout.
	 *
	 * @param text - the text after the glyph
	 */
	static readonly info = (text: string): Effect.Effect<void, never, CliTheme | Audience> =>
		CliMessage.status(Status.core, "info", text);

	/**
	 * A warning line, on stderr.
	 *
	 * @param text - the text after the glyph
	 */
	static readonly warning = (text: string): Effect.Effect<void, never, CliTheme | Audience> =>
		CliMessage.status(Status.core, "warning", text);

	/**
	 * A failure line, on stderr.
	 *
	 * @param text - the text after the glyph
	 */
	static readonly failure = (text: string): Effect.Effect<void, never, CliTheme | Audience> =>
		CliMessage.status(Status.core, "failure", text);
}
