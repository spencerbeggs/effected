// Confinement of an untrusted relative path to a base directory — walker's
// third concept module, and its one pure one.
//
// An archive manifest, a tarball entry or a release-asset name says where a
// file goes; the caller must never write or read outside its own directory
// because of what that name says. The check is lexical and IO-free, so it
// ships as a `Result` primitive with an `Effect` twin derived from it (the
// sync-primitive policy): a synchronous extractor needs no runtime to call it.

import { Effect, Result, Schema } from "effect";
import { resolveSegments } from "./internal/segments.js";

/**
 * Why {@link confineRelativeResult} refused a candidate path.
 *
 * @remarks
 * - `nulByte` — the candidate holds a NUL character, which no filesystem
 *   path can carry and which some APIs truncate at.
 * - `absolute` — the candidate is rooted: a leading `/` or `\` (which covers
 *   UNC `\\server\share` and `//server/share`), or a win32 drive prefix such
 *   as `C:\x`, `C:/x` or the drive-relative `C:x`, before or after
 *   normalisation (`./C:/x` and `og/../C:x` are absolute too).
 * - `traversal` — after normalisation a `..` segment climbs above the base.
 * - `empty` — the candidate names the base itself: `""`, `.`, `./`, or a
 *   path such as `og/..` that normalises to nothing.
 * - `reservedName` — a normalised segment win32 reads as something other
 *   than a plain entry: one holding a `:` (a drive designator, or an NTFS
 *   alternate data stream such as `x::$DATA`), one made only of dots and
 *   spaces (`...`, `.. `, which win32 trims to nothing or to `..`), or a
 *   reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
 *   `LPT1`–`LPT9`), in any case and with or without an extension
 *   (`nul.txt`).
 *
 * @public
 */
export const PathEscapeReason = Schema.Literals(["nulByte", "absolute", "traversal", "empty", "reservedName"]);

/**
 * The decoded type of {@link (PathEscapeReason:variable)}.
 *
 * @public
 */
export type PathEscapeReason = typeof PathEscapeReason.Type;

/**
 * An untrusted relative path would leave, or does not name anything under,
 * the base directory it was confined to.
 *
 * @remarks
 * This is caller input, not a wiring defect: recover from it with
 * `Effect.catchTag("PathEscapeError", ...)`, typically by rejecting the
 * archive or manifest that named the path. The candidate is carried
 * verbatim, and the message renders it JSON-quoted so a control character
 * in it cannot forge a log line.
 *
 * @public
 */
export class PathEscapeError extends Schema.TaggedError<PathEscapeError>()("PathEscapeError", {
	/** The candidate path, exactly as the caller passed it. */
	candidate: Schema.String,
	/** Why the candidate was refused. */
	reason: PathEscapeReason,
}) {
	override get message(): string {
		return `the path ${JSON.stringify(this.candidate)} ${REASON_TEXT[this.reason]}`;
	}
}

/** The predicate of each refusal's message, after the quoted candidate. */
const REASON_TEXT: Readonly<Record<PathEscapeReason, string>> = {
	nulByte: "contains a NUL character",
	absolute: "is absolute, so it is not confined to the base directory",
	traversal: "climbs above the base directory",
	empty: "names the base directory itself, not an entry under it",
	reservedName: "has a segment win32 reserves or reads as something else",
};

/** A win32 drive prefix: `C:\x`, `C:/x`, and the drive-relative `C:x`. */
const DRIVE_PREFIX = /^[A-Za-z]:/;

/** A segment of dots and spaces only, which win32 trims to nothing or to `..`. */
const DOTS_AND_SPACES = /^[. ]+$/;

/** A win32 reserved device name, with or without an extension, in any case. */
const DEVICE_NAME =
	/^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$) *(?:\..*)?$/i;

/** Whether win32 reads a normalised segment as something other than a plain entry. */
const isReservedSegment = (segment: string): boolean =>
	segment.includes(":") || DOTS_AND_SPACES.test(segment) || DEVICE_NAME.test(segment);

/** `path` without trailing `/` or `\`: a loop, because `/[\\/]+$/` backtracks quadratically on a long separator run. */
const stripTrailingSeparators = (path: string): string => {
	let end = path.length;
	while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end -= 1;
	return path.slice(0, end);
};

