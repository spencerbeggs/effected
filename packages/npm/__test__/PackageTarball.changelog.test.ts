import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { PackageTarball } from "../src/index.js";
import { MAX_ARCHIVE_BYTES, gunzip, tarEntryText } from "../src/internal/tarEntry.js";

const encoder = new TextEncoder();

/** One tar header block for a regular file, built by hand. */
const header = (name: string, size: number, type = "0", prefix = ""): Uint8Array => {
	const block = new Uint8Array(512);
	block.set(encoder.encode(name), 0);
	block.set(encoder.encode(`${size.toString(8).padStart(11, "0")}\0`), 124);
	block[156] = type.charCodeAt(0);
	block.set(encoder.encode("ustar\0"), 257);
	block.set(encoder.encode(prefix), 345);
	return block;
};

const entry = (name: string, text: string, prefix = ""): Array<Uint8Array> => {
	const data = encoder.encode(text);
	const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
	padded.set(data);
	return [header(name, data.length, "0", prefix), padded];
};

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
};

const tar = (...entries: ReadonlyArray<Array<Uint8Array>>): Uint8Array =>
	concat([...entries.flat(), new Uint8Array(1024)]);

const gzip = async (bytes: Uint8Array): Promise<Uint8Array> =>
	new Uint8Array(
		await new Response(
			new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("gzip")),
		).arrayBuffer(),
	);

const REGISTRY = "https://registry.test";
const TARBALL = `${REGISTRY}/pkg/-/pkg-1.0.0.tgz`;

interface Seen {
	readonly url: string;
	readonly authorization: string | undefined;
}

/** A registry: the version document at `/pkg/1.0.0`, the tarball wherever the document says. */
const registry = (options: {
	readonly tarball?: Uint8Array | number | "transport";
	readonly tarballUrl?: string;
	readonly published?: boolean;
}) => {
	const seen: Array<Seen> = [];
	const layer = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) => {
			seen.push({ url: request.url, authorization: request.headers.authorization });
			const reply = (body: string | Uint8Array<ArrayBuffer>, status = 200) =>
				Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status })));
			if (request.url === `${REGISTRY}/pkg/1.0.0`) {
				return options.published === false
					? reply("{}", 404)
					: reply(
							JSON.stringify({
								name: "pkg",
								version: "1.0.0",
								dist: { tarball: options.tarballUrl ?? TARBALL },
							}),
						);
			}
			const tarball = options.tarball;
			if (tarball === "transport") {
				return Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({ request, cause: new Error("ECONNRESET") }),
					}),
				);
			}
			if (typeof tarball === "number") return reply("nope", tarball);
			return reply((tarball ?? new Uint8Array()) as Uint8Array<ArrayBuffer>);
		}),
	);
	return { layer, seen };
};

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>, layer: Layer.Layer<HttpClient.HttpClient>) =>
	effect.pipe(Effect.provide(layer));

const changelog = PackageTarball.changelog({ registry: REGISTRY }, "pkg", "1.0.0");

