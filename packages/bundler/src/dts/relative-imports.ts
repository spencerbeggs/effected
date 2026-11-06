// packages/bundler/src/dts/relative-imports.ts
import type { Node } from "typescript/ast";
import {
	isExportDeclaration,
	isExternalModuleReference,
	isImportDeclaration,
	isImportEqualsDeclaration,
	isImportTypeNode,
	isLiteralTypeNode,
	isStringLiteral,
} from "typescript/ast";
import { withParsedSource } from "./parse.js";

const isRelative = (s: string): boolean => s.startsWith("./") || s.startsWith("../");

/**
 * Find every relative module specifier in a declaration source: static `import`/`export … from`,
 * `import("…")` type nodes, and `/// <reference path="…" />`. Pure parsing — no I/O.
 *
 * A non-empty result means the file is NOT self-contained and would break when copied verbatim to a
 * flattened output location, so the ambient-copy step rejects it.
 * @public
 */
export function findRelativeSpecifiers(source: string, fileName = "ambient.d.ts"): string[] {
	return withParsedSource(fileName, source, (sf) => {
		const found = new Set<string>();
		for (const ref of sf.referencedFiles) if (isRelative(ref.fileName)) found.add(ref.fileName);
		const visit = (node: Node): void => {
			if (
				(isImportDeclaration(node) || isExportDeclaration(node)) &&
				node.moduleSpecifier !== undefined &&
				isStringLiteral(node.moduleSpecifier)
			) {
				if (isRelative(node.moduleSpecifier.text)) found.add(node.moduleSpecifier.text);
			} else if (isImportTypeNode(node) && isLiteralTypeNode(node.argument) && isStringLiteral(node.argument.literal)) {
				if (isRelative(node.argument.literal.text)) found.add(node.argument.literal.text);
			} else if (
				isImportEqualsDeclaration(node) &&
				isExternalModuleReference(node.moduleReference) &&
				isStringLiteral(node.moduleReference.expression)
			) {
				if (isRelative(node.moduleReference.expression.text)) found.add(node.moduleReference.expression.text);
			}
			node.forEachChild(visit);
		};
		visit(sf);
		return [...found];
	});
}
