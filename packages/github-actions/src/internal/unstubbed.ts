// The one way an unstubbed test-double member dies, for every `makeTest` in
// this package.
//
// A double's unstubbed member must die rather than silently succeed — a stub
// that returns nothing teaches a test that nothing happened. The message names
// the double, the member and the override that fixes it, and it is spelled
// here once so a wording change is one edit rather than ten.

import { Effect } from "effect";

/**
 * The die-on-call members of `<double>.makeTest`: `dies("save")` is an
 * `Effect` that defects naming `save` when run. Each package double binds its
 * own name once, then lists its members.
 *
 * @internal
 */
export const unstubbed =
	(double: string) =>
	(member: string): Effect.Effect<never> =>
		// `Effect.die`, not a throw inside `Effect.sync`: the outcome is the same
		// defect, but stated as one rather than produced by an exception the
		// runtime has to catch. No test can tell the two forms apart (both exit
		// with the same Die), so this choice is deliberate but unpinned.
		Effect.die(new Error(`${double}: ${member}() was called but not stubbed — pass a \`${member}\` override.`));
