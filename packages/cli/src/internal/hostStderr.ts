import { Effect } from "effect";

/** The one shape of a host this module reads: its `process.stderr.isTTY` flag, nothing else. */
export interface HostWithStderr {
	readonly process?: { readonly stderr?: { readonly isTTY?: boolean | undefined } | undefined } | undefined;
}

/**
 * Stderr's own terminal check when the host has a `process.stderr`, or `undefined` when it has none.
 *
 * @remarks
 * Core's `Stdio` reports only stdout (upstream Effect-TS/effect#8639), so without this stderr's colour mirrors
 * stdout's check and a redirected stderr is painted into its file. The probe is structural: it reads the host
 * through `globalThis` and imports nothing from Node, so on a runtime with no `process.stderr` the answer is
 * `undefined` and the mirror stays. When core grows the check, this module is deleted and `main` reads it from `Stdio`.
 *
 * One of the four files licensed to touch `process` (the boundary test holds that licence exact): it reads
 * `process.stderr.isTTY` and nothing else, only when called, never at import.
 *
 * @param host - the object to probe; `globalThis` by default, a structural double in a test
 * @internal
 */
export const hostStderrIsTerminal = (host: HostWithStderr = globalThis): Effect.Effect<boolean> | undefined => {
	const stderr = host.process?.stderr;
	return stderr === undefined ? undefined : Effect.sync(() => stderr.isTTY === true);
};
