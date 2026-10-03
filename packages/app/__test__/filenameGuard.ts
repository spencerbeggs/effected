import { assert, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";

/** The guards' own words — what discriminates a path-guard die from any other die. */
export const guardMessage = /`(filename|subdir)` must/;

/** Assert an exit died on the filename guard: a DEFECT, never a typed failure — a bad filename is wiring, not input. */
export const assertGuardExit = (exit: Exit.Exit<unknown, unknown>): void => {
	const cause = Exit.getCause(exit);
	assert.isTrue(Option.isSome(cause));
	const reasons = Option.getOrThrow(cause).reasons;
	assert.isFalse(reasons.some(Cause.isFailReason));
	const die = reasons.find(Cause.isDieReason);
	const defect = die?.defect;
	assert.instanceOf(defect, Error);
	assert.match((defect as Error).message, guardMessage);
};

/** Whatever this exit died on, it must NOT be the guard — the proof the guard stays quiet on good input. */
export const assertNotGuardExit = (exit: Exit.Exit<unknown, unknown>): void => {
	const cause = Exit.getCause(exit);
	assert.isTrue(Option.isSome(cause));
	for (const reason of Option.getOrThrow(cause).reasons) {
		if (Cause.isDieReason(reason) && reason.defect instanceof Error) {
			assert.notMatch(reason.defect.message, guardMessage);
		}
	}
};

/**
 * The full rejected-shape matrix, one `it.effect` per case. Every module with
 * a `filename` option runs all five; a new rejected shape is added here once
 * and pins every guard at the same time.
 */
export const filenameGuardCases = (build: (filename: string) => Effect.Effect<Exit.Exit<unknown, unknown>>): void => {
	const assertGuardDefect = (name: string, filename: string) =>
		it.effect(name, () => Effect.map(build(filename), assertGuardExit));

	assertGuardDefect("an empty filename dies at construction", "");
	assertGuardDefect("a filename with a forward slash dies at construction", "sub/file.db");
	assertGuardDefect("a filename with a backslash dies at construction", "sub\\file.db");
	assertGuardDefect("a bare dot filename dies at construction", ".");
	assertGuardDefect("a traversal filename dies at construction", "..");
};

/**
 * The rejected-shape matrix for a `subdir` option, one `it.effect` per case.
 * A subdirectory is a relative path of single components, so it inherits every
 * filename case per component and adds the shapes only a path can have.
 */
export const subdirGuardCases = (build: (subdir: string) => Effect.Effect<Exit.Exit<unknown, unknown>>): void => {
	const assertGuardDefect = (name: string, subdir: string) =>
		it.effect(name, () => Effect.map(build(subdir), assertGuardExit));

	assertGuardDefect("an empty subdir dies at construction", "");
	assertGuardDefect("an absolute subdir dies at construction", "/etc");
	assertGuardDefect("a subdir with a backslash dies at construction", "a\\b");
	assertGuardDefect("a subdir with an empty component dies at construction", "a//b");
	assertGuardDefect("a subdir with a trailing slash dies at construction", "a/");
	assertGuardDefect("a bare dot subdir dies at construction", ".");
	assertGuardDefect("a traversal subdir dies at construction", "..");
	assertGuardDefect("a subdir with a dot component dies at construction", "./a");
	assertGuardDefect("a subdir with a nested traversal dies at construction", "a/../../b");
};
