import { assert, describe, it } from "@effect/vitest";
import { CatalogResolver, Default as NpmDefault, WorkspaceResolver } from "@effected/npm";
import { Effect, HashMap, Layer, Option } from "effect";
import { Package } from "../src/Package.js";

const workspaceOf = (versions: Record<string, string>): Layer.Layer<WorkspaceResolver> =>
	Layer.succeed(WorkspaceResolver, {
		versionOf: (name) => Effect.succeed(Option.fromUndefinedOr(versions[name])),
	});

const catalogOf = (ranges: Record<string, string>): Layer.Layer<CatalogResolver> =>
	Layer.succeed(CatalogResolver, {
		rangeOf: (name, catalog) =>
			Effect.succeed(Option.fromUndefinedOr(ranges[Option.getOrElse(catalog, () => "")] ?? ranges[name])),
	});

const decodeDeps = (deps: Record<string, string>) =>
	Package.decode({ name: "p", version: "1.0.0", dependencies: deps });

describe("Package.resolve", () => {
	it.effect("rewrites workspace: and catalog: via the provided resolvers", () =>
		Effect.gen(function* () {
			const pkg = yield* decodeDeps({ lib: "workspace:^", effect: "catalog:", lodash: "^4.0.0" });
			const resolved = yield* Package.resolve(pkg).pipe(
				Effect.provide(Layer.mergeAll(workspaceOf({ lib: "1.2.3" }), catalogOf({ effect: "^3.10.0" }))),
			);
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "lib"), Option.some("^1.2.3"));
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "effect"), Option.some("^3.10.0"));
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "lodash"), Option.some("^4.0.0"));
		}),
	);

	it.effect("leaves specifiers untouched with the no-op default layers", () =>
		Effect.gen(function* () {
			const pkg = yield* decodeDeps({ lib: "workspace:*" });
			const resolved = yield* Package.resolve(pkg).pipe(Effect.provide(NpmDefault));
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "lib"), Option.some("workspace:*"));
		}),
	);

	it.effect("applies every workspace: modifier form", () =>
		Effect.gen(function* () {
			const pkg = yield* decodeDeps({
				star: "workspace:*",
				tilde: "workspace:~",
				caret: "workspace:^",
				explicit: "workspace:2.5.0",
			});
			const resolved = yield* Package.resolve(pkg).pipe(
				Effect.provide(
					Layer.mergeAll(
						workspaceOf({ star: "1.2.3", tilde: "1.2.3", caret: "1.2.3", explicit: "1.2.3" }),
						CatalogResolver.noop,
					),
				),
			);
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "star"), Option.some("1.2.3"));
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "tilde"), Option.some("~1.2.3"));
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "caret"), Option.some("^1.2.3"));
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "explicit"), Option.some("2.5.0"));
		}),
	);

	it.effect("resolves a named catalog", () =>
		Effect.gen(function* () {
			const pkg = yield* decodeDeps({ react: "catalog:react17" });
			const resolved = yield* Package.resolve(pkg).pipe(
				Effect.provide(Layer.mergeAll(WorkspaceResolver.noop, catalogOf({ react17: "^17.0.0" }))),
			);
			assert.deepStrictEqual(HashMap.get(resolved.dependencies, "react"), Option.some("^17.0.0"));
		}),
	);
});
