import { Result } from "effect";

export interface Dimensions {
	readonly width: number;
	readonly height: number;
}

export interface ReadFailure {
	readonly reason: "truncated" | "malformed";
	readonly detail: string;
}

export type ReadResult = Result.Result<Dimensions, ReadFailure>;

export const MAX_DIMENSION = 0x7fffffff;

export const truncated = (detail: string): Result.Result<never, ReadFailure> =>
	Result.fail({ reason: "truncated", detail });
export const malformed = (detail: string): Result.Result<never, ReadFailure> =>
	Result.fail({ reason: "malformed", detail });

const legal = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= MAX_DIMENSION;

/** Succeed with the pair, or fail `malformed` when either side is out of range. */
export const dimensions = (width: number, height: number): ReadResult =>
	legal(width) && legal(height)
		? Result.succeed({ width, height })
		: malformed(`dimensions ${width}x${height} out of range 1..${MAX_DIMENSION}`);