/**
 * Confine an untrusted relative path to a base directory, synchronously.
 *
 * @remarks
 * The check is lexical and does no IO. Both `/` and `\` are separators,
 * whatever the platform, so a backslash variant of an escape is caught on
 * POSIX as well as on win32. In order, a candidate is refused when it holds
 * a NUL character, when it is absolute (POSIX `/x`, UNC `\\server\share`,
 * a win32 drive form such as `C:\x` or `C:x`), when a `..` segment climbs
 * above the base after normalisation (`og/../x` is fine, `og/../../x` is
 * not), or when it normalises to the base itself (`""`, `.`, `og/..`). The
 * last is a deliberate choice: a caller confining a path means to name an
 * entry under the base, and an archive entry naming its own root is malformed.
 * The normalised path is then checked again: a first segment with a drive
 * prefix is absolute (`./C:/x` would otherwise survive an empty base as
 * `C:/x`), and any segment win32 reserves (a `:`, dots and spaces only, a
 * device name such as `CON` or `nul.txt`) is refused as `reservedName`, on
 * every platform, so an archive that is safe on POSIX is safe on win32.
 *
 * No percent-decoding happens. `%2e%2e%2fx` is one ordinary file name, which
 * is exactly how a filesystem reads it, so it stays confined; a caller whose
 * input is URL-encoded decodes first and confines the decoded text.
 *
 * On success the result is the base joined with the normalised candidate:
 * `.` and empty segments dropped, `..` resolved, segments joined with `/`.
 * The base is kept verbatim apart from trailing separators, so a win32 base
 * yields `C:\out/og/x`, which every Node filesystem API accepts. An empty
 * base yields the normalised relative path alone. The check is lexical, not
 * physical, and symlinks are out of scope: a symlink already inside the
 * base can still point out of it, so a caller extracting into a directory
 * it does not own resolves links separately.
 *
 * {@link confineRelative} is defined in terms of this function and adds
 * only the tracing span.
 *
 * @example
 * ```ts
 * import { confineRelativeResult } from "@effected/walker";
 * import { Result } from "effect";
 *
 * const ok = confineRelativeResult("/srv/site", "og\\card.png");
 * // Result.succeed("/srv/site/og/card.png")
 * const bad = confineRelativeResult("/srv/site", "og/../../etc/passwd");
 * // Result.fail(PathEscapeError { reason: "traversal" })
 * if (Result.isFailure(bad)) console.error(bad.failure.message);
 * ```
 *
 * @param base - The directory the candidate must stay under.
 * @param candidate - The untrusted relative path.
 * @returns A `Result` succeeding with the joined path, or failing with
 * {@link PathEscapeError}.
 *
 * @public
 */
export const confineRelativeResult = (base: string, candidate: string): Result.Result<string, PathEscapeError> => {
	if (candidate.includes("\0")) return Result.fail(new PathEscapeError({ candidate, reason: "nulByte" }));
	const unified = candidate.replaceAll("\\", "/");
	if (unified.startsWith("/") || DRIVE_PREFIX.test(unified)) {
		return Result.fail(new PathEscapeError({ candidate, reason: "absolute" }));
	}
	const segments = resolveSegments(unified.split("/"));
	if (segments === undefined) return Result.fail(new PathEscapeError({ candidate, reason: "traversal" }));
	if (segments.length === 0) return Result.fail(new PathEscapeError({ candidate, reason: "empty" }));
	if (DRIVE_PREFIX.test(segments[0] ?? "")) return Result.fail(new PathEscapeError({ candidate, reason: "absolute" }));
	if (segments.some(isReservedSegment)) return Result.fail(new PathEscapeError({ candidate, reason: "reservedName" }));
	const relative = segments.join("/");
	return Result.succeed(base === "" ? relative : `${stripTrailingSeparators(base)}/${relative}`);
};

/**
 * Confine an untrusted relative path to a base directory.
 *
 * @remarks
 * Defined in terms of {@link confineRelativeResult}, whose remarks carry the
 * full contract; this form adds the `Walker.confineRelative` tracing span
 * and puts {@link PathEscapeError} on the error channel.
 *
 * @example
 * ```ts
 * import { confineRelative } from "@effected/walker";
 * import { Effect } from "effect";
 *
 * const target = confineRelative("/srv/site", "og/card.png").pipe(
 *   Effect.catchTag("PathEscapeError", (error) => Effect.die(error)),
 * );
 * ```
 *
 * @param base - The directory the candidate must stay under.
 * @param candidate - The untrusted relative path.
 * @returns An `Effect` succeeding with the joined path, or failing with
 * {@link PathEscapeError}.
 *
 * @public
 */
export const confineRelative: (base: string, candidate: string) => Effect.Effect<string, PathEscapeError> = Effect.fn(
	"Walker.confineRelative",
)((base: string, candidate: string) => Effect.fromResult(confineRelativeResult(base, candidate)));
