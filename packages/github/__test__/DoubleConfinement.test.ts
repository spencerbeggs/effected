import { assert, describe, it } from "@effect/vitest";
import type { Layer } from "effect";
import { Effect, Schema, Stream } from "effect";
import type { RecordedCall } from "../src/GitHubClient.js";
import { GitHubClient } from "../src/GitHubClient.js";
import { GitHubError } from "../src/GitHubError.js";

// The shipped doubles refuse what the live client refuses. A double sends
// nothing, so without these checks a consumer's suite on one passed calls that
// production fails `rejected` — and never learned it. Each refusal is asserted
// on each double, with the double's own handler or fixture proven untouched.

const Anything = Schema.Unknown;
const COORDS = { owner: "acme", repo: "widget" } as const;
const PULLS = "GET /repos/{owner}/{repo}/pulls";

/** The four raw members, each called with `route` and `params`. */
const rawMembers = (
	route: string,
	params: Record<string, unknown>,
): ReadonlyArray<readonly [string, (client: GitHubClient["Service"]) => Effect.Effect<unknown, GitHubError>]> => [
	["request", (client) => client.request(route as "GET /repos/{owner}/{repo}", params as never)],
	["requestDecoded", (client) => client.requestDecoded(route, params, Anything)],
	["paginate", (client) => client.paginate(route as typeof PULLS, params as never)],
	["paginateStream", (client) => Stream.runCollect(client.paginateStream(route as typeof PULLS, params as never))],
];

/** A double that answers every raw member and counts how often it was reached. */
interface Double {
	readonly name: string;
	readonly make: () => { readonly layer: Layer.Layer<GitHubClient>; readonly reached: () => number };
}

const doubles: ReadonlyArray<Double> = [
	{
		name: "makeTest",
		make: () => {
			let reached = 0;
			const hit = <A>(value: A) =>
				Effect.sync(() => {
					reached += 1;
					return value;
				});
			const layer = GitHubClient.layerTest({
				request: () => hit({}) as never,
				requestDecoded: () => hit({}) as never,
				paginate: () => hit([]) as never,
				paginateStream: () => Stream.fromEffect(hit(0)).pipe(Stream.drain) as never,
			});
			return { layer, reached: () => reached };
		},
	},
	{
		name: "layerFixture",
		make: () => {
			const requested: Array<RecordedCall> = [];
			// unstubbed "empty" answers every route, so only a refusal can fail.
			const layer = GitHubClient.layerFixture({ unstubbed: "empty", requested });
			return { layer, reached: () => requested.length };
		},
	},
];

/** Run `call` on a fresh `double`; assert it failed `rejected`, unreached. */
const assertRefused = (
	double: Double,
	call: (client: GitHubClient["Service"]) => Effect.Effect<unknown, GitHubError>,
	label: string,
) =>
	Effect.gen(function* () {
		const { layer, reached } = double.make();
		const error = yield* Effect.flip(Effect.flatMap(GitHubClient, call)).pipe(Effect.provide(layer));
		assert.instanceOf(error, GitHubError, label);
		assert.strictEqual(error.kind, "rejected", label);
		assert.isUndefined(error.status, label);
		assert.strictEqual(reached(), 0, `${label}: the double's handler must not be reached`);
		return error;
	});

/** Run `call` on a fresh `double`; assert it succeeded and reached the double. */
const assertServed = (
	double: Double,
	call: (client: GitHubClient["Service"]) => Effect.Effect<unknown, GitHubError>,
	label: string,
) =>
	Effect.gen(function* () {
		const { layer, reached } = double.make();
		yield* Effect.flatMap(GitHubClient, call).pipe(Effect.provide(layer));
		assert.strictEqual(reached(), 1, `${label}: the double served the call`);
	});

describe("the shipped doubles keep the live client's confinement", () => {
	it.effect("control: a plain call on every raw member reaches each double", () =>
		Effect.gen(function* () {
			for (const double of doubles) {
				for (const [member, call] of rawMembers(PULLS, COORDS)) {
					yield* assertServed(double, call, `${double.name} ${member}`);
				}
			}
		}),
	);

	it.effect("a baseUrl, url, request or method parameter is refused on every raw member", () =>
		Effect.gen(function* () {
			const hostile: ReadonlyArray<readonly [string, unknown]> = [
				["baseUrl", "https://attacker.example"],
				["url", "https://attacker.example/steal"],
				["request", { fetch: () => Promise.reject(new Error("swapped fetch")) }],
				["method", "DELETE"],
			];
			for (const double of doubles) {
				for (const [key, value] of hostile) {
					for (const [member, call] of rawMembers(PULLS, { ...COORDS, [key]: value })) {
						const label = `${double.name} ${member} ${key}`;
						const error = yield* assertRefused(double, call, label);
						assert.include(error.reason, `"${key}"`, label);
					}
				}
			}
		}),
	);

	it.effect("a top-level url body field is refused, and the same field inside data is served", () =>
		Effect.gen(function* () {
			const config = { url: "https://hooks.example/receive", content_type: "json" };
			for (const double of doubles) {
				const label = `${double.name} webhook`;
				const error = yield* assertRefused(
					double,
					(client) => client.requestDecoded("POST /repos/{owner}/{repo}/hooks", { ...COORDS, ...config }, Anything),
					label,
				);
				assert.include(error.reason, "inside data", label);
				yield* assertServed(
					double,
					(client) =>
						client.requestDecoded("POST /repos/{owner}/{repo}/hooks", { ...COORDS, data: { config } }, Anything),
					`${label} control`,
				);
			}
		}),
	);

	it.effect("a route resolving off github.com's REST root is refused on every raw member", () =>
		Effect.gen(function* () {
			const routes = [
				"GET https://attacker.example/repos/{owner}/{repo}/pulls",
				"https://attacker.example/repos/{owner}/{repo}/pulls",
				"GET {+target}",
				"GET .attacker.example/x",
				"POST https://uploads.github.com/repos/acme/widget/releases/5/assets",
			];
			for (const double of doubles) {
				for (const route of routes) {
					for (const [member, call] of rawMembers(route, { ...COORDS, target: "https://attacker.example/x" })) {
						const label = `${double.name} ${member} ${route}`;
						const error = yield* assertRefused(double, call, label);
						assert.include(error.reason, "not the configured host https://api.github.com", label);
					}
				}
			}
		}),
	);

	it.effect("control: an absolute route on api.github.com is served", () =>
		Effect.gen(function* () {
			for (const double of doubles) {
				yield* assertServed(
					double,
					(client) => client.requestDecoded("GET https://api.github.com/repos/acme/widget", {}, Anything),
					double.name,
				);
			}
		}),
	);

	it.effect("a refusal is the live client's: the operation is the route, the reason names the key", () =>
		Effect.gen(function* () {
			const error = yield* assertRefused(
				doubles[0] as Double,
				(client) => client.request("GET /repos/{owner}/{repo}", { ...COORDS, baseUrl: "https://x.example" } as never),
				"operation",
			);
			assert.strictEqual(error.operation, "GET /repos/{owner}/{repo}");
			assert.strictEqual(
				error.reason,
				'the parameter "baseUrl" is an octokit request option the raw surface does not accept',
			);
		}),
	);
});
