import { assert } from "@effect/vitest";
import { Result } from "effect";

/**
 * Unwrap a Result you expect to be a Success, failing the test with the
 * formatted failure otherwise. Use this instead of raw property access on an
 * unnarrowed Result — the silent-undefined misread this scratchpad exists to kill.
 */
export const assertSuccess = <A, E>(result: Result.Result<A, E>): A => {
	if (Result.isFailure(result)) {
		assert.fail(`expected Success, got Failure: ${JSON.stringify(result.failure, null, 2)}`);
	}
	return (result as Result.Success<A, E>).success;
};

/** Unwrap a Result you expect to be a Failure, failing the test otherwise. */
export const assertFailure = <A, E>(result: Result.Result<A, E>): E => {
	if (Result.isSuccess(result)) {
		assert.fail(`expected Failure, got Success: ${JSON.stringify(result.success, null, 2)}`);
	}
	return (result as Result.Failure<A, E>).failure;
};
