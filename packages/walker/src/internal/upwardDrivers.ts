// The two drivers of `upwardMachine.ts`. A driver only maps its platform's
// answers and failures — every rule lives in the machine.

import type { PlatformError } from "effect";
import { Effect, FileSystem } from "effect";
import type { ReadAnswer } from "./descendMachine.js";
import type { UpwardRequest, UpwardResult } from "./upwardMachine.js";

/** The synchronous file operations the upward machine asks of a port. */
export interface UpwardSyncFileSystem {
	readonly stat: (path: string) => unknown;
	readonly realPath: (path: string) => string;
}

type Machine<A> = Generator<UpwardRequest, A, unknown>;

/** Runs a machine against core's `FileSystem`. A machine's `Defect` dies. */
export const runUpward = <A>(machine: Machine<UpwardResult<A>>): Effect.Effect<A, never, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const answer = (request: UpwardRequest): Effect.Effect<unknown> =>
			request._tag === "Exists"
				? // `exists` absorbs NotFound itself; every other failure is "not there" too.
					fs.exists(request.path).pipe(Effect.orElseSucceed(() => false))
				: fs.realPath(request.path).pipe(
						Effect.map((value): ReadAnswer<string, PlatformError.PlatformError> => ({ _tag: "Ok", value })),
						Effect.catch((error) =>
							Effect.succeed<ReadAnswer<string, PlatformError.PlatformError>>(
								error.reason._tag === "NotFound" ? { _tag: "NotFound" } : { _tag: "Failed", cause: error },
							),
						),
					);
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
		try {
			return { _tag: "Ok", value: fileSystem.realPath(request.path) } satisfies ReadAnswer<string, unknown>;
		} catch (cause) {
			return (isNotFound(cause) ? { _tag: "NotFound" } : { _tag: "Failed", cause }) satisfies ReadAnswer<
				string,
				unknown
			>;
		}
	};
	let step = machine.next();
	while (step.done !== true) step = machine.next(answer(step.value));
	const result = step.value;
	if (result._tag === "Defect") throw new Error(result.message);
	return result.value;
};
