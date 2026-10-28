import { inspect } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import { GitHubClient } from "../src/GitHubClient.js";
import { GitHubError } from "../src/GitHubError.js";
import { GitHubGraphQLError, GraphQLDocument } from "../src/GraphQL.js";
import type { Reply } from "./fixtures.js";
import { scriptedFetch } from "./fixtures.js";

/**
 * Every string reachable from `value` through own data properties,
 * non-enumerable ones included: the walk a custom logger or serializer does.
 */
const reachableStrings = (value: unknown, seen = new Set<unknown>()): ReadonlyArray<string> => {
	if (typeof value === "string") return [value];
	if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return [];
	seen.add(value);
	return Reflect.ownKeys(value).flatMap((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && "value" in descriptor ? reachableStrings(descriptor.value, seen) : [];
	});
};

/** Every string a walk, `String`, `JSON.stringify` or `util.inspect` can see on `value`. */
const visibleStrings = (value: unknown): ReadonlyArray<string> => [
	...reachableStrings(value),
	String(value),
	JSON.stringify(value) ?? "",
	inspect(value, { depth: 12, showHidden: true }),
];

const assertNoSecret = (value: unknown, secrets: ReadonlyArray<string>): void => {
	const strings = visibleStrings(value);
	assert.isAbove(strings.length, 4, "the walk reached the error's strings");
	for (const secret of secrets) for (const s of strings) assert.notInclude(s, secret);
};

const TOKEN = "ghs_SECRET_request_token_4b4b";
const HOOK_SECRET = "SECRET_webhook_config_secret_8d8d";
const COOKIE = "SECRET_response_cookie_2e2e";
const VARIABLE = "SECRET_graphql_variable_6f6f";

/** The client under test, over octokit's real transport and a scripted `fetch`. */
const withClient = <A, E>(
	replies: ReadonlyArray<Reply>,
	use: (client: GitHubClient["Service"]) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
	Effect.provide(
		Effect.flatMap(GitHubClient, use),
		GitHubClient.layerFromToken({ token: Redacted.make(TOKEN), fetch: scriptedFetch(replies).fetch, retry: "off" }),
	);

const REFUSED: Reply = {
	status: 422,
	headers: { "set-cookie": `_gh_sess=${COOKIE}; Path=/`, "x-github-request-id": "ABCD:1234" },
	body: {
		message: "Validation Failed",
		documentation_url: "https://docs.github.com/rest/repos/webhooks#create-a-repository-webhook",
		errors: [{ resource: "Hook", field: "config", code: "invalid", message: "url is not reachable" }],
	},
};

const createHook = (client: GitHubClient["Service"]) =>
	client.request("POST /repos/{owner}/{repo}/hooks", {
		owner: "o",
		repo: "r",
		config: { url: "https://hooks.example/in", secret: HOOK_SECRET },
	});

describe("the positive control", () => {
	it.effect("octokit's own RequestError keeps the request body and the response cookie", () =>
		Effect.gen(function* () {
			// Classify a REAL RequestError with the classifier bypassed: the raw
			// throwable is what `fromOctokit` used to keep, and the walk must see
			// the planted secrets on it, or the assertions below prove nothing.
			const { fetch } = scriptedFetch([REFUSED]);
			const { Octokit } = yield* Effect.promise(() => import("@octokit/core"));
			const raw = yield* Effect.promise(() =>
				new Octokit({ auth: TOKEN, request: { fetch } })
					.request("POST /repos/{owner}/{repo}/hooks", {
						owner: "o",
						repo: "r",
						config: { url: "https://hooks.example/in", secret: HOOK_SECRET },
					})
					.then(
						() => undefined,
						(error: unknown) => error,
					),
			);
			const strings = reachableStrings(raw);
			assert.isTrue(
				strings.some((s) => s.includes(HOOK_SECRET)),
				"the raw request body keeps the webhook secret",
			);
			assert.isTrue(
				strings.some((s) => s.includes(COOKIE)),
				"the raw response headers keep set-cookie",
			);
		}),
	);
});

describe("GitHubError.fromOctokit keeps a credential-free cause", () => {
	it.effect("a refused write: the cause keeps the status, url and request id, and no credential", () =>
		withClient([REFUSED], (client) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(createHook(client));
				assert.instanceOf(error, GitHubError);
				assert.strictEqual(error.kind, "rejected");
				assert.strictEqual(error.validation?.[0]?.code, "invalid", "the facts were read off the original");
				const cause = error.cause as {
					readonly name?: string;
					readonly status?: number;
					readonly request?: {
						readonly method?: string;
						readonly url?: string;
						readonly headers?: Record<string, unknown>;
					};
					readonly response?: { readonly headers?: Record<string, unknown>; readonly data?: Record<string, unknown> };
				};
				assert.isTrue(cause instanceof Error, "the copy is still an Error");
				assert.strictEqual(cause.name, "HttpError");
				assert.strictEqual(cause.status, 422);
				assert.strictEqual(cause.request?.method, "POST");
				assert.strictEqual(cause.request?.url, "https://api.github.com/repos/o/r/hooks");
				assert.strictEqual(cause.request?.headers?.authorization, "REDACTED");
				assert.isFalse("body" in (cause.request ?? {}), "the request body is gone");
				assert.strictEqual(cause.response?.headers?.["x-github-request-id"], "ABCD:1234");
				assert.isFalse("set-cookie" in (cause.response?.headers ?? {}));
				assert.strictEqual(cause.response?.data?.message, "Validation Failed");
				assert.include(String(cause.response?.data?.documentation_url), "docs.github.com");
				assertNoSecret(error, [TOKEN, HOOK_SECRET, COOKIE]);
			}),
		),
	);

	it("a throwable with no request, response or headers is kept as it is", () => {
		const original = { name: "AbortError", message: "aborted" };
		assert.strictEqual(GitHubError.fromOctokit("x", original, 0).cause, original);
	});
});

describe("GitHubGraphQLError.fromThrowable keeps a credential-free cause", () => {
	const Lookup = GraphQLDocument.make({
		name: "lookup",
		document: "query ($owner: String!) { repositoryOwner(login: $owner) { login } }",
		response: Schema.Struct({ repositoryOwner: Schema.Struct({ login: Schema.String }) }),
	})<Record<string, unknown>>();

	for (const [label, reply] of [
		[
			"an HTTP failure",
			{ status: 502, headers: { "set-cookie": `_gh_sess=${COOKIE}` }, body: { message: "Bad gateway" } },
		],
		[
			"a 200 carrying errors",
			{
				status: 200,
				headers: { "set-cookie": `_gh_sess=${COOKIE}` },
				body: { data: { leaked: VARIABLE }, errors: [{ message: "Could not resolve to a User" }] },
			},
		],
	] as const satisfies ReadonlyArray<readonly [string, Reply]>) {
		it.effect(`${label}: neither the variables, the cookie nor the token survive`, () =>
			withClient([reply], (client) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(client.graphql(Lookup, { owner: VARIABLE }));
					assert.instanceOf(error, GitHubGraphQLError);
					assert.isDefined(error.cause, "a cause is kept");
					assertNoSecret(error, [TOKEN, VARIABLE, COOKIE]);
				}),
			),
		);
	}
});
