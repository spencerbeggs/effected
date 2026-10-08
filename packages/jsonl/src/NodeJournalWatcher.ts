// Root types are named through the package's own name, so the emitted node.d.ts imports them from "@effected/jsonl"
// instead of carrying a copy a consumer's root layers could not satisfy.

import * as NFS from "node:fs";
import type * as Jsonl from "@effected/jsonl";
import type { Scope, Stream as StreamType } from "effect";
import { Cause, Effect, Layer, PlatformError, Queue, Stream } from "effect";
import { JournalWatcher } from "./JournalWatcher.js";

/** The `SystemErrorTag` an errno code maps to, after core's Node filesystem mapping. */
const reasonOf = (code: unknown): PlatformError.SystemErrorTag => {
	switch (code) {
		case "ENOENT":
			return "NotFound";
		case "EACCES":
		case "EPERM":
			return "PermissionDenied";
		case "ENOTDIR":
		case "ELOOP":
			return "BadResource";
		default:
			return "Unknown";
	}
};

const watchError = (path: string, cause: unknown): PlatformError.PlatformError =>
	PlatformError.systemError({
		_tag: reasonOf((cause as { readonly code?: unknown } | null)?.code),
		module: "FileSystem",
		method: "watch",
		pathOrDescriptor: path,
		syscall: "watch",
		cause,
	});

/** The identity a watched file is armed on, or `undefined` once the path names nothing. */
const identityAt = (path: string): string | undefined => {
	try {
		const info = NFS.statSync(path);
		return `${info.dev}:${info.ino}`;
	} catch {
		return undefined;
	}
};

/**
 * Register `fs.watch` synchronously, inside the acquire — so when the effect
 * succeeds the platform watch is live, which is the contract
 * {@link Jsonl.JournalWatcherShape.watch} states and core's
 * `FileSystem.watch` cannot.
 *
 * A file watch follows the inode it was armed on, and Node emits neither
 * `close` nor `error` when that inode is unlinked or renamed over: left
 * alone, the stream would outlive the file and the journal would follow a
 * dead inode forever. So every event on a file re-checks the path's identity,
 * and the stream ends — after delivering the event — once the path is gone or
 * names a different file. A directory watch never ends that way: a sibling
 * appearing or vanishing is routine there.
 */
const watch = (
	path: string,
): Effect.Effect<
	StreamType.Stream<string | undefined, PlatformError.PlatformError>,
	PlatformError.PlatformError,
	Scope.Scope
> =>
	Effect.gen(function* () {
		const queue = yield* Queue.unbounded<string | undefined, PlatformError.PlatformError | Cause.Done>();
		yield* Effect.acquireRelease(
			Effect.try({
				try: () => {
					// Synchronous, and before the watch: the contract still holds, and
					// a missing path fails here typed, as the watch itself would.
					const armed = NFS.statSync(path);
					const identity = armed.isDirectory() ? undefined : `${armed.dev}:${armed.ino}`;
					const watcher = NFS.watch(path, (_event, name) => {
						Queue.offerUnsafe(queue, name ?? undefined);
						if (identity !== undefined && identityAt(path) !== identity) Queue.endUnsafe(queue);
					});
					watcher.on("error", (cause) => {
						Queue.failCauseUnsafe(queue, Cause.fail(watchError(path, cause)));
					});
					watcher.on("close", () => {
						Queue.endUnsafe(queue);
					});
					return watcher;
				},
				catch: (cause) => watchError(path, cause),
			}),
			(watcher) => Effect.sync(() => watcher.close()),
		);
		return Stream.fromQueue(queue);
	});

/**
 * The Node implementation of {@link Jsonl.JournalWatcher}, over `node:fs`'s
 * `watch`.
 *
 * Registration happens synchronously while the watch effect runs, so a
 * journal's catch-up read after arming can never miss an append that the
 * watch also fails to report.
 *
 * @example
 * ```ts
 * import { Journal, JsonlEvent } from "@effected/jsonl";
 * import { NodeJournalWatcher } from "@effected/jsonl/node";
 * import { NodeFileSystem } from "@effect/platform-node";
 * import { Effect, Schema } from "effect";
 *
 * const events = [JsonlEvent.make("mail", { data: Schema.Struct({ round: Schema.Number }) })] as const;
 *
 * class Mail extends Journal.Service<Mail>()("app/Mail", { events, config: { path: ".app/mail.jsonl" } }) {}
 *
 * const program = Effect.gen(function* () {
 *   const mail = yield* Mail;
 *   yield* mail.append("mail", { round: 1 });
 * }).pipe(Effect.provide(Mail.layer), Effect.provide([NodeFileSystem.layer, NodeJournalWatcher.layer]));
 * ```
 *
 * @public
 */
export class NodeJournalWatcher {
	private constructor() {}

	/** Provides {@link Jsonl.JournalWatcher} over `node:fs`. */
	static readonly layer: Layer.Layer<Jsonl.JournalWatcher> = Layer.succeed(JournalWatcher, { watch });
}
