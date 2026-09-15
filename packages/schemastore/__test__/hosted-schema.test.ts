import { assert, describe, it } from "@effect/vitest";
import { Equal, Schema } from "effect";
import { HostedSchema, SCHEMASTORE_CATALOG_BASE, SCHEMASTORE_ID_BASE } from "../src/index.js";

const RAW = "https://raw.githubusercontent.com/savvy-web/silk-release-action/main/schemas";

describe("HostedSchema", () => {
	describe("github", () => {
		it("derives $id and url from repo, branch, path, name and the newest version", () => {
			const hosted = HostedSchema.github({
				repo: "savvy-web/silk-release-action",
				path: "schemas",
				name: "silk-release-action.output",
				versions: ["5.1", "5.2"],
			});
			assert.strictEqual(hosted.baseUrl, RAW);
			assert.strictEqual(hosted.resolvedCurrent, "5.2");
			assert.strictEqual(hosted.resolvedLayout, "versioned");
			assert.strictEqual(hosted.$id, `${RAW}/5.2/silk-release-action.output-5.2.json`);
			assert.strictEqual(hosted.url, hosted.$id);
			assert.strictEqual(hosted.fileName, "5.2/silk-release-action.output-5.2.json");
			assert.strictEqual(hosted.idFor("5.1"), `${RAW}/5.1/silk-release-action.output-5.1.json`);
			assert.deepStrictEqual([...hosted.resolvedVersions], ["5.1", "5.2"]);
		});

		it("defaults branch to main and path to none, and honours an explicit current and flat layout", () => {
			const hosted = HostedSchema.github({
				repo: "o/r",
				name: "cfg",
				versions: ["2", "1"],
				current: "1",
				layout: "flat",
			});
			assert.strictEqual(hosted.baseUrl, "https://raw.githubusercontent.com/o/r/main");
			assert.strictEqual(hosted.resolvedCurrent, "1");
			assert.strictEqual(hosted.$id, "https://raw.githubusercontent.com/o/r/main/cfg-1.json");
			assert.strictEqual(
				HostedSchema.github({ repo: "o/r", branch: "v2", name: "cfg" }).baseUrl,
				"https://raw.githubusercontent.com/o/r/v2",
			);
		});
	});

	describe("schemastore", () => {
		it("splits $id and url across the two SchemaStore hosts and forces the flat layout", () => {
			const hosted = HostedSchema.schemastore({ name: "okfit", versions: ["1.0"] });
			assert.strictEqual(hosted.baseUrl, "schemastore");
			assert.strictEqual(hosted.resolvedLayout, "flat");
			assert.strictEqual(hosted.idBase, SCHEMASTORE_ID_BASE);
			assert.strictEqual(hosted.catalogBase, SCHEMASTORE_CATALOG_BASE);
			assert.strictEqual(hosted.$id, `${SCHEMASTORE_ID_BASE}/okfit-1.0.json`);
			assert.strictEqual(hosted.url, `${SCHEMASTORE_CATALOG_BASE}/okfit-1.0.json`);
		});
	});

	describe("custom", () => {
		it("accepts a string or URL base, trims a trailing slash, and defaults to the versioned layout", () => {
			const fromString = HostedSchema.custom({ baseUrl: "https://example.com/schemas/", name: "cfg", versions: ["1"] });
			const fromUrl = HostedSchema.custom({
				baseUrl: new URL("https://example.com/schemas"),
				name: "cfg",
				versions: ["1"],
			});
			assert.strictEqual(fromString.baseUrl, "https://example.com/schemas");
			assert.strictEqual(fromString.$id, "https://example.com/schemas/1/cfg-1.json");
			assert.isTrue(Equal.equals(fromString, fromUrl));
			assert.strictEqual(
				HostedSchema.custom({ baseUrl: "https://example.com/s", name: "cfg", versions: ["1"], layout: "flat" }).$id,
				"https://example.com/s/cfg-1.json",
			);
		});

		it("unversioned: name.json, no current", () => {
			const hosted = HostedSchema.custom({ baseUrl: "https://example.com/s", name: "cfg" });
			assert.isUndefined(hosted.resolvedCurrent);
			assert.deepStrictEqual(hosted.resolvedVersions, []);
			assert.strictEqual(hosted.$id, "https://example.com/s/cfg.json");
			assert.strictEqual(hosted.fileName, "cfg.json");
		});
	});

	describe("validation", () => {
		const rejects = (fields: Record<string, unknown>, pattern: RegExp) =>
			assert.throws(
				() => HostedSchema.custom({ baseUrl: "https://example.com/s", name: "cfg", ...fields } as never),
				pattern,
			);

		it("rejects a name that is not a simple file base name", () => {
			rejects({ name: "a/b" }, /simple file base name/);
		});

		it("rejects a base that is neither schemastore nor https", () => {
			rejects({ baseUrl: "http://example.com" }, /https:\/\//);
			rejects({ baseUrl: "" }, /https:\/\//);
		});

		it("rejects an https base carrying a query, a fragment or credentials — a file cannot be joined under it", () => {
			rejects({ baseUrl: "https://example.com/schemas?channel=stable" }, /query/);
			rejects({ baseUrl: "https://example.com/schemas#v1" }, /fragment/);
			rejects({ baseUrl: "https://user:pw@example.com/schemas" }, /credentials/);
			rejects({ baseUrl: "https://not a url" }, /https:\/\//);
		});

		it("github requires repo as owner/repo", () => {
			for (const repo of ["", "owner", "owner/", "/repo", "a/b/c", "owner/re po"]) {
				assert.throws(() => HostedSchema.github({ repo, name: "cfg" }), /repo.*owner\/repo/);
			}
		});

		it("names the offending schema without inventing a hosted field the caller never wrote", () => {
			assert.throws(
				() => HostedSchema.custom({ baseUrl: "https://example.com/s", name: "cfg", versions: ["nope!"] }),
				/^schema "cfg" has an invalid version label "nope!"/,
			);
		});

		it("rejects an empty versions array, an invalid label and two spellings of one label", () => {
			rejects({ versions: [] }, /versions.*empty/);
			rejects({ versions: ["nope!"] }, /invalid version label "nope!"/);
			rejects({ versions: ["1.2", "1.2.0"] }, /"1\.2".*"1\.2\.0"/);
		});

		it("rejects current without versions or not among them", () => {
			rejects({ current: "1.0" }, /current.*versions/);
			rejects({ versions: ["1.0"], current: "1.1" }, /current "1\.1".*versions/);
		});

		it("rejects a layout under schemastore", () => {
			assert.throws(
				() => HostedSchema.schemastore({ name: "cfg", versions: ["1"], layout: "versioned" } as never),
				/layout.*schemastore/,
			);
		});
	});

	it("is a Schema.Class: decodes from plain JSON and compares structurally", () => {
		const decoded = Schema.decodeUnknownSync(HostedSchema)({ baseUrl: RAW, name: "cfg", versions: ["1"] });
		assert.instanceOf(decoded, HostedSchema);
		assert.isTrue(Equal.equals(decoded, HostedSchema.custom({ baseUrl: RAW, name: "cfg", versions: ["1"] })));
		assert.isFalse(Equal.equals(decoded, HostedSchema.custom({ baseUrl: RAW, name: "cfg", versions: ["2"] })));
	});
});
