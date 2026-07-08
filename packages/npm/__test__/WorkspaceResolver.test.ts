import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { DependencyResolutionError, WorkspaceResolver } from "../src/index.js";

describe("WorkspaceResolver", () => {
	layer(WorkspaceResolver.noop)("no-op default layer", (it) => {
		it.effect("versionOf returns none", () =>
			Effect.gen(function* () {
				const resolver = yield* WorkspaceResolver;
				const version = yield* resolver.versionOf("@effected/semver");
				assert.isTrue(Option.isNone(version));
			}),
		);
	});

	describe("stub implementation", () => {
		// A test double resolving a fixed workspace map proves the contract is
		// implementable and that versionOf threads packageName through correctly.
		const versions = new Map<string, string>([
			["@effected/semver", "0.1.0"],
			["@effected/jsonc", "0.2.0"],
		]);
		const StubWorkspaceResolver = Layer.succeed(WorkspaceResolver, {
			versionOf: (packageName) => Effect.succeed(Option.fromUndefinedOr(versions.get(packageName))),
		});

		layer(StubWorkspaceResolver)((it) => {
			it.effect("resolves a known workspace package", () =>
				Effect.gen(function* () {
					const resolver = yield* WorkspaceResolver;
					const version = yield* resolver.versionOf("@effected/semver");
					assert.deepStrictEqual(version, Option.some("0.1.0"));
				}),
			);

			it.effect("returns none for an unknown workspace package", () =>
				Effect.gen(function* () {
					const resolver = yield* WorkspaceResolver;
					const version = yield* resolver.versionOf("@effected/nope");
					assert.isTrue(Option.isNone(version));
				}),
			);
		});
	});

	describe("DependencyResolutionError", () => {
		it("preserves a structured cause and renders its message", () => {
			const cause = { kind: "missing" as const, packageName: "@effected/semver" };
			const error = DependencyResolutionError.make({ specifier: "workspace:*", cause });

			assert.strictEqual(error._tag, "DependencyResolutionError");
			assert.strictEqual(error.specifier, "workspace:*");
			// cause is kept structured, not folded into a string.
			assert.deepStrictEqual(error.cause, cause);
			assert.strictEqual(typeof error.message, "string");
			assert.match(error.message, /workspace:\*/);
			assert.isTrue(error instanceof Error);
		});

		it("preserves an Error cause without stringifying it", () => {
			const cause = new Error("catalog not found");
			const error = DependencyResolutionError.make({ specifier: "catalog:", cause });

			assert.strictEqual(error.cause, cause);
			assert.isTrue(error.cause instanceof Error);
			assert.strictEqual((error.cause as Error).message, "catalog not found");
		});

		it.effect("fails an effect through the typed error channel", () =>
			Effect.gen(function* () {
				const result = yield* Effect.flip(
					Effect.fail(DependencyResolutionError.make({ specifier: "catalog:", cause: "unresolved" })),
				);
				assert.strictEqual(result._tag, "DependencyResolutionError");
				assert.strictEqual(result.cause, "unresolved");
			}),
		);
	});
});
