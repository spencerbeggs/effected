import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import { ManagedDocument, ManagedDocumentError } from "../src/ManagedDocument.js";

const NS = "savvy-web";
const KEY = "release-validation";

const fresh = (): ManagedDocument => Result.getOrThrow(ManagedDocument.parseResult({ namespace: NS, key: KEY }));

const apply = (doc: ManagedDocument, entries: ReadonlyArray<readonly [string, string]>): ManagedDocument =>
	Result.getOrThrow(doc.withRegionsResult(entries));

const failureOf = (result: Result.Result<ManagedDocument, ManagedDocumentError>): ManagedDocumentError => {
	if (Result.isFailure(result)) {
		return result.failure;
	}
	return assert.fail("expected a typed failure");
};

const marker = (kind: "BEGIN" | "END", region: string): string =>
	`<!-- --- ${kind} ${NS}.${KEY}.${region} MANAGED REGION --- -->`;

describe("ManagedDocument", () => {
	describe("create-or-update", () => {
		it("a fresh document gains its regions and exactly one sentinel", () => {
			const doc = apply(fresh(), [
				["header", "## Validating Release"],
				["body", ""],
				["footer", "generated"],
			]);
			assert.include(doc.text, marker("BEGIN", "header"));
			assert.include(doc.text, marker("END", "footer"));
			assert.strictEqual(doc.text.split(doc.sentinel).length - 1, 1, "exactly one sentinel");
			assert.deepStrictEqual(doc.region("header"), Option.some("## Validating Release"));
			assert.deepStrictEqual(doc.region("body"), Option.some(""));
			assert.deepStrictEqual(doc.region("missing"), Option.none());
		});

		it("re-parsing rendered text reads the same regions back — no branch on existence", () => {
			const first = apply(fresh(), [["header", "v1"]]);
			const reread = Result.getOrThrow(ManagedDocument.parseResult({ namespace: NS, key: KEY, text: first.text }));
			assert.deepStrictEqual(reread.region("header"), Option.some("v1"));
			assert.deepStrictEqual(
				reread.regions.map((entry) => entry.key),
				["header"],
			);
		});

		it("applying identical regions is byte-identical — the compare-and-skip contract", () => {
			const doc = apply(fresh(), [
				["header", "same"],
				["footer", "same too"],
			]);
			const again = apply(doc, [
				["header", "same"],
				["footer", "same too"],
			]);
			assert.strictEqual(again.text, doc.text);
		});
	});

	describe("replacement, never appending", () => {
		it("a second application replaces the region in place", () => {
			const v1 = apply(fresh(), [["header", "state: pass"]]);
			const v2 = apply(v1, [["header", "state: fail"]]);
			assert.deepStrictEqual(v2.region("header"), Option.some("state: fail"));
			assert.notInclude(v2.text, "state: pass", "the stale render must be gone");
			assert.strictEqual(v2.text.split(marker("BEGIN", "header")).length - 1, 1, "one region, not two");
		});

		it("regions not named in a call are left exactly as they are", () => {
			const both = apply(fresh(), [
				["header", "the table"],
				["footer", "the run link"],
			]);
			const updated = apply(both, [["header", "the NEW table"]]);
			assert.deepStrictEqual(updated.region("header"), Option.some("the NEW table"));
			assert.deepStrictEqual(updated.region("footer"), Option.some("the run link"));
		});
	});

	describe("human content", () => {
		it("bytes outside managed regions survive regeneration", () => {
			const seeded = apply(fresh(), [["notes", "generated notes"]]);
			const edited = `A human wrote this line.\n\n${seeded.text}\nAnd this trailing thought.`;
			const doc = Result.getOrThrow(ManagedDocument.parseResult({ namespace: NS, key: KEY, text: edited }));
			const regenerated = apply(doc, [["notes", "regenerated notes"]]);
			assert.include(regenerated.text, "A human wrote this line.");
			assert.include(regenerated.text, "And this trailing thought.");
			assert.deepStrictEqual(regenerated.region("notes"), Option.some("regenerated notes"));
		});

		it("a hand-written body without a sentinel is adopted, not clobbered", () => {
			const human = "This PR body was written by a person.";
			const doc = Result.getOrThrow(ManagedDocument.parseResult({ namespace: NS, key: KEY, text: human }));
			const managed = apply(doc, [["squash", "```proposed-squash-commit\nrelease: 2.0.0\n```"]]);
			assert.include(managed.text, human);
			assert.include(managed.text, doc.sentinel);
			assert.deepStrictEqual(managed.region("squash"), Option.some("```proposed-squash-commit\nrelease: 2.0.0\n```"));
		});

		it("another document's regions in the same text are preserved and never reported", () => {
			const foreign = [
				"<!-- --- BEGIN other-tool.status.header MANAGED REGION --- -->",
				"someone else's block",
				"<!-- --- END other-tool.status.header MANAGED REGION --- -->",
			].join("\n");
			const doc = Result.getOrThrow(ManagedDocument.parseResult({ namespace: NS, key: KEY, text: foreign }));
			assert.deepStrictEqual(doc.regions, []);
			const ours = apply(doc, [["header", "our block"]]);
			assert.include(ours.text, "someone else's block");
			assert.deepStrictEqual(ours.region("header"), Option.some("our block"));
		});

		it("a CRLF document stays CRLF", () => {
			const crlf = "human first line\r\nhuman second line\r\n";
			const doc = Result.getOrThrow(ManagedDocument.parseResult({ namespace: NS, key: KEY, text: crlf }));
			const managed = apply(doc, [["header", "row one"]]);
			assert.include(managed.text, "human first line\r\nhuman second line");
			assert.include(managed.text, `${marker("BEGIN", "header")}\r\n`);
		});
	});

	describe("typed refusals — every kind fires", () => {
		it("unterminatedRegion", () => {
			const text = `${marker("BEGIN", "header")}\ncontent`;
			const error = failureOf(ManagedDocument.parseResult({ namespace: NS, key: KEY, text }));
			assert.strictEqual(error.kind, "unterminatedRegion");
			assert.strictEqual(error.line, 1);
		});

		it("orphanedEnd", () => {
			const error = failureOf(ManagedDocument.parseResult({ namespace: NS, key: KEY, text: marker("END", "x") }));
			assert.strictEqual(error.kind, "orphanedEnd");
		});

		it("overlappingRegions", () => {
			const text = [marker("BEGIN", "a"), marker("BEGIN", "b"), marker("END", "a"), marker("END", "b")].join("\n");
			const error = failureOf(ManagedDocument.parseResult({ namespace: NS, key: KEY, text }));
			assert.strictEqual(error.kind, "overlappingRegions");
		});

		it("duplicateRegion", () => {
			const block = [marker("BEGIN", "a"), "x", marker("END", "a")].join("\n");
			const error = failureOf(ManagedDocument.parseResult({ namespace: NS, key: KEY, text: `${block}\n${block}` }));
			assert.strictEqual(error.kind, "duplicateRegion");
		});

		it("markerInContent — content that would move a region boundary is refused", () => {
			const error = failureOf(fresh().withRegionsResult([["body", marker("END", "body")]]));
			assert.strictEqual(error.kind, "markerInContent");
			assert.strictEqual(error.key, "body", "the key is the consumer's region key, not the wire key");
		});

		it("duplicateDeclaration — two intentions for one region in one call", () => {
			const error = failureOf(
				fresh().withRegionsResult([
					["header", "first"],
					["header", "second"],
				]),
			);
			assert.strictEqual(error.kind, "duplicateDeclaration");
			assert.strictEqual(error.key, "header");
		});

		it("every kind renders a message naming the region", () => {
			const error = new ManagedDocumentError({ kind: "markerInContent", key: "body" });
			assert.include(error.message, 'region "body"');
			const structural = new ManagedDocumentError({ kind: "unterminatedRegion", line: 3 });
			assert.include(structural.message, "line 3");
		});
	});

	describe("sentinel", () => {
		it("matches the CommentMarker rendering for the same namespace and key", () => {
			// PullRequestComment.upsert appends `<!-- namespace:key -->`; the
			// document primitive must agree on the spelling, or the comment the
			// reconciler writes stops being findable by the marker that owns it.
			assert.strictEqual(fresh().sentinel, `<!-- ${NS}:${KEY} -->`);
			const doc = apply(fresh(), [["header", "x"]]);
			assert.isTrue(doc.matches(doc.text));
			assert.isFalse(doc.matches("no marker here"));
		});
	});

	describe("the Effect variants", () => {
		it.effect("parse and withRegions succeed through the Effect channel", () =>
			Effect.gen(function* () {
				const doc = yield* ManagedDocument.parse({ namespace: NS, key: KEY });
				const next = yield* doc.withRegions([["header", "v1"]]);
				assert.deepStrictEqual(next.region("header"), Option.some("v1"));
				assert.isTrue(next.matches(next.text));
			}),
		);

		it.effect("both keep the TYPED error channel — a wrapper regression would defect instead", () =>
			Effect.gen(function* () {
				const parseError = yield* Effect.flip(
					ManagedDocument.parse({
						namespace: NS,
						key: KEY,
						text: `${marker("BEGIN", "header")}\nnever closed`,
					}),
				);
				assert.instanceOf(parseError, ManagedDocumentError);
				assert.strictEqual(parseError.kind, "unterminatedRegion");

				const doc = yield* ManagedDocument.parse({ namespace: NS, key: KEY });
				const applyError = yield* Effect.flip(doc.withRegions([["body", marker("BEGIN", "body")]]));
				assert.instanceOf(applyError, ManagedDocumentError);
				assert.strictEqual(applyError.kind, "markerInContent");
			}),
		);
	});
});
