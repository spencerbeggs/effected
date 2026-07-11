/**
 * The `runtime-resolver` command.
 *
 * @packageDocumentation
 */

import type { NodePhase, ResolvedVersions } from "@effected/runtime-resolver";
import {
	BunResolver,
	DenoResolver,
	GitHubAuth,
	GitHubClient,
	NodePhase as NodePhaseSchema,
	NodeResolver,
} from "@effected/runtime-resolver";
import { Console, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import type { CliResponse, CliRuntimeResult } from "./CliResponse.js";
import { CliResponse as CliResponseSchema, serializeError } from "./CliResponse.js";

const SCHEMA_URL =
	"https://raw.githubusercontent.com/spencerbeggs/effected/main/packages/runtime-resolver-cli/runtime-resolver.schema.json";

/**
 * `--node-phases` takes a comma-separated list, which `Flag.choice` cannot
 * express, so it is decoded through the same schema the library uses. v3
 * hand-validated this against a string array and threw a bare `Error`.
 */
const decodePhases = Schema.decodeUnknownEffect(Schema.Array(NodePhaseSchema));

const parsePhases = (raw: string): Effect.Effect<ReadonlyArray<NodePhase>, string> =>
	decodePhases(raw.split(",").map((part) => part.trim())).pipe(
		Effect.mapError(
			() => `Invalid --node-phases value "${raw}". Valid phases: current, active-lts, maintenance-lts, end-of-life.`,
		),
	);

const flags = {
	node: Flag.string("node").pipe(Flag.withDescription("Semver range of Node.js versions to resolve"), Flag.optional),
	bun: Flag.string("bun").pipe(Flag.withDescription("Semver range of Bun versions to resolve"), Flag.optional),
	deno: Flag.string("deno").pipe(Flag.withDescription("Semver range of Deno versions to resolve"), Flag.optional),
	nodePhases: Flag.string("node-phases").pipe(
		Flag.withDescription("Comma-separated Node.js lifecycle phases to accept"),
		Flag.optional,
	),
	// `Flag.choice` validates at parse time, so an invalid value never reaches
	// the handler and the CLI prints a usage error rather than a stack trace.
	increments: Flag.choice("increments", ["latest", "minor", "patch"]).pipe(
		Flag.withDescription("Granularity at which matching versions are grouped"),
		Flag.withDefault("latest" as const),
	),
	nodeDefault: Flag.string("node-default").pipe(
		Flag.withDescription("Range whose newest match becomes the Node.js default"),
		Flag.optional,
	),
	bunDefault: Flag.string("bun-default").pipe(
		Flag.withDescription("Range whose newest match becomes the Bun default"),
		Flag.optional,
	),
	denoDefault: Flag.string("deno-default").pipe(
		Flag.withDescription("Range whose newest match becomes the Deno default"),
		Flag.optional,
	),
	nodeDate: Flag.date("node-date").pipe(
		Flag.withDescription("Evaluate Node.js lifecycle phases at this date instead of now"),
		Flag.optional,
	),
	offline: Flag.boolean("offline").pipe(Flag.withDescription("Use the bundled snapshot only; perform no network IO")),
	pretty: Flag.boolean("pretty").pipe(Flag.withDescription("Indent the JSON output")),
	schema: Flag.boolean("schema").pipe(Flag.withDescription("Print the JSON Schema of the response and exit")),
	token: Flag.redacted("token").pipe(
		Flag.withDescription("GitHub token; overrides GITHUB_PERSONAL_ACCESS_TOKEN and GITHUB_TOKEN"),
		Flag.optional,
	),
};

type Flags = {
	readonly [K in keyof typeof flags]: (typeof flags)[K] extends Flag.Flag<infer A> ? A : never;
};

const toSuccess = (result: ResolvedVersions): CliRuntimeResult => ({
	ok: true as const,
	source: result.source,
	versions: [...result.versions],
	latest: result.latest,
	...(result.lts !== undefined ? { lts: result.lts } : {}),
	...(result.default !== undefined ? { default: result.default } : {}),
});

/**
 * Resolve one runtime, turning its failure into an envelope entry.
 *
 * Each runtime is independent: one failing must not suppress the others, which
 * is what lets a single invocation report Node from the snapshot and Bun as
 * rate-limited in the same response.
 */
const attempt = <E>(resolve: Effect.Effect<ResolvedVersions, E>): Effect.Effect<CliRuntimeResult> =>
	resolve.pipe(
		Effect.map(toSuccess),
		Effect.catch((error) => Effect.succeed({ ok: false as const, error: serializeError(error) })),
	);

/**
 * The `runtime-resolver` command.
 *
 * Exported so it can be embedded, or driven with an explicit argument vector via
 * `Command.runWith` — which is how the suite exercises it, without spawning a
 * process the way the v3 CLI required.
 *
 * @public
 */
export const command = Command.make("runtime-resolver", flags, (args: Flags) =>
	Effect.gen(function* () {
		if (args.schema) {
			const document = Schema.toJsonSchemaDocument(CliResponseSchema);
			return yield* Console.log(JSON.stringify(document, null, 2));
		}

		const wantNode = Option.isSome(args.node);
		const wantBun = Option.isSome(args.bun);
		const wantDeno = Option.isSome(args.deno);

		if (!wantNode && !wantBun && !wantDeno) {
			return yield* Console.error(
				"No runtime specified. Use --node, --bun or --deno to resolve versions.\nRun with --help for usage.",
			);
		}

		const phases = Option.isSome(args.nodePhases)
			? Option.some(
					yield* parsePhases(args.nodePhases.value).pipe(
						Effect.tapError((message) => Console.error(message)),
						Effect.catch(() => Effect.succeed(undefined)),
					),
				)
			: Option.none<ReadonlyArray<NodePhase> | undefined>();

		// A bad --node-phases already printed its own message; stop rather than
		// silently resolving with the default phases the user did not ask for.
		if (Option.isSome(phases) && phases.value === undefined) return;

		// `Flag.choice` already narrowed this to the literal union, so it *is* an
		// `Increments` — no cast, and an invalid value never reached the handler.
		const increments = args.increments;
		const date = Option.map(args.nodeDate, (d) => DateTime.makeUnsafe(d));

		// Auth: an explicit --token beats the environment; otherwise the library's
		// own precedence (PAT, then GITHUB_TOKEN, then anonymous) applies.
		const auth = Option.match(args.token, {
			onNone: () => GitHubAuth.layer,
			onSome: (token) => GitHubAuth.token(Redacted.make(Redacted.value(token))),
		});
		const github = GitHubClient.layer.pipe(Layer.provide(Layer.mergeAll(auth, FetchHttpClient.layer)));

		const nodeLayer = args.offline
			? NodeResolver.layerOffline
			: NodeResolver.layer.pipe(Layer.provide(FetchHttpClient.layer));
		const bunLayer = args.offline ? BunResolver.layerOffline : BunResolver.layer.pipe(Layer.provide(github));
		const denoLayer = args.offline ? DenoResolver.layerOffline : DenoResolver.layer.pipe(Layer.provide(github));

		const tasks: Array<Effect.Effect<readonly [string, CliRuntimeResult]>> = [];

		if (wantNode) {
			const range = args.node.value;
			tasks.push(
				attempt(
					Effect.gen(function* () {
						const resolver = yield* NodeResolver;
						return yield* resolver.resolve({
							range,
							increments,
							...(Option.isSome(phases) && phases.value !== undefined ? { phases: phases.value } : {}),
							...(Option.isSome(args.nodeDefault) ? { defaultVersion: args.nodeDefault.value } : {}),
							...(Option.isSome(date) ? { date: date.value } : {}),
						});
					}).pipe(Effect.provide(nodeLayer)),
				).pipe(Effect.map((result) => ["node", result] as const)),
			);
		}

		if (wantBun) {
			const range = args.bun.value;
			tasks.push(
				attempt(
					Effect.gen(function* () {
						const resolver = yield* BunResolver;
						return yield* resolver.resolve({
							range,
							increments,
							...(Option.isSome(args.bunDefault) ? { defaultVersion: args.bunDefault.value } : {}),
						});
					}).pipe(Effect.provide(bunLayer)),
				).pipe(Effect.map((result) => ["bun", result] as const)),
			);
		}

		if (wantDeno) {
			const range = args.deno.value;
			tasks.push(
				attempt(
					Effect.gen(function* () {
						const resolver = yield* DenoResolver;
						return yield* resolver.resolve({
							range,
							increments,
							...(Option.isSome(args.denoDefault) ? { defaultVersion: args.denoDefault.value } : {}),
						});
					}).pipe(Effect.provide(denoLayer)),
				).pipe(Effect.map((result) => ["deno", result] as const)),
			);
		}

		const entries = yield* Effect.all(tasks, { concurrency: "unbounded" });
		const results = Object.fromEntries(entries);
		const response: CliResponse & { readonly $schema: string } = {
			$schema: SCHEMA_URL,
			ok: entries.every(([, result]) => result.ok),
			results,
		};

		yield* Console.log(JSON.stringify(response, null, args.pretty ? 2 : undefined));
	}),
);
