#!/usr/bin/env node
/**
 * The `runtime-resolver` binary.
 *
 * This is the only file that binds the command to a concrete runtime, which is
 * what makes this package integrated tier and the library it wraps boundary
 * tier: `@effect/platform-node` supplies the Node implementations of the
 * `FileSystem`, `Path`, `Terminal`, `Stdio` and `ChildProcessSpawner` services
 * that `effect` core declares but does not implement.
 *
 * @packageDocumentation
 */

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { command } from "./Cli.js";

const main = Command.run(command, { version: process.env.__PACKAGE_VERSION__ ?? "0.0.0" }).pipe(
	Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(main);
