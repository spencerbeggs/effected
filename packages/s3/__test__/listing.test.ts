import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { S3Client } from "../src/S3Client.js";
import type { S3ListPage } from "../src/S3ListPage.js";
import { fakeS3 } from "./utils/fake-s3.js";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/listing");
const FIXTURES = readdirSync(DIR)
	.filter((name) => name !== "README.md")
	.sort();

/** A `list` against a store that answers `200` with `body`, whatever the request. */
const listWith = (body: string | Uint8Array) => {
	const store = fakeS3((request, key) =>
		key === undefined && request.method === "GET" ? new Response(body, { status: 200 }) : undefined,
	);
	return Effect.gen(function* () {
		const s3 = yield* S3Client;
		return yield* Effect.result(s3.list());
	}).pipe(Effect.provide(store.layer()));
};

type Outcome =
	| { readonly ok: (page: S3ListPage) => void }
	| { readonly fails: "S3MalformedResponse"; readonly received?: string; readonly hasCause?: boolean }
	| { readonly fails: "S3RequestFailed"; readonly code: string };

const malformed = (received?: string, hasCause?: boolean): Outcome => ({
	fails: "S3MalformedResponse",
	...(received === undefined ? {} : { received }),
	...(hasCause === undefined ? {} : { hasCause }),
});

const OUTCOMES: Readonly<Record<string, Outcome>> = {
	"aws-page.xml": {
		ok: (page) => {
			assert.deepStrictEqual(
				page.keys.map((entry) => [entry.key, entry.size, entry.etag, entry.storageClass]),
				[
					["photos/2006/January/sample.jpg", 142863, '"bf1d737a4d46a19f3bced6905cc8b902"', "STANDARD"],
					["photos/2006/February/sample.jpg", 0, '"bf1d737a4d46a19f3bced6905cc8b903"', "GLACIER"],
				],
			);
			assert.strictEqual(
				DateTime.formatIso(page.keys[0]?.lastModified ?? DateTime.makeUnsafe(0)),
				"2011-02-26T01:56:20.000Z",
			);
			assert.isFalse(page.isTruncated);
			assert.isTrue(Option.isNone(page.nextContinuationToken));
			assert.deepStrictEqual(page.commonPrefixes, []);
		},
	},
	"r2-truncated.xml": {
		ok: (page) => {
			assert.deepStrictEqual(
				page.keys.map((entry) => entry.key),
				["webhooks/a.json"],
			);
			assert.isTrue(page.isTruncated);
			assert.deepStrictEqual(page.nextContinuationToken, Option.some("1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM="));
			assert.strictEqual(page.keys[0]?.etag, '"e1"');
		},
	},
	"minio-prefixes.xml": {
		ok: (page) => {
			assert.deepStrictEqual(
				page.keys.map((entry) => [entry.key, entry.etag]),
				[["root.txt", '"d41d8cd98f00b204e9800998ecf8427e"']],
			);
			assert.deepStrictEqual(page.commonPrefixes, ["photos/", "videos/"]);
		},
	},
	"keycount-contents-only.xml": {
		ok: (page) => {
			assert.deepStrictEqual(
				page.keys.map((entry) => entry.key),
				["root.txt"],
			);
			assert.deepStrictEqual(page.commonPrefixes, ["photos/"]);
		},
	},
	"escaped-keys.xml": {
		ok: (page) => {
			assert.deepStrictEqual(
				page.keys.map((entry) => entry.key),
				[`a & b <c> "d" 'e'`, "café/\u{1F600}.txt", "cdata <raw> & key", "  spaced key  "],
			);
		},
	},
	"bom-declaration.xml": { ok: (page) => assert.lengthOf(page.keys, 0) },
	"error-on-200.xml": { fails: "S3RequestFailed", code: "InternalError" },
	"html-proxy-page.html": malformed(undefined, true),
	"xhtml-page.html": malformed("a root element <html>"),
	"wrong-root.xml": malformed("a root element <ListAllMyBucketsResult>"),
	"empty.xml": malformed("an empty body", true),
	"whitespace-only.xml": malformed(undefined, true),
	"two-roots.xml": malformed(undefined, true),
	"unclosed.xml": malformed(undefined, true),
	"doctype-entity.xml": malformed(undefined, true),
	"out-of-range-charref.xml": malformed(undefined, true),
	"control-char-key.xml": malformed(undefined, true),
	"truncated-no-token.xml": malformed("none"),
	"truncated-empty-token.xml": malformed('""'),
	"missing-istruncated.xml": malformed("none"),
	"bad-istruncated.xml": malformed('"yes"'),
	"contents-without-key.xml": malformed("none"),
	"empty-key.xml": malformed('""'),
	"duplicate-key.xml": malformed("2"),
	"key-holds-element.xml": malformed("an element"),
	"fractional-size.xml": malformed('"12.5"'),
	"negative-size.xml": malformed('"-1"'),
	"missing-size.xml": malformed("none"),
	"bad-last-modified.xml": malformed('"1"'),
	"calendar-overflow.xml": malformed('"2026-02-30T12:00:00Z"'),
	"keycount-mismatch.xml": malformed("2 <Contents> and 0 <CommonPrefixes>"),
	"prefix-without-prefix.xml": malformed("none"),
};

