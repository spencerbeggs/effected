import { inspect } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import {
	Cause,
	Crypto,
	Effect,
	Exit,
	Layer,
	Logger,
	Option,
	Redacted,
	References,
	Result,
	Schema,
	Tracer,
} from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import type { RegistryCredentialLookup, TarballError } from "../src/index.js";
import { NpmConfig, PackageTarball, PublishedVersion } from "../src/index.js";
import { scripted } from "./publish-fixtures.js";

const REGISTRY_TOKEN = "npm_SECRET_registry_token_4f1d";
const CDN_TOKEN = "cdn_SECRET_storage_token_77aa";

const config = (lines: ReadonlyArray<string>): NpmConfig => {
	const result = NpmConfig.fromSourcesResult([{ text: lines.join("\n") }], {});
	if (Result.isFailure(result)) throw new Error(`unexpected failure: ${result.failure.message}`);
	return result.success;
};

/** A registry token for npm.acme.dev, and a private registry pointing there. */
const ACME = config([`//npm.acme.dev/:_authToken=${REGISTRY_TOKEN}`, "@acme:registry=https://npm.acme.dev/"]);

const published = (tarball: string) =>
	Schema.decodeUnknownSync(PublishedVersion)({ name: "@acme/widget", version: "1.0.0", tarball });

const crypto = Layer.succeed(
	Crypto.Crypto,
	Crypto.make({
		digest: () => Effect.succeed(new Uint8Array(0)),
		randomBytes: (size) => new Uint8Array(size),
	}),
);

type Answer = { readonly status: number; readonly location?: string } | "transport" | "brokenBody";

/**
 * An `HttpClient` recording every request's URL and `Authorization` header,
 * answering by URL. The same shape as the `NpmConfig` wire tests.
 */
const recording = (respond: (url: string) => Answer) => {
	const requests: Array<{ url: string; authorization: string | undefined }> = [];
	const client = HttpClient.make((request, url) =>
		Effect.suspend(() => {
			requests.push({ url: url.toString(), authorization: request.headers.authorization });
			const answer = respond(url.toString());
			if (answer === "transport") {
				return Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({ request, cause: new Error("ECONNRESET") }),
					}),
				);
			}
			if (answer === "brokenBody") {
				// The registry answered 200, then the body stream failed mid-read.
				const body = new ReadableStream({ start: (controller) => controller.error(new Error("socket hang up")) });
				return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status: 200 })));
			}
			return Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					new Response(answer.status === 200 ? "tarball-bytes" : null, {
						status: answer.status,
						...(answer.location === undefined ? {} : { headers: { location: answer.location } }),
					}),
				),
			);
		}),
	);
	return { requests, client };
};

/** Extract `version` over `client`, with `options`. */
const extractWith = (
	client: HttpClient.HttpClient,
	version: PublishedVersion,
	credentials?: RegistryCredentialLookup,
): Effect.Effect<string, TarballError> => {
	const spawner = scripted(() => ({ exit: 0 }));
	const layer = PackageTarball.layer.pipe(
		Layer.provide(
			Layer.mergeAll(spawner.layer, MemoryFileSystem.layer, crypto, Layer.succeed(HttpClient.HttpClient, client)),
		),
	);
	return Effect.flatMap(PackageTarball, (tarball) =>
		tarball.extract(version, credentials === undefined ? undefined : { credentials }),
	).pipe(Effect.scoped, Effect.provide(layer));
};

