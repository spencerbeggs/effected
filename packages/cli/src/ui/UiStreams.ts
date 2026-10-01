import { Context } from "effect";
import { processStreams } from "./internal/processStreams.js";

/**
 * The streams a screen mounts on: Node streams, because Ink's stream contract is Node's.
 *
 * @remarks
 * `stdin` must offer `isTTY`, `setRawMode`, `ref` and `unref`, and emit `readable`; `stdout` and `stderr` offer
 * `columns`, `rows`, `isTTY` and `write`, and emit `resize`.
 *
 * @public
 */
export interface UiStreamsShape {
	/** The input a screen reads keys from. */
	readonly stdin: NodeJS.ReadStream;
	/** The output a screen draws on. */
	readonly stdout: NodeJS.WriteStream;
	/** The error output, which Ink also binds. */
	readonly stderr: NodeJS.WriteStream;
}

/**
 * The streams a screen mounts on, the process's own standard streams by default.
 *
 * @remarks
 * A `Context.Reference`, so it never appears in `R`: the default reads the process streams when first used, never
 * at import, and a test provides in-memory streams with `Effect.provideService(UiStreams, streams)`. `./ui` binds
 * Node's process streams on its own licence (`okf/decisions/ui-binds-process-streams.md`).
 *
 * @public
 */
export class UiStreams extends Context.Reference<UiStreamsShape>("@effected/cli/ui/UiStreams", {
	defaultValue: () => processStreams(),
}) {}
