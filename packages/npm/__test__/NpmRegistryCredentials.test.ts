import { inspect } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import type { RegistryTarget } from "../src/index.js";
import { NpmRegistry } from "../src/index.js";

const TOKEN = "npm_SECRET_registry_read_token_31f7";
const REGISTRY = "https://npm.acme.dev";
const TARGET: RegistryTarget = { registry: REGISTRY, credential: { kind: "token", token: Redacted.make(TOKEN) } };
const VERSION_URL = `${REGISTRY}/%40acme%2Fwidget/1.0.0`;
const MANIFEST = { name: "@acme/widget", version: "1.0.0", dist: { tarball: `${REGISTRY}/w.tgz` } };

type Answer = { readonly status: number; readonly location?: string; readonly raw?: string } | "transport";

/** An `HttpClient` recording every request's URL and `Authorization` header, answering by URL. */
const recording = (respond: (url: string) => Answer) => {
	const requests: Array<{ url: string; authorization: string | undefined }> = [];
	const client = HttpClient.make((request, url) =>
		Effect.suspend(() => {
			requests.push({ url: url.toString(), authorization: request.headers.authorization });
			const answer = respond(url.toString());
			if (answer === "transport") {
				return Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({
							request,
							cause: new TypeError(`fetch failed: ${url.href}`),
						}),
					}),
				);
			}
			return Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					new Response(answer.status === 200 ? (answer.raw ?? JSON.stringify(MANIFEST)) : null, {
						status: answer.status,
						...(answer.location === undefined ? {} : { headers: { location: answer.location } }),
					}),
				),
			);
		}),
	);
	return { requests, client };
};

const readVersion = (client: HttpClient.HttpClient) =>
	Effect.gen(function* () {
		const registry = yield* NpmRegistry;
		return yield* registry.version("@acme/widget", "1.0.0", TARGET);
	}).pipe(Effect.provide(NpmRegistry.layer), Effect.provide(Layer.succeed(HttpClient.HttpClient, client)));

describe("NpmRegistry credentials across redirects", () => {
	it.effect("a cross-host redirect drops the credential", () =>
		Effect.gen(function* () {
			const { requests, client } = recording((url) =>
				url === VERSION_URL ? { status: 302, location: "https://mirror.example/@acme/widget/1.0.0" } : { status: 200 },
			);
			const found = yield* readVersion(client);
			assert.isTrue(Option.isSome(found), "the redirect was followed to a result");
			assert.lengthOf(requests, 2);
			assert.strictEqual(requests[0]?.authorization, `Bearer ${TOKEN}`);
			assert.strictEqual(requests[1]?.url, "https://mirror.example/@acme/widget/1.0.0");
			assert.isUndefined(requests[1]?.authorization);
		}),
	);

	it.effect("a same-origin redirect keeps it (the control: the drop is by origin, not by any redirect)", () =>
		Effect.gen(function* () {
			const { requests, client } = recording((url) =>
				url === VERSION_URL ? { status: 302, location: "/v2/@acme/widget/1.0.0" } : { status: 200 },
			);
			yield* readVersion(client);
			assert.lengthOf(requests, 2);
			assert.strictEqual(requests[1]?.url, `${REGISTRY}/v2/@acme/widget/1.0.0`);
			assert.strictEqual(requests[1]?.authorization, `Bearer ${TOKEN}`);
		}),
	);

	it.effect("a downgrade to http on the same host is another origin, and drops it", () =>
		Effect.gen(function* () {
			const { requests, client } = recording((url) =>
				url === VERSION_URL ? { status: 302, location: "http://npm.acme.dev/@acme/widget/1.0.0" } : { status: 200 },
			);
			yield* readVersion(client);
			assert.lengthOf(requests, 2);
			assert.isUndefined(requests[1]?.authorization);
		}),
	);
});

/** Every string reachable from `value` through own data properties, `Headers` included. */
const reachableStrings = (value: unknown, seen = new Set<unknown>()): ReadonlyArray<string> => {
	if (typeof value === "string") return [value];
	if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return [];
	seen.add(value);
	return Reflect.ownKeys(value).flatMap((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && "value" in descriptor ? reachableStrings(descriptor.value, seen) : [];
	});
};

