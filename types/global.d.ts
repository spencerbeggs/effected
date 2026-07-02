export {};

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			/** Automatic package version injected at build time */
			__PACKAGE_VERSION__: string;
		}
	}
}
