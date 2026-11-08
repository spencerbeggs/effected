/**
 * A tolerant shell-syntax lexer and segmenter for guards and agent tooling:
 * which simple commands an untrusted command string would run, with which
 * words, never evaluated and never failing.
 *
 * @packageDocumentation
 */

export { ShellAssignment } from "./ShellAssignment.js";
export { ShellCommand } from "./ShellCommand.js";
export { ShellComment } from "./ShellComment.js";
export { ShellDiagnostic, ShellDiagnosticCode } from "./ShellDiagnostic.js";
export { ShellHeredoc } from "./ShellHeredoc.js";
export { ShellRedirection, ShellRedirectionOperator } from "./ShellRedirection.js";
export { ShellCommandWalk, ShellNestedScript, ShellScript, ShellTruncation } from "./ShellScript.js";
export { ShellOperator, ShellSegment } from "./ShellSegment.js";
export { ShellSyntax } from "./ShellSyntax.js";
export { ShellWord } from "./ShellWord.js";
export {
	ShellAnsiCPart,
	ShellArithmeticPart,
	ShellBarePart,
	ShellBracePart,
	ShellCommandSubstitutionPart,
	ShellDoubleQuotedPart,
	ShellExpansionPart,
	ShellGlobPart,
	ShellOpaquePart,
	ShellProcessSubstitutionPart,
	ShellSingleQuotedPart,
	ShellSubstitutionPart,
	ShellTildePart,
	ShellVariablePart,
	ShellWordPart,
} from "./ShellWordPart.js";