describe("PackageTarball credentials: what goes on the wire", () => {
	it.effect("a tarball under the registry's host carries the registry's token (the positive control)", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			yield* extractWith(client, published("https://npm.acme.dev/@acme/widget/-/widget-1.0.0.tgz"), ACME);
			assert.lengthOf(requests, 1);
			assert.strictEqual(requests[0]?.authorization, `Bearer ${REGISTRY_TOKEN}`);
		}),
	);

	it.effect("a basic credential goes out as Basic, verbatim", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			const basic = config(["//npm.acme.dev/:_auth=dXNlcjpwYXNz"]);
			yield* extractWith(client, published("https://npm.acme.dev/@acme/widget/-/widget-1.0.0.tgz"), basic);
			assert.strictEqual(requests[0]?.authorization, "Basic dXNlcjpwYXNz");
		}),
	);

	it.effect("a tarball on another host gets NO credential, though its registry has one", () =>
		// The registry listed the tarball, but serves it from a CDN. Looking the
		// credential up by the registry (or the package) would send the
		// registry's token to the CDN; the lookup is by the tarball's own URL.
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			assert.isTrue(Option.isSome(ACME.credentialFor(ACME.registryFor("@acme/widget"))));
			yield* extractWith(client, published("https://cdn.acme-static.net/@acme/widget-1.0.0.tgz"), ACME);
			assert.lengthOf(requests, 1);
			assert.isUndefined(requests[0]?.authorization);
		}),
	);

	it.effect("a tarball on a lookalike host gets no credential", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			yield* extractWith(client, published("https://npm.acme.dev.evil.example/widget-1.0.0.tgz"), ACME);
			assert.isUndefined(requests[0]?.authorization);
		}),
	);

	it.effect("the CDN's own credential is the one sent to the CDN", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			const both = config([
				`//npm.acme.dev/:_authToken=${REGISTRY_TOKEN}`,
				`//cdn.acme-static.net/:_authToken=${CDN_TOKEN}`,
			]);
			yield* extractWith(client, published("https://cdn.acme-static.net/@acme/widget-1.0.0.tgz"), both);
			assert.strictEqual(requests[0]?.authorization, `Bearer ${CDN_TOKEN}`);
		}),
	);

	it.effect("an http tarball gets no credential when its host's registry is https", () =>
		// npm would send the token in cleartext here; NpmConfig refuses.
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			yield* extractWith(client, published("http://npm.acme.dev/@acme/widget/-/widget-1.0.0.tgz"), ACME);
			assert.isUndefined(requests[0]?.authorization);
		}),
	);

	it.effect("an http tarball gets its credential when config chose an http registry for that host", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			const local = config(["registry=http://localhost:4873/", `//localhost:4873/:_authToken=${REGISTRY_TOKEN}`]);
			yield* extractWith(client, published("http://localhost:4873/widget/-/widget-1.0.0.tgz"), local);
			assert.strictEqual(requests[0]?.authorization, `Bearer ${REGISTRY_TOKEN}`);
		}),
	);

	it.effect("with no credentials option, nothing is sent", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			yield* extractWith(client, published("https://npm.acme.dev/@acme/widget/-/widget-1.0.0.tgz"));
			assert.isUndefined(requests[0]?.authorization);
		}),
	);

	it.effect("a lookup answering a publish-only workload credential sends nothing", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			const casting: RegistryCredentialLookup = {
				credentialFor: () =>
					Option.some({ kind: "workload", audience: "x", token: Redacted.make(REGISTRY_TOKEN) } as never),
			};
			yield* extractWith(client, published("https://npm.acme.dev/@acme/widget/-/widget-1.0.0.tgz"), casting);
			assert.isUndefined(requests[0]?.authorization);
		}),
	);

	it.effect("no matching credential proceeds unauthenticated; a 401 fails http with the status", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 401 }));
			const error = yield* Effect.flip(
				extractWith(client, published("https://cdn.acme-static.net/@acme/widget-1.0.0.tgz"), ACME),
			);
			assert.lengthOf(requests, 1, "the request was sent rather than refused up front");
			assert.strictEqual(error.reason, "http");
			assert.strictEqual(error.status, 401);
		}),
	);
});

describe("PackageTarball credentials across redirects", () => {
	const START = "https://npm.acme.dev/@acme/widget/-/widget-1.0.0.tgz";

	it.effect("a cross-host redirect drops the credential", () =>
		// GitHub Packages answers a tarball download with a 302 to a signed URL
		// on a storage host. The registry token must not follow it there.
		Effect.gen(function* () {
			const { requests, client } = recording((url) =>
				url === START ? { status: 302, location: "https://objects.storage.example/blob?sig=abc" } : { status: 200 },
			);
			yield* extractWith(client, published(START), ACME);
			assert.lengthOf(requests, 2);
			assert.strictEqual(requests[0]?.authorization, `Bearer ${REGISTRY_TOKEN}`);
			assert.strictEqual(requests[1]?.url, "https://objects.storage.example/blob?sig=abc");
			assert.isUndefined(requests[1]?.authorization);
		}),
	);

	it.effect("a same-origin redirect keeps it (the control: the drop is by origin, not by any redirect)", () =>
		Effect.gen(function* () {
			const { requests, client } = recording((url) =>
				url === START ? { status: 302, location: "/download/widget-1.0.0.tgz" } : { status: 200 },
			);
			yield* extractWith(client, published(START), ACME);
			assert.lengthOf(requests, 2);
			assert.strictEqual(requests[1]?.url, "https://npm.acme.dev/download/widget-1.0.0.tgz");
			assert.strictEqual(requests[1]?.authorization, `Bearer ${REGISTRY_TOKEN}`);
		}),
	);

	it.effect("a downgrade to http on the same host is another origin, and drops it", () =>
		Effect.gen(function* () {
			const { requests, client } = recording((url) =>
				url === START ? { status: 302, location: "http://npm.acme.dev/widget-1.0.0.tgz" } : { status: 200 },
			);
			yield* extractWith(client, published(START), ACME);
			assert.isUndefined(requests[1]?.authorization);
		}),
	);
});