const failureOf = (client: HttpClient.HttpClient) =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(readVersion(client));
		if (Exit.isSuccess(exit)) return assert.fail("expected the read to fail");
		const error = Cause.findErrorOption(exit.cause);
		if (Option.isNone(error)) return assert.fail("expected a typed failure");
		return error.value;
	});

describe("NpmRegistry keeps no credential on a failure", () => {
	it.effect("positive control: the walk finds a token on core's own error", () =>
		Effect.gen(function* () {
			const { client } = recording(() => "transport");
			const raw = yield* Effect.exit(client.get(VERSION_URL, { headers: { authorization: `Bearer ${TOKEN}` } }));
			assert.isTrue(Exit.isFailure(raw));
			assert.isTrue(
				reachableStrings(raw).some((s) => s.includes(TOKEN)),
				"core keeps the live request",
			);
		}),
	);

	for (const [label, answer] of [
		["transport", "transport"],
		["decode", { status: 200, raw: "{ not json" }],
	] as const) {
		it.effect(`a ${label} failure's cause carries the request, minus the token`, () =>
			Effect.gen(function* () {
				const { requests, client } = recording(() => answer);
				const error = yield* failureOf(client);
				assert.strictEqual(requests[0]?.authorization, `Bearer ${TOKEN}`, "the credential was really sent");
				assert.strictEqual(error.kind, label);
				const cause = error.cause;
				if (!HttpClientError.isHttpClientError(cause)) return assert.fail("expected the HttpClientError cause");
				assert.strictEqual(cause.request.method, "GET");
				assert.include(cause.request.url, "npm.acme.dev");
				assert.strictEqual(cause.request.headers.authorization, "REDACTED");
				const strings = [
					...reachableStrings(error),
					String(error),
					JSON.stringify(error) ?? "",
					inspect(error, { depth: 12, showHidden: true }),
				];
				assert.isAbove(strings.length, 3);
				for (const s of strings) assert.notInclude(s, TOKEN);
			}),
		);
	}
});

describe("RegistryReadError keeps no registry userinfo", () => {
	const PASSWORD = "SECRET_registry_userinfo_password_77aa";
	const WITH_USERINFO = `https://ci:${PASSWORD}@npm.acme.dev`;
	const SHOWN = "https://REDACTED:REDACTED@npm.acme.dev";

	const readFrom = (client: HttpClient.HttpClient, target: RegistryTarget) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.flatMap(NpmRegistry, (registry) => registry.version("@acme/widget", "1.0.0", target)).pipe(
					Effect.provide(NpmRegistry.layer),
					Effect.provide(Layer.succeed(HttpClient.HttpClient, client)),
				),
			);
			if (Exit.isSuccess(exit)) return assert.fail("expected the read to fail");
			const error = Cause.findErrorOption(exit.cause);
			if (Option.isNone(error)) return assert.fail("expected a typed failure");
			return error.value;
		});

	for (const [label, answer] of [
		["transport", "transport"],
		["status", { status: 500 }],
		["decode", { status: 200, raw: "{ not json" }],
	] as const) {
		it.effect(`a ${label} failure names the registry with its userinfo redacted`, () =>
			Effect.gen(function* () {
				const { client } = recording(() => answer);
				const error = yield* readFrom(client, { registry: WITH_USERINFO });
				assert.strictEqual(error.kind, label);
				assert.strictEqual(error.registry, SHOWN);
				assert.include(error.message, "npm.acme.dev");
				for (const s of [...reachableStrings(error), String(error), inspect(error, { depth: 12, showHidden: true })]) {
					assert.notInclude(s, PASSWORD);
				}
			}),
		);
	}

	it.effect("a refused workload credential names the registry with its userinfo redacted", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			// Cast past the type, as the runtime check exists for: the target's
			// credential union refuses a workload credential at compile time.
			const error = yield* readFrom(client, {
				registry: WITH_USERINFO,
				credential: { kind: "workload" },
			} as unknown as RegistryTarget);
			assert.strictEqual(error.kind, "credential");
			assert.lengthOf(requests, 0, "refused before any request");
			assert.strictEqual(error.registry, SHOWN);
		}),
	);
});
