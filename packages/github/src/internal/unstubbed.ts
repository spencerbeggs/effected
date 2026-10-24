// The one way an unstubbed test-double member dies, for every `makeTest` in
// this package.
//
// A double's unstubbed member must die rather than silently succeed — a stub
// that returns nothing teaches a test that nothing happened — and it must die
// WHEN RUN, not when called: calling it builds an effect whose `Exit` carries
// the defect, so the death surfaces where every other outcome of the effect
// does rather than as an exception escaping the call site. The message names
// the double, the member and the override that fixes it, and it is spelled
// here once so a wording change is one edit rather than twenty-four.

import { Effect } from "effect";

/**
 * The die-on-call members of `<double>.makeTest`: `dies("get")` is an `Effect`
 * that defects naming `get()` when run. Each package double binds its own name
 * once, then lists its members. `advice` replaces the default "pass a
 * `<member>` override" tail for a double with a better remedy to name.
 *
 * @internal
 */
export const unstubbed =
	(double: string, advice?: string) =>
	(member: string): Effect.Effect<never> =>
		// `Effect.die`, not a throw inside `Effect.sync`: the outcome is the same
		// defect, but stated as one rather than produced by an exception the
		// runtime has to catch.
		Effect.die(
			new Error(`${double}: ${member}() was called but not stubbed — ${advice ?? `pass a \`${member}\` override.`}`),
		);

/**
 * The die-on-read members of `<double>.makeTest`: a **value** member (an
 * `Effect` the shape holds rather than a function returning one) has no call
 * to defer to, so `unread("settings")` is the `Effect` the double holds in its
 * place, and it defects naming `settings` when run. Dying while BUILDING the
 * double would fail every test that provides it rather than the ones that
 * read the member.
 *
 * @internal
 */
export const unstubbedRead =
	(double: string) =>
	(member: string): Effect.Effect<never> =>
		Effect.die(new Error(`${double}: ${member} was read but not stubbed — pass a \`${member}\` override.`));