describe("PackageTarball credentials stay Redacted", () => {
	const START = "https://npm.acme.dev/@acme/widget/-/widget-1.0.0.tgz";

	/** Every rendering of a value a log line, an error report or a span exporter would produce. */
	const renderings = (value: unknown): ReadonlyArray<string> => [
		String(value),
		JSON.stringify(value) ?? "",
		inspect(value, { depth: 8 }),
	];

	/**
	 * Every string reachable from `value` through own properties, core
	 * `Headers` included: core redacts `authorization` only when rendering, so
	 * a kept request's headers are exactly where a walking logger finds it.
	 */
	const reachableStrings = (value: unknown, seen = new Set<unknown>()): ReadonlyArray<string> => {
		if (typeof value === "string") return [value];
		if (typeof value !== "object" || value === null || seen.has(value)) return [];
		seen.add(value);
		return Reflect.ownKeys(value).flatMap((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return descriptor !== undefined && "value" in descriptor ? reachableStrings(descriptor.value, seen) : [];
		});
	};

	it.effect("positive control: the walk finds the token on core's own transport error", () =>
		Effect.gen(function* () {
			const { client } = recording(() => "transport");
			const exit = yield* Effect.exit(client.get(START, { headers: { authorization: `Bearer ${REGISTRY_TOKEN}` } }));
			assert.isTrue(
				reachableStrings(exit).some((text) => text.includes(REGISTRY_TOKEN)),
				"core keeps the live request, so the walk below is not passing blind",
			);
		}),
	);

	for (const failure of ["transport", "brokenBody"] as const) {
		it.effect(`a ${failure} failure keeps the request on its cause, minus the token`, () =>
			Effect.gen(function* () {
				const { requests, client } = recording(() => failure);
				const exit = yield* Effect.exit(extractWith(client, published(START), ACME));
				assert.strictEqual(requests[0]?.authorization, `Bearer ${REGISTRY_TOKEN}`, "the credential was really sent");
				if (Exit.isSuccess(exit)) return assert.fail("expected a failure");
				const error = Cause.findErrorOption(exit.cause);
				if (Option.isNone(error)) return assert.fail("expected a typed failure");
				const cause = error.value.cause;
				if (!HttpClientError.isHttpClientError(cause)) return assert.fail("expected the HttpClientError cause");
				assert.strictEqual(cause.request.headers.authorization, "REDACTED");
				assert.include(cause.request.url, "npm.acme.dev");
				for (const text of reachableStrings(error.value)) assert.notInclude(text, REGISTRY_TOKEN);
			}),
		);
	}

	it.effect("never appears in the error, its message, its JSON, its inspection or the pretty cause", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => "transport");
			const exit = yield* Effect.exit(extractWith(client, published(START), ACME));
			assert.strictEqual(requests[0]?.authorization, `Bearer ${REGISTRY_TOKEN}`, "the credential was really sent");
			if (Exit.isSuccess(exit)) return assert.fail("expected a transport failure");
			const error = Cause.findErrorOption(exit.cause);
			if (Option.isNone(error)) return assert.fail("expected a typed failure");
			assert.strictEqual(error.value.reason, "http");
			assert.isDefined(error.value.cause, "the transport cause is preserved, not dropped to hide it");
			for (const rendered of [...renderings(error.value), error.value.message, Cause.pretty(exit.cause)]) {
				assert.notInclude(rendered, REGISTRY_TOKEN);
			}
			const reachable = reachableStrings(error.value);
			assert.isAbove(reachable.length, 0, "the walk reached the error's strings");
			for (const text of reachable) assert.notInclude(text, REGISTRY_TOKEN);
		}),
	);

	it.effect("never appears in a log line or a span, at any level", () =>
		Effect.gen(function* () {
			const lines: Array<string> = [];
			const spans: Array<Tracer.NativeSpan> = [];
			const logger = Logger.make((options) => {
				lines.push(inspect({ message: options.message, cause: options.cause }, { depth: 8 }));
			});
			const tracer = Tracer.make({
				span: (options) => {
					const span = new Tracer.NativeSpan(options);
					spans.push(span);
					return span;
				},
			});
			const { requests, client } = recording(() => ({ status: 200 }));
			// No integrity is published, so `extract` logs at debug: the log
			// capture is live, which the assertion below would otherwise not prove.
			yield* extractWith(client, published(START), ACME).pipe(
				Effect.provide(Logger.layer([logger])),
				Effect.provideService(References.MinimumLogLevel, "All"),
				Effect.provideService(Tracer.Tracer, tracer),
			);
			assert.strictEqual(requests[0]?.authorization, `Bearer ${REGISTRY_TOKEN}`);
			assert.isAbove(lines.length, 0, "the logger saw the debug line, so it was really installed");
			assert.include(
				spans.map((span) => span.name),
				"PackageTarball.extract",
			);
			assert.isAbove(spans.length, 1, "the client span was recorded too");
			for (const line of lines) assert.notInclude(line, REGISTRY_TOKEN);
			for (const span of spans) {
				const exported = inspect(
					{ name: span.name, attributes: [...span.attributes], events: span.events, status: span.status },
					{ depth: 8 },
				);
				assert.notInclude(exported, REGISTRY_TOKEN);
			}
		}),
	);
});
