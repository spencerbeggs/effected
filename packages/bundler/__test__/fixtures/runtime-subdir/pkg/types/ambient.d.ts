declare module "react/jsx-runtime" {
	export namespace JSX {
		type Element = unknown;
		interface IntrinsicElements {
			[name: string]: Record<string, unknown>;
		}
	}
	export const jsx: (...args: ReadonlyArray<unknown>) => unknown;
	export const jsxs: (...args: ReadonlyArray<unknown>) => unknown;
	export const Fragment: unknown;
}
declare module "@theme" {
	export const Layout: unknown;
}
interface ImportMetaEnv {
	readonly SSG_MD?: string;
}
interface ImportMeta {
	readonly env: ImportMetaEnv;
}
