// A leading variable assignment of a simple command: the `FOO=1` in
// `FOO=1 git commit`.

import { Schema } from "effect";
import { ShellWord } from "./ShellWord.js";
import { ShellSubstitutionPart } from "./ShellWordPart.js";

/**
 * A `NAME=value` or `NAME+=value` prefix of a simple command.
 *
 * @remarks
 * Only the words before the command name are assignments; a `FOO=1` after
 * it is an ordinary argument. `name` includes any array subscript
 * (`arr[0]`), which is read as bash reads it: a matched `[ … ]` holding
 * spaces, newlines, `#` or `<<` as plain text. `subscript` lists the command
 * and process substitutions inside it (`arr[$(cmd)]=1`), which
 * `ShellScript.substitutions` reaches. `value` is the word after `=`, lexed as
 * bash lexes an assignment value: no pathname or brace expansion, and a tilde after `=` or
 * `:` is marked. An empty value is an empty word whose `literal` is
 * `Some("")`. An array value, `arr=(a b)`, is one `opaque` part.
 *
 * @public
 */
export class ShellAssignment extends Schema.Class<ShellAssignment>("ShellAssignment")({
	name: Schema.String,
	append: Schema.Boolean,
	value: ShellWord,
	subscript: Schema.Array(ShellSubstitutionPart),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
}) {}
