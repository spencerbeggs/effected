// Physical containment of a path in a base directory: `confineRelative`'s
// symlink-aware sibling.
//
// `confineRelative` is lexical, so a link already inside the base can still
// carry a path out of it. This module resolves links — through core's
// `FileSystem.realPath`, or a caller-supplied synchronous port — and refuses a
// path whose real location lies outside the base's. The resolution rules live
// once, in `internal/upwardMachine.ts`; this module only maps the outcome.

import type { FileSystem, PlatformError } from "effect";
import { Effect, Option, Path, Result } from "effect";
import { PathEscapeError } from "./Confine.js";
import type { WalkerSyncOps } from "./DescendSync.js";
import { runUpward, runUpwardSync } from "./internal/upwardDrivers.js";
import type { ConfineRefusal } from "./internal/upwardMachine.js";
import { confineRealMachine } from "./internal/upwardMachine.js";

/** The typed error a refusal describes — the one conversion both forms share. */
const toResult = <C>(
	candidate: string,
	outcome: { readonly _tag: "Ok"; readonly value: string } | ConfineRefusal<C>,
): Result.Result<string, PathEscapeError> => {
	if (outcome._tag === "Ok") return Result.succeed(outcome.value);
	if (outcome._tag === "Unresolvable") {
		return Result.fail(new PathEscapeError({ candidate, reason: "unresolvable", cause: outcome.cause }));
	}
	return Result.fail(new PathEscapeError({ candidate, reason: outcome.reason }));
};

/**
 * Confine a path to a base directory PHYSICALLY: resolve links in both, and
 * succeed with the candidate's real path only when it lies strictly inside
 * the base's real path.
 *
 * @remarks
 * Reach for it where `confineRelative` stops: a link inside the base that
 * points out of it (a symlinked `dist`, a planted `node_modules` entry), an
 * absolute path an agent or a tool handed over, a `descend` match — a
 * matched link is answered even when its target lies outside `cwd`.
 *
 * The candidate may be absolute (checked as it is) or relative (taken
 * against `base`). It is resolved the way the operating system resolves it:
 * segment by segment, so a `..` after a link climbs out of the link's
 * TARGET — `base/link/../x` is outside when `link` points outside — rather
 * than being collapsed lexically first, as `path.resolve` and node's JS
 * `fs.realpath` would. A path, or the tail of one, that does not exist yet
 * is resolved lexically from its real existing ancestor, so a write target
 * can be checked before it is created — but only once absence is proved: a
 * segment whose real path is not found is checked again without following
 * links, because a dangling link is "not found" too, and a write through one
 * creates its target wherever it points. The base is resolved the same way.
 *
 * Refused, typed as {@link PathEscapeError}: a NUL character (`nulByte`);
 * the empty string or any path whose real location IS the base (`empty`,
 * the same ruling `confineRelative` makes — a caller confining a path names
 * an entry under the base); on win32 a drive-relative `C:x` or a driveless
 * rooted `\x`, which names the current drive (`absolute`), or a segment
 * win32 reads as something else, such as a device name or `..  `
 * (`reservedName`); a real path outside the base's (`outside`); and a
 * resolution that fails for a reason other than absence, such as a
 * permission error, a link loop, or a dangling link — a link whose target
 * does not exist, refused even when that target would lie inside the base
 * (`unresolvable`, with the failure in `cause`) — containment that cannot be
 * verified is refused, never assumed.
 *
 * A relative `base` — the empty string included — is a **defect**: it would
 * be resolved against the process working directory, the silent wrong-root
 * walk `ascend` refuses for a relative `stopAt`. Absoluteness is judged by
 * the injected `Path`, so win32 accepts `C:\repo` and `\\server\share`;
 * a win32 `\repo`, rooted on whichever drive the process is on, is a defect
 * too.
 *
 * Use the returned path, not the candidate: it is the location that was
 * checked. Comparison is exact on the real paths, so on a case-insensitive
 * filesystem a base and a candidate spelled in different case may be refused
 * — the check fails closed. As with any check-then-use on a live filesystem,
 * a link swapped in between the check and the use is not covered.
 *
 * @example
 * ```ts
 * import { confineReal } from "@effected/walker";
 * import { Effect } from "effect";
 *
 * const target = confineReal("/repo", "packages/app/dist").pipe(
 *   Effect.catchTag("PathEscapeError", (error) => Effect.die(error)),
 * );
 * // Requires `FileSystem` and `Path` from the platform layer.
 * ```
 *
 * @param base - The absolute directory the candidate must stay under.
 * @param candidate - The path to check: absolute, or relative to `base`.
 * @returns An `Effect` succeeding with the candidate's real path, or failing
 * with {@link PathEscapeError}.
 *
 * @public
 */