describe("the ListObjectsV2 corpus", () => {
	it("walks every fixture, and every fixture has an outcome", () => {
		// A silently empty walk would make every row below vacuous.
		assert.strictEqual(FIXTURES.length, 32);
		assert.deepStrictEqual(FIXTURES, Object.keys(OUTCOMES).sort());
	});

	for (const name of FIXTURES) {
		it.effect(name, () =>
			Effect.gen(function* () {
				const outcome = OUTCOMES[name];
				if (outcome === undefined) return assert.fail(`no outcome for ${name}`);
				const result = yield* listWith(readFileSync(resolve(DIR, name)));
				if ("ok" in outcome) {
					if (result._tag === "Failure") return assert.fail(`${name} failed: ${result.failure.message}`);
					outcome.ok(result.success);
					return;
				}
				if (result._tag === "Success")
					return assert.fail(`${name} read as a page of ${result.success.keys.length} keys`);
				const error = result.failure;
				assert.strictEqual(error._tag, outcome.fails, error.message);
				if (outcome.fails === "S3RequestFailed" && error._tag === "S3RequestFailed") {
					assert.strictEqual(error.status, 200);
					assert.strictEqual(error.code, outcome.code);
					assert.strictEqual(error.requestId, "4442587FB7D0A2F9");
				}
				if (outcome.fails === "S3MalformedResponse" && error._tag === "S3MalformedResponse") {
					assert.strictEqual(error.status, 200);
					if (outcome.received !== undefined) assert.include(error.received, outcome.received);
					if (outcome.hasCause !== undefined) assert.strictEqual(error.cause !== undefined, outcome.hasCause);
				}
			}),
		);
	}
});

describe("decoder limits", () => {
	it.effect("a document nested past the depth limit fails typed, never as a defect", () =>
		Effect.gen(function* () {
			const deep = `${"<a>".repeat(40)}${"</a>".repeat(40)}`;
			const result = yield* listWith(deep);
			if (result._tag === "Success") return assert.fail("an over-deep document read as a page");
			assert.strictEqual(result.failure._tag, "S3MalformedResponse");
			assert.include(result.failure.message, "maxDepth");
		}),
	);

	it.effect("a page nested within the limit still reads (positive control for the depth test)", () =>
		Effect.gen(function* () {
			// ListBucketResult → Contents → Owner → ID, plus padding: well under 32.
			const result = yield* listWith(
				"<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>k</Key><Size>1</Size><LastModified>2026-11-06T12:00:00Z</LastModified><Owner><ID>x</ID></Owner></Contents></ListBucketResult>",
			);
			if (result._tag === "Failure") return assert.fail(result.failure.message);
			assert.lengthOf(result.success.keys, 1);
		}),
	);

	it.effect("a token past the size limit fails typed", () =>
		Effect.gen(function* () {
			const result = yield* listWith(
				`<ListBucketResult><IsTruncated>false</IsTruncated><Name>${"x".repeat(1024 * 1024 + 1)}</Name></ListBucketResult>`,
			);
			if (result._tag === "Success") return assert.fail("an over-long token read as a page");
			assert.strictEqual(result.failure._tag, "S3MalformedResponse");
		}),
	);

	it.effect("a body that is not UTF-8 fails typed", () =>
		Effect.gen(function* () {
			const result = yield* listWith(new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0xfe, 0x3c, 0x2f, 0x61, 0x3e]));
			if (result._tag === "Success") return assert.fail("invalid UTF-8 read as a page");
			assert.strictEqual(result.failure._tag, "S3MalformedResponse");
		}),
	);
});
