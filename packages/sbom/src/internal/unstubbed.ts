// The one way an unstubbed test-double member dies, for every `makeTest` in
// this package.
//
// A double's unstubbed member must die rather than silently succeed, and it
// must die WHEN RUN, not when called: calling it builds an effect whose `Exit`
// carries the defect, so the death surfaces where every other outcome of the
// effect does rather than as an exception escaping the call site.

import { Effect } from "effect";

/**
 * The die-on-call members of `<double>.makeTest`: `dies("sign")` is an `Effect`
 * that defects naming `sign()` when run. Each package double binds its own
 * name once, then lists its members. `advice` replaces the default "pass a
 * `<member>` override" tail for a double with a better remedy to name.
 *
 * @internal
 */
export const unstubbed =
	(double: string, advice?: string) =>
	(member: string): Effect.Effect<never> =>
		Effect.die(
			new Error(`${double}: ${member}() was called but not stubbed — ${advice ?? `pass a \`${member}\` override.`}`),
		);
