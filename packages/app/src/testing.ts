/**
 * Test utilities for applications built on `@effected/app`: the hermetic
 * control plane — fixed XDG paths, `:memory:` databases and an in-memory
 * filesystem — with `R = never`.
 *
 * @remarks
 * A separate entrypoint so an application's runtime import graph never loads
 * test code or `@effected/memfs` (an optional peer, required only by this
 * entrypoint); see the reachability test beside it.
 *
 * @packageDocumentation
 */
export { AppTest, type AppTestOptions, type AppTestServices } from "./AppTest.js";
