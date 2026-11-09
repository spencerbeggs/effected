import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Schema } from "effect";
import { ActionConfig } from "../../src/index.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/action");

/** Uses a temporary copy of a fixture, removed afterwards. */
export const withFixture = <A, E, R>(name: string, use: (cwd: string) => Effect.Effect<A, E, R>) =>
	withFiles({}, (cwd) => {
		cpSync(join(FIXTURES, name), cwd, { recursive: true });
		return use(cwd);
	});

/**
 * Uses a temporary directory holding `files`, removed afterwards. The host's `FileSystem` and `Path` are provided:
 * rolldown bundles from the real disk, so the bundler's own reads and writes must see the same one.
 */
export const withFiles = <A, E, R>(
	files: Readonly<Record<string, string>>,
	use: (cwd: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, NodeServices.NodeServices>> =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const cwd = mkdtempSync(join(tmpdir(), "effected-action-e2e-"));
			for (const [name, source] of Object.entries(files)) {
				mkdirSync(dirname(join(cwd, name)), { recursive: true });
				writeFileSync(join(cwd, name), source);
			}
			return cwd;
		}),
		use,
		(cwd) => Effect.sync(() => rmSync(cwd, { recursive: true, force: true })),
	).pipe(Effect.provide(NodeServices.layer));

export const configOf = (document: unknown = {}): ActionConfig => Schema.decodeUnknownSync(ActionConfig)(document);

/** Runs a built bundle as a program, with no `GITHUB_*` variable, and answers its stdout. */
export const runBundle = (file: string): string =>
	execFileSync(process.execPath, [file], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { PATH: process.env.PATH ?? "" },
	});
