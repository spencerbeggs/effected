// A `#` comment: never a word, never an argument.

import { Schema } from "effect";

/**
 * A comment, from an unquoted `#` at the start of a word to the end of its
 * line.
 *
 * @remarks
 * `text` is everything after the `#`, excluding the line break. A `#` inside
 * a word (`a#b`) is ordinary text, as in bash.
 *
 * @public
 */
export class ShellComment extends Schema.Class<ShellComment>("ShellComment")({
	text: Schema.String,
	start: Schema.Number,
	end: Schema.Number,
}) {}