describe("PackageTarball.changelog", () => {
	it.effect("reads package/CHANGELOG.md from a published tarball", () =>
		Effect.gen(function* () {
			const bytes = yield* Effect.promise(() =>
				gzip(tar(entry("package/package.json", "{}"), entry("package/CHANGELOG.md", "# pkg\n\n## 1.0.0\n"))),
			);
			const found = yield* run(changelog, registry({ tarball: bytes }).layer);
			assert.deepStrictEqual(found, Option.some("# pkg\n\n## 1.0.0\n"));
		}),
	);

	it.effect("answers None for a tarball without a changelog", () =>
		Effect.gen(function* () {
			const bytes = yield* Effect.promise(() => gzip(tar(entry("package/package.json", "{}"))));
			assert.isTrue(Option.isNone(yield* run(changelog, registry({ tarball: bytes }).layer)));
		}),
	);

	it.effect("matches the path exactly: another case or a nested file is no changelog", () =>
		Effect.gen(function* () {
			const bytes = yield* Effect.promise(() =>
				gzip(tar(entry("package/changelog.md", "lower"), entry("package/docs/CHANGELOG.md", "nested"))),
			);
			assert.isTrue(Option.isNone(yield* run(changelog, registry({ tarball: bytes }).layer)));
		}),
	);

	it.effect("answers None for an unpublished version and for a tarball that 404s", () =>
		Effect.gen(function* () {
			assert.isTrue(Option.isNone(yield* run(changelog, registry({ published: false }).layer)));
			assert.isTrue(Option.isNone(yield* run(changelog, registry({ tarball: 404 }).layer)));
		}),
	);

	it.effect("fails RegistryReadError for a transport failure, a 500 and a corrupt archive", () =>
		Effect.gen(function* () {
			const transport = yield* Effect.flip(run(changelog, registry({ tarball: "transport" }).layer));
			assert.strictEqual(transport.kind, "transport");
			const status = yield* Effect.flip(run(changelog, registry({ tarball: 500 }).layer));
			assert.strictEqual(status.kind, "status");
			assert.strictEqual(status.status, 500);
			const corrupt = yield* Effect.flip(
				run(changelog, registry({ tarball: Uint8Array.of(0x1f, 0x8b, 1, 2, 3, 4, 5) }).layer),
			);
			assert.strictEqual(corrupt.kind, "decode");
		}),
	);

	it.effect("sends the credential to the tarball only on the registry's own origin", () =>
		Effect.gen(function* () {
			const bytes = yield* Effect.promise(() => gzip(tar(entry("package/CHANGELOG.md", "x"))));
			const credential = { kind: "token", token: Redacted.make("secret") } as const;
			const same = registry({ tarball: bytes });
			yield* run(PackageTarball.changelog({ registry: REGISTRY, credential }, "pkg", "1.0.0"), same.layer);
			assert.strictEqual(same.seen[1]?.authorization, "Bearer secret");
			const other = registry({ tarball: bytes, tarballUrl: "https://cdn.test/pkg.tgz" });
			yield* run(PackageTarball.changelog({ registry: REGISTRY, credential }, "pkg", "1.0.0"), other.layer);
			assert.strictEqual(other.seen[1]?.url, "https://cdn.test/pkg.tgz");
			assert.strictEqual(other.seen[1]?.authorization, undefined);
		}),
	);
});

describe("tar reading, hardened", () => {
	it("stops inflating at the cap instead of holding a bomb", async () => {
		const bomb = await gzip(new Uint8Array(1024 * 1024));
		const result = await gunzip(bomb, 64 * 1024);
		assert.isTrue(Result.isFailure(result) && result.failure === "oversize");
		assert.isTrue(Result.isSuccess(await gunzip(bomb, 2 * 1024 * 1024)));
		assert.isAbove(MAX_ARCHIVE_BYTES, 0);
	});

	it("reports a truncated entry and a size it cannot take as malformed, never a throw", () => {
		const truncated = concat([header("package/CHANGELOG.md", 5000)]);
		const a = tarEntryText(truncated, "package/CHANGELOG.md");
		assert.isTrue(Result.isFailure(a) && a.failure === "malformed");
		const junk = header("package/CHANGELOG.md", 0);
		junk.set(encoder.encode("zzzzzzzzzzz\0"), 124);
		const b = tarEntryText(concat([junk, new Uint8Array(1024)]), "package/CHANGELOG.md");
		assert.isTrue(Result.isFailure(b) && b.failure === "malformed");
	});

	it("joins a ustar prefix and reads a pax path override", () => {
		const prefixed = tarEntryText(tar(entry("CHANGELOG.md", "p", "package")), "package/CHANGELOG.md");
		assert.deepStrictEqual(prefixed, Result.succeed(Option.some("p")));
		const pax = "29 path=package/CHANGELOG.md\n";
		const data = encoder.encode(pax);
		const padded = new Uint8Array(512);
		padded.set(data);
		const withPax = tar([header("PaxHeader", data.length, "x"), padded], entry("short", "long"));
		assert.deepStrictEqual(tarEntryText(withPax, "package/CHANGELOG.md"), Result.succeed(Option.some("long")));
	});
});
