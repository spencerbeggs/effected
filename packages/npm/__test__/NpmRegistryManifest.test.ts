import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { RegistryTarget } from "../src/NpmRegistry.js";
import { NpmRegistry, RegistryReadError, VersionManifest } from "../src/NpmRegistry.js";

/** One scripted HTTP outcome. */
interface Route {
	readonly status: number;
	readonly body?: unknown;
}

interface Stub {
	readonly layer: Layer.Layer<HttpClient.HttpClient>;
	readonly requests: ReadonlyArray<{ readonly url: string; readonly authorization: string | undefined }>;
}

/** A scripted `HttpClient` plus the log of what it was asked for. */
const stub = (route: (url: string) => Route): Stub => {
	const requests: Array<{ url: string; authorization: string | undefined }> = [];
	const layer = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.suspend(() => {
				requests.push({ url: url.toString(), authorization: request.headers.authorization });
				const result = route(url.toString());
				return Effect.succeed(
					HttpClientResponse.fromWeb(
						request,
						new Response(JSON.stringify(result.body ?? {}), { status: result.status }),
					),
				);
			}),
		),
	);
	return { layer, requests };
};

const manifestOf = (name: string, version: string, client: Stub, target?: RegistryTarget) =>
	Effect.flatMap(NpmRegistry, (r) => r.manifest(name, version, target)).pipe(
		Effect.provide(NpmRegistry.layer.pipe(Layer.provide(client.layer))),
	);

/**
 * A fixture packument shaped like a real one: a modern version carrying every
 * dependency field (plus fields `manifest` must ignore), and a legacy version
 * whose `engines` is the old array form.
 */
const modern = {
	name: "@acme/widget",
	version: "2.0.0",
	description: "ignored",
	scripts: { build: "ignored" },
	dependencies: { tslib: "^2.6.0" },
	peerDependencies: { react: "^18 || ^19", "react-dom": "^18 || ^19" },
	peerDependenciesMeta: { "react-dom": { optional: true, note: "dropped" } },
	optionalDependencies: { fsevents: "^2.3.0" },
	engines: { node: ">=20" },
	dist: { integrity: "sha512-abc123==", tarball: "https://registry.npmjs.org/@acme/widget/-/widget-2.0.0.tgz" },
};
const legacy = {
	name: "@acme/widget",
	version: "0.1.0",
	dependencies: { lodash: "~0.9.0" },
	engines: ["node >= 0.8"],
};
const fixturePackument = {
	name: "@acme/widget",
	"dist-tags": { latest: "2.0.0" },
	versions: { "0.1.0": legacy, "2.0.0": modern },
	time: { created: "2012-01-01T00:00:00.000Z", "0.1.0": "2012-01-01T00:00:00.000Z" },
};

/** Serves the fixture as a registry with both endpoints would. */
const fixtureRoute = (url: string): Route => {
	const path = new URL(url).pathname;
	if (path === "/%40acme%2Fwidget") return { status: 200, body: fixturePackument };
	if (path === "/%40acme%2Fwidget/2.0.0") return { status: 200, body: modern };
	if (path === "/%40acme%2Fwidget/0.1.0") return { status: 200, body: legacy };
	return { status: 404 };
};

