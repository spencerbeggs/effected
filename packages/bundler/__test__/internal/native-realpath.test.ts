// The dts-emit tsconfig names its base by realpath(3), never Node's JavaScript realpath (#1254).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { writeDtsEmitTsconfig } from "../../src/dts/resolved-tsconfig.js";

const root = realpathSync.native(mkdtempSync(join(tmpdir(), "native-realpath-")));
mkdirSync(join(root, "Real", "Pkg"), { recursive: true });
writeFileSync(join(root, "Real", "Pkg", "tsconfig.json"), "{}\n");
const canonicalBase = join(root, "Real", "Pkg", "tsconfig.json");
// Case-insensitive volumes (the macOS default) answer a mis-cased path; a case-sensitive one does not.
let caseInsensitive = false;
try {
	readFileSync(join(root, "real", "pkg", "tsconfig.json"));
	caseInsensitive = true;
} catch {}

const extendsOf = (base: string) =>
	writeDtsEmitTsconfig(base).pipe(
		Effect.map((out) => (JSON.parse(readFileSync(out, "utf-8")) as { extends: string }).extends),
		Effect.provide(NodeServices.layer),
	);

describe("writeDtsEmitTsconfig canonical base", () => {
	it.effect.skipIf(!caseInsensitive)("names a mis-cased base by its on-disk case", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* extendsOf(join(root, "real", "pkg", "tsconfig.json")), canonicalBase);
		}),
	);

	it.effect("resolves a .. after a symlink physically", () =>
		Effect.gen(function* () {
			mkdirSync(join(root, "other", "deep"), { recursive: true });
			symlinkSync(join(root, "Real", "Pkg"), join(root, "other", "deep", "link"));
			// Physically, link/.. is Real; lexically it would be other/deep, which has no Pkg.
			// Spelled by hand: `join` would collapse `link/..` lexically before the writer saw it.
			assert.strictEqual(yield* extendsOf(`${root}/other/deep/link/../Pkg/tsconfig.json`), canonicalBase);
		}),
	);
});
