import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { VirtualPackage, mergeVfs, prefixVfs } from "../src/index.js";

describe("VirtualPackage", () => {
	it("create produces a single-entry package with a types field", () => {
		const pkg = VirtualPackage.create("@my-org/api-types", "1.0.0", "export interface User { id: string }");
		const vfs = pkg.toVfs();
		assert.deepStrictEqual(
			[...vfs.keys()],
			["node_modules/@my-org/api-types/package.json", "node_modules/@my-org/api-types/index.d.ts"],
		);
		const manifest = JSON.parse(vfs.get("node_modules/@my-org/api-types/package.json") ?? "{}") as Record<
			string,
			unknown
		>;
		assert.strictEqual(manifest.name, "@my-org/api-types");
		assert.strictEqual(manifest.types, "index.d.ts");
		assert.strictEqual(manifest.exports, undefined);
	});

	it("createMultiEntry produces an exports map keyed by entry base name", () => {
		const pkg = VirtualPackage.createMultiEntry(
			"@my-org/sdk",
			"2.0.0",
			new Map([
				["index.d.ts", "export declare function run(): void;"],
				["testing.d.ts", "export declare function mock(): void;"],
			]),
		);
		const vfs = pkg.toVfs();
		assert.isTrue(vfs.has("node_modules/@my-org/sdk/testing.d.ts"));
		const manifest = JSON.parse(vfs.get("node_modules/@my-org/sdk/package.json") ?? "{}") as {
			exports?: Record<string, { types: string }>;
		};
		assert.deepStrictEqual(manifest.exports, {
			".": { types: "./index.d.ts" },
			"./testing": { types: "./testing.d.ts" },
		});
	});

	it("a single non-index entry keeps its own file name as the types field", () => {
		const pkg = VirtualPackage.createMultiEntry("solo", "1.0.0", new Map([["main.d.ts", "export {};"]]));
		const manifest = JSON.parse(pkg.toVfs().get("node_modules/solo/package.json") ?? "{}") as Record<string, unknown>;
		assert.strictEqual(manifest.types, "main.d.ts");
	});

	it.effect("fromFile reads through the FileSystem service", () =>
		Effect.gen(function* () {
			const pkg = yield* VirtualPackage.fromFile("from-disk", "1.0.0", "/decls/api.d.ts");
			const vfs = pkg.toVfs();
			assert.strictEqual(vfs.get("node_modules/from-disk/index.d.ts"), "export declare const fromDisk: true;");
		}).pipe(
			Effect.provide(
				FileSystem.layerNoop({
					readFileString: (path) =>
						path === "/decls/api.d.ts"
							? Effect.succeed("export declare const fromDisk: true;")
							: Effect.die(new Error(`unexpected read: ${path}`)),
				}),
			),
		),
	);

	it("stays subclass-friendly for the rspress consumer", () => {
		class ApiExtractedPackage extends VirtualPackage {
			get entryCount(): number {
				return this.entries.size;
			}
		}
		const pkg = new ApiExtractedPackage({
			name: "extracted",
			version: "0.1.0",
			entries: new Map([["index.d.ts", "export {};"]]),
		});
		assert.strictEqual(pkg.entryCount, 1);
		assert.isTrue(pkg.toVfs().has("node_modules/extracted/index.d.ts"));
	});
});

describe("Vfs helpers", () => {
	it("mergeVfs merges left to right with later entries winning", () => {
		const merged = mergeVfs(
			new Map([
				["a.d.ts", "first"],
				["shared.d.ts", "first"],
			]),
			new Map([["shared.d.ts", "second"]]),
		);
		assert.strictEqual(merged.size, 2);
		assert.strictEqual(merged.get("shared.d.ts"), "second");
	});

	it("prefixVfs prefixes and normalizes leading slashes", () => {
		const prefixed = prefixVfs("pkg", new Map([["/dist/index.d.ts", "content"]]));
		assert.deepStrictEqual([...prefixed.keys()], ["node_modules/pkg/dist/index.d.ts"]);
	});
});