export const confineReal: (
	base: string,
	candidate: string,
) => Effect.Effect<string, PathEscapeError, FileSystem.FileSystem | Path.Path> = Effect.fn("Walker.confineReal")(
	function* (base: string, candidate: string) {
		const path = yield* Path.Path;
		const outcome = yield* runUpward(
			confineRealMachine<PlatformError.PlatformError>("Walker.confineReal", base, candidate, path),
		);
		return yield* Effect.fromResult(toResult(candidate, outcome));
	},
);

/**
 * {@link confineReal}, synchronously, over a caller-supplied port.
 *
 * @remarks
 * The same resolution from the same code, through the port's `realPath`; a
 * `realPath` throwing `code: "ENOENT"` is absence only when the port's
 * `lstat` throws `ENOENT` too (otherwise a dangling link is there); anything
 * else is `unresolvable`, with the thrown value as the `cause`. A relative `base`
 * throws. For a caller with no Effect runtime; inside Effect, use
 * `confineReal`.
 *
 * @example
 * ```ts
 * import { confineRealSync } from "@effected/walker";
 * import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
 * import { Result } from "effect";
 *
 * const checked = confineRealSync("/repo", "/repo/packages/app/dist", nodeWalkerSyncOps);
 * if (Result.isFailure(checked)) console.error(checked.failure.message);
 * ```
 *
 * @param base - The absolute directory the candidate must stay under.
 * @param candidate - The path to check: absolute, or relative to `base`.
 * @param ops - The platform: spread or pass `nodeWalkerSyncOps`.
 * @returns A `Result` succeeding with the candidate's real path, or failing
 * with {@link PathEscapeError}.
 *
 * @public
 */
export const confineRealSync = (
	base: string,
	candidate: string,
	ops: WalkerSyncOps,
): Result.Result<string, PathEscapeError> =>
	toResult(
		candidate,
		runUpwardSync(confineRealMachine<unknown>("Walker.confineRealSync", base, candidate, ops.path), ops.fileSystem),
	);

/**
 * The posix, base-relative path of an absolute path that lies inside a base
 * directory PHYSICALLY, or `None` when it does not.
 *
 * @remarks
 * The question `confineReal` does not answer: where, under `base`, does this
 * absolute path sit? It resolves links the way `confineReal` does, and a path
 * or tail that does not exist yet is resolved lexically from its deepest
 * existing ancestor, so a destination can be placed before it is created.
 * The base itself answers `""`. `None` covers every refusal: a relative or
 * NUL-bearing candidate, a real location outside the base, and a resolution
 * that cannot be verified (a permission error, a loop, a dangling link) —
 * containment that cannot be proved is never assumed. A relative `base` is a
 * **defect**, as it is for `confineReal`.
 *
 * @example
 * ```ts
 * import { relativeWithin } from "@effected/walker";
 * import { Effect } from "effect";
 *
 * const inside = relativeWithin("/repo", "/repo/docs/new.md");
 * // Requires `FileSystem` and `Path`; succeeds with Option.some("docs/new.md").
 * ```
 *
 * @param base - The absolute directory the path must stay inside.
 * @param absolute - The absolute path to place under `base`.
 * @returns An `Effect` succeeding with the base-relative posix path, or `None`.
 *
 * @public
 */
export const relativeWithin: (
	base: string,
	absolute: string,
) => Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> = Effect.fn(
	"Walker.relativeWithin",
)(function* (base: string, absolute: string) {
	const path = yield* Path.Path;
	const outcome = yield* runUpward(
		confineRealMachine<PlatformError.PlatformError>("Walker.relativeWithin", base, absolute, path, true),
	);
	return outcome._tag === "Ok" ? Option.some(outcome.value) : Option.none();
});

/**
 * {@link relativeWithin}, synchronously, over a caller-supplied port.
 *
 * @example
 * ```ts
 * import { relativeWithinSync } from "@effected/walker";
 * import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
 *
 * const inside = relativeWithinSync("/repo", "/repo/docs/new.md", nodeWalkerSyncOps);
 * ```
 *
 * @param base - The absolute directory the path must stay inside.
 * @param absolute - The absolute path to place under `base`.
 * @param ops - The platform: spread or pass `nodeWalkerSyncOps`.
 * @returns The base-relative posix path, or `None`.
 *
 * @public
 */
export const relativeWithinSync = (base: string, absolute: string, ops: WalkerSyncOps): Option.Option<string> => {
	const outcome = runUpwardSync(
		confineRealMachine<unknown>("Walker.relativeWithinSync", base, absolute, ops.path, true),
		ops.fileSystem,
	);
	return outcome._tag === "Ok" ? Option.some(outcome.value) : Option.none();
};