describe("NpmRegistry.manifest", () => {
	it.effect("reads every dependency field of a version from the per-version endpoint", () =>
		Effect.gen(function* () {
			const client = stub(fixtureRoute);
			const found = yield* manifestOf("@acme/widget", "2.0.0", client);
			if (Option.isNone(found)) return assert.fail("expected the version to be published");
			assert.instanceOf(found.value, VersionManifest);
			assert.deepStrictEqual(
				{ ...found.value },
				{
					name: "@acme/widget",
					version: "2.0.0",
					dependencies: { tslib: "^2.6.0" },
					peerDependencies: { react: "^18 || ^19", "react-dom": "^18 || ^19" },
					peerDependenciesMeta: { "react-dom": { optional: true } },
					optionalDependencies: { fsevents: "^2.3.0" },
					engines: { node: ">=20" },
				},
			);
			assert.lengthOf(client.requests, 1);
			assert.strictEqual(client.requests[0]?.url, "https://registry.npmjs.org/%40acme%2Fwidget/2.0.0");
		}),
	);

	it.effect("leaves a field the document does not carry absent, never an empty record", () =>
		Effect.gen(function* () {
			const found = yield* manifestOf("@acme/widget", "0.1.0", stub(fixtureRoute));
			if (Option.isNone(found)) return assert.fail("expected the version to be published");
			assert.isFalse(Object.hasOwn(found.value, "peerDependencies"));
			assert.isFalse(Object.hasOwn(found.value, "optionalDependencies"));
			assert.isFalse(Object.hasOwn(found.value, "peerDependenciesMeta"));
		}),
	);

	it.effect("omits a legacy array `engines` rather than failing the read, and keeps the rest", () =>
		Effect.gen(function* () {
			const found = yield* manifestOf("@acme/widget", "0.1.0", stub(fixtureRoute));
			if (Option.isNone(found)) return assert.fail("expected the version to be published");
			assert.isFalse(Object.hasOwn(found.value, "engines"));
			assert.deepStrictEqual(found.value.dependencies, { lodash: "~0.9.0" });
			// The exported class is strict about the same document: the leniency is
			// the read's, not the schema's.
			const direct = yield* Effect.exit(Schema.decodeUnknownEffect(VersionManifest)(legacy));
			assert.isTrue(Exit.isFailure(direct));
		}),
	);

	it.effect("fails kind 'decode' for a malformed dependency record rather than reading it as absent", () =>
		Effect.gen(function* () {
			const client = stub(() => ({
				status: 200,
				body: { ...modern, peerDependencies: { react: 18 } },
			}));
			const error = yield* Effect.flip(manifestOf("@acme/widget", "2.0.0", client));
			assert.instanceOf(error, RegistryReadError);
			assert.strictEqual(error.kind, "decode");
			assert.strictEqual(error.package, "@acme/widget");
		}),
	);

	it.effect("a version the registry does not have is Option.none", () =>
		Effect.gen(function* () {
			const found = yield* manifestOf("@acme/widget", "9.9.9", stub(fixtureRoute));
			assert.isTrue(Option.isNone(found));
		}),
	);

	it.effect("a github-packages target reads the packument once, never the per-version path", () =>
		Effect.gen(function* () {
			const client = stub(() => ({ status: 200, body: fixturePackument }));
			const target: RegistryTarget = {
				registry: "https://npm.pkg.github.com",
				credential: { kind: "token", token: Redacted.make("ghp_token") },
			};
			const found = yield* manifestOf("@acme/widget", "2.0.0", client, target);
			if (Option.isNone(found)) return assert.fail("expected the version to be published");
			assert.deepStrictEqual(found.value.peerDependencies, { react: "^18 || ^19", "react-dom": "^18 || ^19" });
			assert.lengthOf(client.requests, 1);
			assert.strictEqual(client.requests[0]?.url, "https://npm.pkg.github.com/%40acme%2Fwidget");
			assert.strictEqual(client.requests[0]?.authorization, "Bearer ghp_token");
		}),
	);

	it.effect("any other registry answering 405 on the per-version path falls back to the packument", () =>
		Effect.gen(function* () {
			const client = stub((url) =>
				new URL(url).pathname.endsWith("/2.0.0") ? { status: 405 } : { status: 200, body: fixturePackument },
			);
			const found = yield* manifestOf("@acme/widget", "2.0.0", client, { registry: "https://registry.example.com" });
			if (Option.isNone(found)) return assert.fail("expected the version to be published");
			assert.deepStrictEqual(found.value.optionalDependencies, { fsevents: "^2.3.0" });
			assert.deepStrictEqual(
				client.requests.map((request) => request.url),
				["https://registry.example.com/%40acme%2Fwidget/2.0.0", "https://registry.example.com/%40acme%2Fwidget"],
			);
		}),
	);

	it.effect("selects a packument version by own key only: `constructor` is not a version", () =>
		Effect.gen(function* () {
			const found = yield* manifestOf(
				"@acme/widget",
				"constructor",
				stub(() => ({ status: 200, body: fixturePackument })),
				{
					registry: "https://npm.pkg.github.com",
				},
			);
			assert.isTrue(Option.isNone(found));
		}),
	);
});

describe("NpmRegistry.manifest test doubles", () => {
	it.effect("makeTest dies for an unstubbed manifest rather than answering no peers", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(NpmRegistry.makeTest().manifest("pkg", "1.0.0"));
			if (!Exit.isFailure(exit)) return assert.fail("expected a defect from an unstubbed member");
			assert.isTrue(exit.cause.reasons.some((reason) => reason._tag === "Die"));
		}),
	);

	it.effect("makeSeeded answers the seeded fields and leaves unseeded ones absent", () =>
		Effect.gen(function* () {
			const seeded = NpmRegistry.makeSeeded({
				registries: {
					"https://registry.npmjs.org": {
						pkg: {
							"1.0.0": {
								peerDependencies: { effect: "^4.0.0" },
								peerDependenciesMeta: { effect: { optional: false } },
							},
						},
					},
				},
			});
			const found = yield* seeded.manifest("pkg", "1.0.0");
			if (Option.isNone(found)) return assert.fail("expected the seeded version");
			assert.deepStrictEqual(found.value.peerDependencies, { effect: "^4.0.0" });
			assert.deepStrictEqual(found.value.peerDependenciesMeta, { effect: { optional: false } });
			assert.isFalse(Object.hasOwn(found.value, "dependencies"));
			assert.isTrue(Option.isNone(yield* seeded.manifest("pkg", "2.0.0")));
			assert.isTrue(
				Option.isNone(yield* seeded.manifest("pkg", "1.0.0", { registry: "https://npm.pkg.github.com" })),
				"the registry axis",
			);
		}),
	);
});
