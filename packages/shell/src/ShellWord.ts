// A shell word: the source span of one argument, its parts with their
// quoting provenance, and the literal the shell would pass when there is one.

import { Option, Schema } from "effect";
import { ShellWordPart } from "./ShellWordPart.js";

/**
 * One word of a command line, as written.
 *
 * @remarks
 * `raw` is the source slice `[start, end)`; `parts` record how each piece of
 * it is quoted or expanded. `literal` is what the shell would pass for the
 * word, and is read only when nothing in it would be expanded.
 *
 * This is deliberately not core `CommandLine`'s word type: analyzer output
 * describes untrusted text and must not be handed straight to a spawner.
 * Anything to run goes through `CommandLine` after validation.
 *
 * @public
 */
export class ShellWord extends Schema.Class<ShellWord>("ShellWord")({
	kind: Schema.tag("word"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	parts: Schema.Array(ShellWordPart),
}) {
	/**
	 * The word's value after quote removal, when it contains no expansion.
	 *
	 * @remarks
	 * `Some` only when every part is `bare`, `singleQuoted`, `ansiC`, or
	 * `doubleQuoted` with no expansions, so a guard can compare it with
	 * `"git"` safely: the shell would pass exactly this string. Any variable,
	 * substitution, glob, brace, tilde or opaque part makes it `None`, because
	 * the shell would rewrite the word before the command saw it. ANSI-C
	 * escapes are decoded.
	 */
	get literal(): Option.Option<string> {
		let value = "";
		for (const part of this.parts) {
			switch (part.kind) {
				case "bare":
				case "singleQuoted":
				case "ansiC":
					value += part.value;
					break;
				case "doubleQuoted":
					if (part.expansions.length > 0) return Option.none();
					value += part.value;
					break;
				default:
					return Option.none();
			}
		}
		return Option.some(value);
	}
}
