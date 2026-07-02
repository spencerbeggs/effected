/**
 * \@savvy-web/example-module
 *
 * Version-aware type definition registry for TypeScript documentation with Twoslash.
 * Built with Effect for robust error handling and composable async operations.
 *
 * @packageDocumentation
 */

export interface Foo {
	baz: number;
}

export class Bar {
	qux(): Foo {
		return { baz: 42 };
	}
}
