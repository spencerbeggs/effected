import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Result } from "effect";
import type { ImageFormat } from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

/** Read one committed fixture as a fresh Uint8Array. */
export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** The oracle-measured facts for every fixture, keyed by file name. */
export const EXPECTED: Readonly<
	Record<string, { readonly format: ImageFormat; readonly width: number; readonly height: number }>
> = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8"));

export const u16be = (n: number): Array<number> => [(n >>> 8) & 0xff, n & 0xff];
export const u16le = (n: number): Array<number> => [n & 0xff, (n >>> 8) & 0xff];
export const u24le = (n: number): Array<number> => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
export const u32be = (n: number): Array<number> => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
export const u32le = (n: number): Array<number> => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
export const ascii = (s: string): Array<number> => Array.from(s, (c) => c.charCodeAt(0));
export const concat = (...parts: ReadonlyArray<ReadonlyArray<number>>): Uint8Array => new Uint8Array(parts.flat());

/** True when a reader result failed with exactly `reason`. */
export const isReason = (result: Result.Result<unknown, { readonly reason: string }>, reason: string): boolean =>
	Result.isFailure(result) && result.failure.reason === reason;

/** A generator that returns `bytes` and counts how often it ran. */
export const counting = (bytes: Uint8Array) => {
	let calls = 0;
	return {
		generate: () =>
			Effect.sync(() => {
				calls++;
				return bytes;
			}),
		calls: () => calls,
	};
};
