// A leading variable assignment of a simple command: the `FOO=1` in
// `FOO=1 git commit`.

import { Schema } from "effect";
import { removeContinuations } from "./internal/raw.js";
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
 * `raw` is the source text, backslash-newlines included; `joined` removes
 * them, as bash does before it reads a token.
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
}) {
	/**
	 * `raw` with its backslash-newlines removed, as bash removes them before
	 * it reads a token: `a\⏎[x]=1` is `a[x]=1`.
	 *
	 * @remarks
	 * The name, subscript and operator are joined throughout, and the value
	 * as {@link ShellWord.joined} joins it. Match a pattern against this,
	 * never against `raw`.
	 */
	get joined(): string {
		return removeContinuations(this.raw.slice(0, this.value.start - this.start)) + this.value.joined;
	}
}
