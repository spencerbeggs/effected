import { assert, describe, it } from "@effect/vitest";
import {
	bucketPath,
	isHeaderValue,
	isMaxKeys,
	isToken,
	keyProblem,
	objectPath,
	resolveAddress,
} from "../src/internal/address.js";

/**
 * Milliseconds of CPU time this process has spent (`process.cpuUsage`, user plus system): time the work spent, not
 * time the process was descheduled, so a loaded machine can not stretch a sample. vitest runs each file in its own
 * fork, so no other test's CPU lands here. It under-measures async I/O, which the units here do not use.
 */
const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

describe("resolveAddress", () => {
	it("path style for a custom endpoint, keeping its port and path", () => {
		const address = resolveAddress({ bucket: "b", region: "auto", endpoint: "http://localhost:9000/base//" });
		assert.deepStrictEqual(address, {
			origin: "http://localhost:9000",
			host: "localhost:9000",
			basePath: "/base",
			pathStyle: true,
			bucket: "b",
		});
		assert.strictEqual(objectPath(address, "k/v"), "/base/b/k/v");
		assert.strictEqual(bucketPath(address), "/base/b");
	});

	it("virtual-host style for AWS with no endpoint", () => {
		const address = resolveAddress({ bucket: "my-bucket", region: "us-west-2" });
		assert.strictEqual(address.origin, "https://my-bucket.s3.us-west-2.amazonaws.com");
		assert.strictEqual(address.host, "my-bucket.s3.us-west-2.amazonaws.com");
		assert.strictEqual(objectPath(address, "k"), "/k");
		assert.strictEqual(bucketPath(address), "/");
	});

	it("a dotted bucket defaults to path style over https, which a wildcard certificate cannot cover as a label", () => {
		const address = resolveAddress({ bucket: "my.bucket", region: "us-west-2" });
		assert.isTrue(address.pathStyle);
		assert.strictEqual(address.origin, "https://s3.us-west-2.amazonaws.com");
		assert.strictEqual(objectPath(address, "k"), "/my.bucket/k");
		// An explicit choice is honoured: a custom domain may carry a matching certificate.
		const forced = resolveAddress({ bucket: "my.bucket", region: "us-west-2", forcePathStyle: false });
		assert.strictEqual(forced.host, "my.bucket.s3.us-west-2.amazonaws.com");
	});

	it("forcePathStyle overrides the default either way", () => {
		assert.isTrue(resolveAddress({ bucket: "b", region: "us-east-1", forcePathStyle: true }).pathStyle);
		assert.isFalse(
			resolveAddress({ bucket: "bkt", region: "auto", endpoint: "https://r2.example", forcePathStyle: false })
				.pathStyle,
		);
	});

	it("an endpoint's dot segments are already collapsed by the URL parser, so the base path is what is sent", () => {
		assert.strictEqual(
			resolveAddress({ bucket: "b", region: "auto", endpoint: "https://x.example/a/%2e%2e/b" }).basePath,
			"/b",
		);
	});

	it("a long run of trailing slashes is stripped in linear time", () => {
		const started = cpuNow();
		const address = resolveAddress({
			bucket: "b",
			region: "auto",
			endpoint: `https://x.example/p${"/".repeat(50_000)}`,
		});
		assert.strictEqual(address.basePath, "/p");
		assert.isBelow(cpuNow() - started, 1000);
	});

	for (const [name, input] of [
		["an undecodable endpoint path", { bucket: "b", region: "auto", endpoint: "https://x.example/%E0%A4%A" }],
		["a '..' bucket", { bucket: "..", region: "auto", endpoint: "https://x.example" }],
		// Explicit: a dotted bucket now defaults to path style, so only a forced host label reaches the check.
		["a virtual-host bucket with two dots in a row", { bucket: "a..b", region: "us-east-1", forcePathStyle: false }],
		["a virtual-host bucket ending in a hyphen", { bucket: "ab-", region: "us-east-1" }],
		["a virtual-host bucket shorter than 3 characters", { bucket: "ab", region: "us-east-1" }],
		["a virtual-host bucket longer than 63 characters", { bucket: "a".repeat(64), region: "us-east-1" }],
	] as const) {
		it(`throws for ${name}`, () => {
			assert.throws(() => resolveAddress(input));
		});
	}
});

describe("input checks", () => {
	it("keyProblem", () => {
		assert.strictEqual(keyProblem(""), "empty-key");
		assert.strictEqual(keyProblem("a".repeat(1025)), "key-too-long");
		// 512 two-byte characters is exactly 1024 bytes: accepted.
		assert.isUndefined(keyProblem("é".repeat(512)));
		assert.strictEqual(keyProblem("é".repeat(513)), "key-too-long");
		assert.strictEqual(keyProblem(".."), "dot-segment");
		assert.strictEqual(keyProblem("a/./b"), "dot-segment");
		assert.isUndefined(keyProblem("a/.../b"));
		assert.isUndefined(keyProblem("a//b"));
		assert.isUndefined(keyProblem(".hidden/file."));
	});

	it("keyProblem refuses a lone surrogate, which TextEncoder would silently replace", () => {
		for (const key of ["\ud800", "\udc00", "a\ud83d", "\udfffb", "x/\ud800/y"]) {
			assert.strictEqual(keyProblem(key), "malformed-unicode", JSON.stringify(key));
		}
		// Checked before the byte length: the replacement character would miscount it.
		assert.strictEqual(keyProblem(`\ud800${"a".repeat(1100)}`), "malformed-unicode");
		// A surrogate pair is well formed.
		assert.isUndefined(keyProblem("📦/🎉"));
		// 256 four-byte emoji is exactly 1024 bytes; one more is too long.
		assert.isUndefined(keyProblem("🎉".repeat(256)));
		assert.strictEqual(keyProblem("🎉".repeat(257)), "key-too-long");
	});

	it("isToken", () => {
		assert.isTrue(isToken("x.y_z-1~"));
		assert.isFalse(isToken(""));
		assert.isFalse(isToken("a b"));
		assert.isFalse(isToken("a:b"));
		assert.isFalse(isToken("é"));
	});

	it("isHeaderValue", () => {
		assert.isTrue(isHeaderValue("printable ~ ascii\twith tab"));
		assert.isTrue(isHeaderValue(""));
		assert.isFalse(isHeaderValue("a\r\nb"));
		assert.isFalse(isHeaderValue("\u007f"));
		assert.isFalse(isHeaderValue("café"));
	});

	it("isMaxKeys", () => {
		assert.isTrue(isMaxKeys(1));
		assert.isTrue(isMaxKeys(1000));
		for (const value of [0, 1001, 2.5, Number.NaN, Number.POSITIVE_INFINITY, -1])
			assert.isFalse(isMaxKeys(value), String(value));
	});
});
