// Ambient type shim for the untyped CommonJS `spdx-expression-parse` package.
// It throws on an invalid SPDX expression and returns a parse tree otherwise;
// `License` only cares about the throw/no-throw distinction.
declare module "spdx-expression-parse" {
	function parse(expression: string): unknown;
	export default parse;
}
