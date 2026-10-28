import type { SourcePosition } from "./SourcePosition.js";
import type { SourceRange } from "./SourceRange.js";

/**
 * Where something sits in a source text, said both ways: the
 * {@link SourceRange} (`offset`, `length`) and the {@link SourcePosition} of
 * its start (`line`, `character`, zero-based).
 *
 * @remarks
 * The positional core of every kit diagnostic. `JsoncParseErrorDetail`
 * satisfies it, and so do `YamlDiagnostic`, `TomlDiagnostic`,
 * `MarkdownDiagnostic` and `YamlToken`. {@link LineIndex.locationOf} builds
 * one from a range.
 *
 * @public
 */
export interface SourceLocation extends SourceRange, SourcePosition {}

/**
 * A diagnostic about a source text: a machine-readable `code`, a
 * human-readable `message`, and its {@link SourceLocation}.
 *
 * @remarks
 * A structural contract, not a base class. Each format package keeps its own
 * diagnostic class, its own `code` union and its own error types, which stay
 * part of that package's API; this interface only names the shape they
 * already share, so a consumer (an LSP server, a CLI printing annotations, a
 * lint host) can be written once over any of them. `YamlDiagnostic`,
 * `TomlDiagnostic` and `MarkdownDiagnostic` satisfy it as they stand.
 * `JsoncParseErrorDetail` carries no `message`, so it satisfies
 * {@link SourceLocation} only.
 *
 * `Code` narrows the code union for a consumer that knows which package the
 * diagnostic came from; the default accepts any.
 *
 * @typeParam Code - The diagnostic code union.
 *
 * @public
 */
export interface SourceDiagnostic<Code extends string = string> extends SourceLocation {
	/** The machine-readable diagnostic code. */
	readonly code: Code;
	/** The human-readable description. */
	readonly message: string;
}
