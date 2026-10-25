// confineRelative: table-driven over the escape forms an archive manifest can
// carry, plus the Effect twin's error channel.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import type { PathEscapeReason } from "../src/Confine.js";
import { PathEscapeError, confineRelative, confineRelativeResult } from "../src/Confine.js";

const BASE = "/srv/site";

const confined: ReadonlyArray<readonly [candidate: string, joined: string]> = [
	["x", "/srv/site/x"],
	["og/card.png", "/srv/site/og/card.png"],
	["og\\card.png", "/srv/site/og/card.png"],
	["./og/card.png", "/srv/site/og/card.png"],
	["og//card.png", "/srv/site/og/card.png"],
	["og/./card.png", "/srv/site/og/card.png"],
	["og/", "/srv/site/og"],
	["og/../x", "/srv/site/x"],
	["og\\..\\x", "/srv/site/x"],
	["a/b/../../x", "/srv/site/x"],
	["..x", "/srv/site/..x"],
	["x..", "/srv/site/x.."],
	["x.y", "/srv/site/x.y"],
	["console", "/srv/site/console"],
	["lpt10", "/srv/site/lpt10"],
	["nulx.txt", "/srv/site/nulx.txt"],
	["my con", "/srv/site/my con"],
	// No percent-decoding: an encoded dot-dot is one literal file name, as the filesystem reads it.
	["%2e%2e/x", "/srv/site/%2e%2e/x"],
	["%2e%2e%2fx", "/srv/site/%2e%2e%2fx"],
	["..%2fx", "/srv/site/..%2fx"],
];

const refused: ReadonlyArray<readonly [candidate: string, reason: PathEscapeReason]> = [
	["../x", "traversal"],
	["..", "traversal"],
	["..\\x", "traversal"],
	["og/../../x", "traversal"],
	["og\\..\\..\\x", "traversal"],
	["og/..\\../x", "traversal"],
	["./../x", "traversal"],
	["a/b/../../../x", "traversal"],
	["/abs", "absolute"],
	["/srv/site/x", "absolute"],
	["\\abs", "absolute"],
	["\\\\server\\share\\x", "absolute"],
	["//server/share/x", "absolute"],
	["C:\\x", "absolute"],
	["c:/x", "absolute"],
	["C:x", "absolute"],
	["", "empty"],
	[".", "empty"],
	["./", "empty"],
	["./.", "empty"],
	["og/..", "empty"],
	["\\", "absolute"],
	["x\0", "nulByte"],
	["og/\0/x", "nulByte"],
	["../\0", "nulByte"],
	// A drive prefix that normalisation exposes is still absolute.
	["./C:/x", "absolute"],
	["og/../C:/x", "absolute"],
	["./C:x", "absolute"],
	[".\\C:\\x", "absolute"],
	// A colon anywhere: a drive designator past the first segment, or an NTFS alternate data stream.
	["COM0", "reservedName"],
	["lpt0.txt", "reservedName"],
	["COM\u00b9.txt", "reservedName"],
	["og/LPT\u00b3", "reservedName"],
	["CONIN$", "reservedName"],
	["conout$.log", "reservedName"],
	["og/C:x", "reservedName"],
	["file.txt::$DATA", "reservedName"],
	["og/x:stream", "reservedName"],
	// Dots and spaces only: win32 trims them to nothing or to `..`.
	["...", "reservedName"],
	["og/.../x", "reservedName"],
	[" ", "reservedName"],
	[".. ", "reservedName"],
	[". .", "reservedName"],
	// Reserved device names, any case, with or without an extension.
	["CON", "reservedName"],
	["prn", "reservedName"],
	["Aux", "reservedName"],
	["og/nul", "reservedName"],
	["nul.txt", "reservedName"],
	["COM1", "reservedName"],
	["com9.log", "reservedName"],
	["LPT1", "reservedName"],
	["lpt9.tar.gz", "reservedName"],
	["CON .txt", "reservedName"],
];

describe("confineRelativeResult", () => {
	describe("confined candidates join under the base", () => {
		for (const [candidate, joined] of confined) {
			it(JSON.stringify(candidate), () => {
				assert.deepStrictEqual(confineRelativeResult(BASE, candidate), Result.succeed(joined));
			});
		}
	});

	describe("escaping candidates are refused with their reason, under a base or an empty one", () => {
		for (const base of [BASE, ""]) {
			for (const [candidate, reason] of refused) {
				it(`${JSON.stringify(base)} + ${JSON.stringify(candidate)} → ${reason}`, () => {
					const result = confineRelativeResult(base, candidate);
					assert.isTrue(Result.isFailure(result));
					if (Result.isFailure(result)) {
						assert.instanceOf(result.failure, PathEscapeError);
						assert.strictEqual(result.failure.reason, reason);
						assert.strictEqual(result.failure.candidate, candidate);
					}
				});
			}
		}
	});

	it("strips trailing separators from the base and keeps the rest verbatim", () => {
		assert.deepStrictEqual(confineRelativeResult("/srv/site/", "x"), Result.succeed("/srv/site/x"));
		assert.deepStrictEqual(confineRelativeResult("C:\\out\\", "og\\x"), Result.succeed("C:\\out/og/x"));
		assert.deepStrictEqual(confineRelativeResult("/", "x"), Result.succeed("/x"));
	});

	it("an empty base yields the normalised relative path alone", () => {
		assert.deepStrictEqual(confineRelativeResult("", "og\\./x"), Result.succeed("og/x"));
	});

	it("renders the candidate JSON-quoted, so a control character cannot forge a log line", () => {
		const result = confineRelativeResult(BASE, "../x\nINFO forged");
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure.message, 'the path "../x\\nINFO forged" climbs above the base directory');
		}
	});
});

describe("confineRelative", () => {
	it.effect("succeeds with the joined path", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* confineRelative(BASE, "og/card.png"), "/srv/site/og/card.png");
		}),
	);

	it.effect("fails typed with PathEscapeError, recoverable by tag", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(confineRelative(BASE, "og/../../x"));
			assert.strictEqual(error._tag, "PathEscapeError");
			assert.strictEqual(error.reason, "traversal");
			const recovered = yield* confineRelative(BASE, "/abs").pipe(
				Effect.catchTag("PathEscapeError", (e) => Effect.succeed(e.reason)),
			);
			assert.strictEqual(recovered, "absolute");
		}),
	);
});
