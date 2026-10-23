// What the runner host is — the two facts several services resolve once at
// construction, spelled once.
//
// Both read the environment **shape**, not the service, so a layer resolves
// `ActionEnvironment` once and every member's `R` stays `never`. Both are
// optional reads: off a runner the variables are absent, and the answer is
// the host default rather than a failure, so merely composing a layer outside
// Actions never fails.

import type { Path } from "effect";
import { Effect, Option } from "effect";
import type { ActionEnvironmentShape } from "../ActionEnvironment.js";

/**
 * Whether `RUNNER_OS` says Windows. `false` when unset — off a runner, the
 * POSIX shape is the honest default.
 *
 * @internal
 */
export const isWindowsRunner = (env: ActionEnvironmentShape): Effect.Effect<boolean> =>
	Effect.map(env.getOptional("RUNNER_OS"), (found) =>
		Option.match(found, { onNone: () => false, onSome: (os) => os.toLowerCase() === "windows" }),
	);

/**
 * The tool-cache root: `RUNNER_TOOL_CACHE`, or `/tmp/runner-tool-cache` off a
 * runner.
 *
 * @remarks
 * Resolved at layer construction, never at import: the source package read
 * the variable into a module-level constant, which fixed the root before any
 * layer could say otherwise and made it impossible to point a test elsewhere.
 * `ToolInstaller` is its only reader: a consumer that needs the final cache
 * path (`PackageManagerInstaller`, for its shims) asks the installer's own
 * `cachePath` member rather than resolving the root a second time.
 *
 * @internal
 */
export const toolCacheRoot = (env: ActionEnvironmentShape, path: Path.Path): Effect.Effect<string> =>
	Effect.map(env.getOptional("RUNNER_TOOL_CACHE"), (found) =>
		Option.getOrElse(found, () => path.join("/tmp", "runner-tool-cache")),
	);

/** `RUNNER_ARCH`'s spellings (`X86`, `X64`, `ARM`, `ARM64`), lower-cased, in Node's `process.arch` spelling. */
// A Map, not an object literal: an environment value such as `constructor` must not find an inherited member.
const NODE_ARCH: ReadonlyMap<string, string> = new Map([
	["x86", "ia32"],
	["x64", "x64"],
	["arm", "arm"],
	["arm64", "arm64"],
]);

/** A `RUNNER_ARCH` value in Node's spelling; anything unrecognised passes through. */
const archFromRunner = (runnerArch: string): string => NODE_ARCH.get(runnerArch.toLowerCase()) ?? runnerArch;

/**
 * The host architecture in Node's spelling: `RUNNER_ARCH` mapped through
 * `archFromRunner`, or `process.arch` off a runner, where the variable is
 * absent and the host's own answer is the honest fallback.
 *
 * @internal
 */
export const runnerArch = (env: ActionEnvironmentShape): Effect.Effect<string> =>
	Effect.map(env.getOptional("RUNNER_ARCH"), (found) =>
		Option.match(found, { onNone: () => process.arch as string, onSome: archFromRunner }),
	);
