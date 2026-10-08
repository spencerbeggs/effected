import type { Effect, PlatformError, Scope, Stream } from "effect";
import { Context } from "effect";

/**
 * The service shape behind {@link JournalWatcher}.
 *
 * @public
 */
export interface JournalWatcherShape {
	/**
	 * Watch `path`, a journal file or the directory it will be created in.
	 *
	 * The effect succeeds only once the watch is **registered**: every change
	 * to `path` after it succeeds is delivered on the returned stream. That
	 * ordering is the whole contract — the journal arms a watch, then reads
	 * what it missed, then follows the stream, and a change landing between a
	 * watch that was merely requested and one that was registered would be
	 * lost. The watch lives until the enclosing scope closes. Watching a file,
	 * the stream ends once the path is removed or names a different file (a
	 * rename over it), because a platform watch follows the inode it was armed
	 * on and would otherwise go blind; the journal then re-arms on whatever the
	 * path names now. Watching a directory, it does not end for a child
	 * appearing or vanishing.
	 *
	 * Each element is the name the platform reports for the change, which may
	 * be a bare basename and may be absent. The journal treats every element as
	 * an untyped poke — "re-stat the file" — and never opens what it names.
	 *
	 * A path that does not exist fails with a `PlatformError` whose reason is
	 * `NotFound`.
	 */
	readonly watch: (
		path: string,
	) => Effect.Effect<
		Stream.Stream<string | undefined, PlatformError.PlatformError>,
		PlatformError.PlatformError,
		Scope.Scope
	>;
}

/**
 * How a journal is told its file changed underneath it: a watch that reports
 * when it is armed.
 *
 * Core's `FileSystem.watch` cannot serve here. Its stream registers the
 * platform watch in a fiber it forks, after an asynchronous `stat`, and gives
 * no signal when that has happened — so a journal reading what it missed
 * before the watch was live cannot know whether a concurrent append landed
 * before registration (and is lost for good) or after (and will be reported).
 * Under load that window is real. This service closes it by construction:
 * {@link JournalWatcherShape.watch} succeeds only once registration is done.
 *
 * The library owns no backend. On Node, provide `NodeJournalWatcher.layer`
 * from `@effected/jsonl/node`; elsewhere, implement the shape over the
 * platform's own watch primitive, honouring the arm-before-success contract.
 *
 * @public
 */
export class JournalWatcher extends Context.Service<JournalWatcher, JournalWatcherShape>()(
	"@effected/jsonl/JournalWatcher",
) {}
