/**
 * Test utilities for the interactive screens of `@effected/cli/ui`: mount a screen on in-memory streams, drive it
 * with keys and read its frames.
 *
 * @remarks
 * A separate entrypoint so a program's runtime import graph never loads test code.
 *
 * @packageDocumentation
 */

/**
 * The screen harness. A placeholder while the `./ui/testing` entrypoint is scaffolded.
 *
 * @public
 */
export class CliUiTest {
	private constructor() {}

	/** The scaffold marker; the harness surface replaces it. */
	static readonly version = "p4";
}
