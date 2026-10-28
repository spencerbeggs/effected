// The two drivers of `upwardMachine.ts`. A driver only maps its platform's
// answers and failures — every rule lives in the machine.

import type { PlatformError } from "effect";
import { Effect, FileSystem } from "effect";
import type { PresentAnswer, RealPathAnswer, UpwardRequest, UpwardResult } from "./upwardMachine.js";

/** The synchronous file operations the upward machine asks of a port. */
export interface UpwardSyncFileSystem {
	readonly stat: (path: string) => unknown;
	readonly lstat: (path: string) => unknown;
	readonly realPath: (path: string) => string;
}

type Machine<A> = Generator<UpwardRequest, A, unknown>;

/** Runs a machine against core's `FileSystem`. A machine's `Defect` dies. */
export const runUpward = <A>(machine: Machine<UpwardResult<A>>): Effect.Effect<A, never, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const answer = (request: UpwardRequest): Effect.Effect<unknown> => {
			if (request._tag === "Exists") {
				// `exists` absorbs NotFound itself; every other failure is "not there" too.
				return fs.exists(request.path).pipe(Effect.orElseSucceed(() => false));
			}
			if (request._tag === "Present") {
				return fs.lstat(request.path).pipe(
					Effect.map((): PresentAnswer<PlatformError.PlatformError> => ({ _tag: "Present" })),
					Effect.catch((error) =>
						Effect.succeed<PresentAnswer<PlatformError.PlatformError>>(
							error.reason._tag === "NotFound" ? { _tag: "NotFound" } : { _tag: "Failed", cause: error },
						),
					),
				);
			}
			return fs.realPath(request.path).pipe(
				Effect.map((value): RealPathAnswer<PlatformError.PlatformError> => ({ _tag: "Ok", value })),
				Effect.catch((error) =>
					Effect.succeed<RealPathAnswer<PlatformError.PlatformError>>(
						error.reason._tag === "NotFound" ? { _tag: "NotFound", cause: error } : { _tag: "Failed", cause: error },
					),
				),
			);
		};
		let step = machine.next();
		while (step.done !== true) step = machine.next(yield* answer(step.value));
		const result = step.value;
		if (result._tag === "Defect") return yield* Effect.die(new Error(result.message));
		return result.value;
	});

const isNotFound = (error: unknown): boolean =>
	typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";

/** Runs a machine against a synchronous port. A machine's `Defect` throws. */
export const runUpwardSync = <A>(machine: Machine<UpwardResult<A>>, fileSystem: UpwardSyncFileSystem): A => {
	const answer = (request: UpwardRequest): unknown => {
		if (request._tag === "Exists") {
			try {
				fileSystem.stat(request.path);
				return true;
			} catch {
				return false;
			}
		}
		if (request._tag === "Present") {
			try {
				fileSystem.lstat(request.path);
				return { _tag: "Present" } satisfies PresentAnswer<unknown>;
			} catch (cause) {
				return (isNotFound(cause) ? { _tag: "NotFound" } : { _tag: "Failed", cause }) satisfies PresentAnswer<unknown>;
			}
		}
		try {
			return { _tag: "Ok", value: fileSystem.realPath(request.path) } satisfies RealPathAnswer<unknown>;
		} catch (cause) {
			return (
				isNotFound(cause) ? { _tag: "NotFound", cause } : { _tag: "Failed", cause }
			) satisfies RealPathAnswer<unknown>;
		}
	};
	let step = machine.next();
	while (step.done !== true) step = machine.next(answer(step.value));
	const result = step.value;
	if (result._tag === "Defect") throw new Error(result.message);
	return result.value;
};
