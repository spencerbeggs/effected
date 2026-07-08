// The raw composed-document record produced by the internal composer and
// consumed by the internal stringifier. The public `YamlDocument` class (a
// `Schema.Class` carrying materialized `YamlDiagnostic` arrays) is built from
// this record by the facade; the engine never constructs public classes.

import type { YamlNode } from "../YamlNode.js";
import type { RawDiagnostic } from "./diagnostics.js";

/** A YAML directive as raw name/parameter strings (e.g. `%YAML 1.2`). */
export interface RawDirective {
	readonly name: string;
	readonly parameters: ReadonlyArray<string>;
}

/** A composed YAML document with raw, offset-based diagnostics. */
export interface RawYamlDocument {
	readonly contents: YamlNode | null;
	readonly errors: ReadonlyArray<RawDiagnostic>;
	readonly warnings: ReadonlyArray<RawDiagnostic>;
	readonly directives: ReadonlyArray<RawDirective>;
	readonly comment?: string;
	readonly hasDocumentStart: boolean;
	readonly hasDocumentEnd: boolean;
	/**
	 * `true` when the `---` marker was followed by a tab in the source; the
	 * canonical stringifier emits a `...` terminator for this shape.
	 */
	readonly hasDocumentStartTab: boolean;
}
