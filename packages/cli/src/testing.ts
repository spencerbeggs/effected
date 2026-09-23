/**
 * Test utilities for CLIs built on `effect/unstable/cli`: spawn a built bin in a
 * hermetic sandbox and read its exit code and streams as data.
 *
 * @remarks
 * A separate entrypoint so a CLI's runtime import graph never loads test code;
 * see the reachability test beside it.
 *
 * @packageDocumentation
 */
export { CliTest, type RunOptions, type RunResult, type Sandbox } from "./CliTest.js";
