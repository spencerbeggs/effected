/**
 * Full-fidelity glob matching as Effect schemas: the complete minimatch
 * dialect — extglobs, braces, character classes including POSIX classes, true
 * globstar, negation — compiled to pure string predicates, hardened against
 * hostile input, with zero runtime dependencies. Beside it, `Wildcard`: `*`
 * and `?` matching with no separator semantics, which is not a glob dialect.
 *
 * @packageDocumentation
 */

export type { EnumerationRoot } from "./GlobPattern.js";
export { GlobPattern, GlobPatternError, GlobPatternOptions } from "./GlobPattern.js";
export { GlobSet } from "./GlobSet.js";
export { Wildcard, WildcardOptions } from "./Wildcard.js";
