import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as ts from "typescript";
import { TsEnvironment, VirtualPackage, mergeVfs } from "../src/index.js";

const compilerOptions: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	strict: true,
};

describe("TsEnvironment", () => {
	it.effect("compiles a Twoslash-sized sample against a fixture Vfs", () =>
		Effect.gen(function* () {
			// The port's end-to-end proof: a VirtualPackage-produced Vfs typechecks.
			const vfs = mergeVfs(
				VirtualPackage.create(
					"my-types",
					"1.0.0",
					"export declare const answer: number;\nexport interface User { readonly id: string }\n",
				).toVfs(),
			);
			const environment = yield* TsEnvironment.make({ vfs, compilerOptions, projectRoot: "/twoslash" });
			environment.createFile(
				"/twoslash/sample.ts",
				'import { answer, type User } from "my-types";\nconst x: number = answer;\nconst u: User = { id: String(x) };\nexport { u };\n',
			);
			const diagnostics = [
				...environment.languageService.getSemanticDiagnostics("/twoslash/sample.ts"),
				...environment.languageService.getSyntacticDiagnostics("/twoslash/sample.ts"),
			];
			assert.deepStrictEqual(
				diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")),
				[],
			);
		}),
	);

	it.effect("surfaces type errors through the language service", () =>
		Effect.gen(function* () {
			const vfs = VirtualPackage.create("my-types", "1.0.0", "export declare const answer: number;").toVfs();
			const environment = yield* TsEnvironment.make({ vfs, compilerOptions, projectRoot: "/twoslash" });
			environment.createFile(
				"/twoslash/broken.ts",
				'import { answer } from "my-types";\nconst wrong: string = answer;\nexport { wrong };\n',
			);
			const diagnostics = environment.languageService.getSemanticDiagnostics("/twoslash/broken.ts");
			assert.isAbove(diagnostics.length, 0);
		}),
	);

	it.effect("re-roots bare node_modules keys under the project root", () =>
		Effect.gen(function* () {
			const environment = yield* TsEnvironment.make({
				vfs: new Map([["node_modules/probe/index.d.ts", "export {};"]]),
				compilerOptions,
				projectRoot: "/rooted",
			});
			assert.isTrue(environment.sys.fileExists("/rooted/node_modules/probe/index.d.ts"));
		}),
	);
});
