import { assert, describe, it } from "@effect/vitest";
import type { Layer } from "effect";
import { Effect, Redacted, Schema, Stream } from "effect";
import type { GitHubClientOptions } from "../src/GitHubClient.js";
import { GitHubClient } from "../src/GitHubClient.js";
import { GitHubError } from "../src/GitHubError.js";
import { RetryPolicy } from "../src/Resilience.js";
import type { Reply, ScriptedFetch } from "./fixtures.js";
import { linkNext, scriptedFetch } from "./fixtures.js";

// A client's token goes to the host it was configured with and nowhere else.
// Every test here drives the REAL octokit client over a scripted fetch and reads
// what reached the wire: a refusal is only proven by zero calls.

const live = (script: ScriptedFetch, options: Partial<GitHubClientOptions> = {}): Layer.Layer<GitHubClient> =>
	GitHubClient.layerFromToken({
		token: Redacted.make("ghs_secret"),
		fetch: script.fetch,
		retry: RetryPolicy.none,
		...options,
	});

const withClient = <A, E>(
	replies: ReadonlyArray<Reply>,
	body: (client: GitHubClient["Service"], script: ScriptedFetch) => Effect.Effect<A, E>,
	options: Partial<GitHubClientOptions> = {},
) => {
	const script = scriptedFetch(replies);
	return Effect.flatMap(GitHubClient, (client) => body(client, script)).pipe(Effect.provide(live(script, options)));
};

const Anything = Schema.Unknown;
const COORDS = { owner: "acme", repo: "widget" } as const;

/** Assert `error` is the refusal: `rejected`, no status, nothing on the wire. */
const assertRefused = (error: unknown, script: ScriptedFetch, label: string): void => {
	assert.instanceOf(error, GitHubError, label);
	assert.strictEqual((error as GitHubError).kind, "rejected", label);
	assert.isUndefined((error as GitHubError).status, label);
	assert.strictEqual(script.count(), 0, `${label}: nothing may reach the wire`);
};

/** The four raw members, each called with `route` and `params`. */
const rawMembers = (
	route: string,
	params: Record<string, unknown>,
): ReadonlyArray<readonly [string, (client: GitHubClient["Service"]) => Effect.Effect<unknown, GitHubError>]> => [
	["request", (client) => client.request(route as "GET /repos/{owner}/{repo}", params as never)],
	["requestDecoded", (client) => client.requestDecoded(route, params, Anything)],
	["paginate", (client) => client.paginate(route as "GET /repos/{owner}/{repo}/pulls", params as never)],
	[
		"paginateStream",
		(client) => Stream.runCollect(client.paginateStream(route as "GET /repos/{owner}/{repo}/pulls", params as never)),
	],
];

