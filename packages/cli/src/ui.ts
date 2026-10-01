/**
 * Interactive screens for a command-line program built on `effect/cli`, drawn with Ink.
 *
 * @remarks
 * `ink` and `react` are optional peers: install them to use this entrypoint. Importing it loads neither; they are
 * loaded when a screen first mounts. The package root never reaches this entrypoint, which a reachability test
 * pins.
 *
 * @packageDocumentation
 */

/**
 * Interactive screens. A placeholder while the `./ui` entrypoint is scaffolded.
 *
 * @public
 */
export class CliUi {
	private constructor() {}

	/** The scaffold marker; the screen surface replaces it. */
	static readonly version = "p4";
}