describe("the raw surface keeps the token on the configured base", () => {
	it("a literal baseUrl is a compile error on every raw member", () => {
		// Never run: the assertions are the @ts-expect-error lines, which fail the
		// typecheck if passing a baseUrl ever compiles again.
		const typeOnly = (client: GitHubClient["Service"]) => [
			// @ts-expect-error baseUrl is not a request parameter
			client.request("GET /repos/{owner}/{repo}", { ...COORDS, baseUrl: "https://attacker.example" }),
			// @ts-expect-error baseUrl is not a request parameter
			client.requestDecoded("GET /x", { baseUrl: "https://attacker.example" }, Anything),
			// @ts-expect-error baseUrl is not a request parameter
			client.paginate("GET /repos/{owner}/{repo}/pulls", { ...COORDS, baseUrl: "https://attacker.example" }),
			// @ts-expect-error baseUrl is not a request parameter
			client.paginateStream("GET /repos/{owner}/{repo}/pulls", { ...COORDS, baseUrl: "https://attacker.example" }),
		];
		assert.isFunction(typeOnly);
	});

	it.effect("a baseUrl that arrives through a cast is refused with zero calls", () =>
		Effect.gen(function* () {
			for (const [member, call] of rawMembers("GET /repos/{owner}/{repo}/pulls", {
				...COORDS,
				baseUrl: "https://attacker.example",
			})) {
				yield* withClient([{ status: 200, body: [] }], (client, script) =>
					Effect.flip(call(client)).pipe(
						Effect.map((error) => {
							assertRefused(error, script, member);
							assert.include(error.reason, '"baseUrl"', member);
							return error;
						}),
					),
				);
			}
		}),
	);

	it.effect("a url, request or method parameter through a cast is refused with zero calls", () =>
		Effect.gen(function* () {
			const hostile: ReadonlyArray<readonly [string, unknown]> = [
				["url", "https://attacker.example/steal"],
				["request", { fetch: () => Promise.reject(new Error("swapped fetch")) }],
				["method", "DELETE"],
			];
			for (const [key, value] of hostile) {
				for (const [member, call] of rawMembers("GET /repos/{owner}/{repo}/pulls", { ...COORDS, [key]: value })) {
					yield* withClient([{ status: 200, body: [] }], (client, script) =>
						Effect.flip(call(client)).pipe(
							Effect.map((error) => {
								assertRefused(error, script, `${member} ${key}`);
								assert.include(error.reason, `"${key}"`, `${member} ${key}`);
								return error;
							}),
						),
					);
				}
			}
		}),
	);

	it.effect("an absolute-URL route on another host is refused with zero calls on every raw member", () =>
		Effect.gen(function* () {
			const routes = [
				"GET https://attacker.example/repos/{owner}/{repo}/pulls",
				// No method: octokit reads the whole string as the URL.
				"https://attacker.example/repos/{owner}/{repo}/pulls",
				// A template that expands to an absolute URL.
				"GET {+target}",
				// A host built by concatenation with the configured base.
				"GET .attacker.example/x",
			];
			for (const route of routes) {
				for (const [member, call] of rawMembers(route, { ...COORDS, target: "https://attacker.example/x" })) {
					yield* withClient([{ status: 200, body: [] }], (client, script) =>
						Effect.flip(call(client)).pipe(Effect.map((error) => assertRefused(error, script, `${member} ${route}`))),
					);
				}
			}
		}),
	);

	it.effect("a GitHub Enterprise client refuses a route aimed at github.com", () =>
		withClient(
			[{ status: 200, body: {} }],
			(client, script) =>
				Effect.flip(
					client.requestDecoded("POST https://uploads.github.com/repos/acme/widget/releases/5/assets", {}, Anything),
				).pipe(Effect.map((error) => assertRefused(error, script, "GHES to github.com"))),
			{ baseUrl: "https://ghe.example/api/v3" },
		),
	);

	it.effect("the public surface cannot reach github.com's upload host; only uploadAsset's private channel can", () =>
		withClient([{ status: 201, body: {} }], (client, script) =>
			Effect.flip(
				client.requestDecoded(
					"POST https://uploads.github.com/repos/acme/widget/releases/5/assets{?name}",
					{ name: "app.zip", data: "bytes" },
					Anything,
				),
			).pipe(Effect.map((error) => assertRefused(error, script, "dotcom to uploads.github.com"))),
		),
	);

	it.effect("control: an absolute route on the configured host is sent", () =>
		withClient([{ status: 200, body: { id: 1 } }], (client, script) =>
			Effect.gen(function* () {
				yield* client.requestDecoded("GET https://api.github.com/repos/acme/widget", {}, Anything);
				assert.strictEqual(script.count(), 1);
				assert.strictEqual(new URL(script.calls[0]?.url ?? "").origin, "https://api.github.com");
				assert.strictEqual(script.calls[0]?.headers.authorization, "token ghs_secret");
			}),
		),
	);

	it.effect("control: a relative route is sent to a GitHub Enterprise client's own host", () =>
		withClient(
			[{ status: 200, body: { id: 1 } }],
			(client, script) =>
				Effect.gen(function* () {
					yield* client.request("GET /repos/{owner}/{repo}", COORDS);
					assert.strictEqual(script.count(), 1);
					assert.strictEqual(script.calls[0]?.url, "https://ghe.example/api/v3/repos/acme/widget");
				}),
			{ baseUrl: "https://ghe.example/api/v3" },
		),
	);
});

describe("pagination keeps the token on the configured base", () => {
	const page = (numbers: ReadonlyArray<number>, next?: string): Reply => ({
		status: 200,
		body: numbers.map((number) => ({ number })),
		...(next !== undefined ? { headers: linkNext(next) } : {}),
	});

	it.effect("a Link next page on another origin fails the walk before it is requested", () =>
		Effect.gen(function* () {
			for (const [member, walk] of [
				["paginate", (client: GitHubClient["Service"]) => client.paginate("GET /repos/{owner}/{repo}/pulls", COORDS)],
				[
					"paginateStream",
					(client: GitHubClient["Service"]) =>
						Stream.runCollect(client.paginateStream("GET /repos/{owner}/{repo}/pulls", COORDS)),
				],
			] as const) {
				yield* withClient(
					[page([1, 2], "https://attacker.example/repositories/1/pulls?page=2"), page([3])],
					(client, script) =>
						Effect.gen(function* () {
							const error = yield* Effect.flip(walk(client));
							assert.instanceOf(error, GitHubError, member);
							assert.strictEqual(error.kind, "rejected", member);
							assert.include(error.reason, "https://attacker.example", member);
							// The first page went to GitHub; the hostile one went nowhere.
							assert.strictEqual(script.count(), 1, member);
							assert.isFalse(
								script.calls.some((call) => new URL(call.url).origin === "https://attacker.example"),
								member,
							);
						}),
				);
			}
		}),
	);

	it.effect("a GitHub Enterprise walk refuses a Link next page on github.com", () =>
		withClient(
			[page([1], "https://api.github.com/repositories/1/pulls?page=2"), page([2])],
			(client, script) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(client.paginate("GET /repos/{owner}/{repo}/pulls", COORDS));
					assert.strictEqual(error.kind, "rejected");
					assert.strictEqual(script.count(), 1);
					assert.strictEqual(new URL(script.calls[0]?.url ?? "").origin, "https://ghe.example");
				}),
			{ baseUrl: "https://ghe.example/api/v3" },
		),
	);

	it.effect("control: a Link next page on the configured host is followed", () =>
		withClient([page([1, 2], "https://api.github.com/repositories/1/pulls?page=2"), page([3])], (client, script) =>
			Effect.gen(function* () {
				const pulls = yield* client.paginate("GET /repos/{owner}/{repo}/pulls", COORDS);
				assert.deepStrictEqual(
					pulls.map((pull) => pull.number),
					[1, 2, 3],
				);
				assert.strictEqual(script.count(), 2);
				assert.strictEqual(script.calls[1]?.headers.authorization, "token ghs_secret");
			}),
		),
	);
});
