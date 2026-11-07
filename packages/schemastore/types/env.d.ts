// The build's `define` replaces `process.env.__PACKAGE_VERSION__` with the package version.

declare namespace NodeJS {
	interface ProcessEnv {
		/** The built package's version. Absent when running source, so a reader falls back, e.g. `?? "0.0.0"`. */
		readonly __PACKAGE_VERSION__?: string;
	}
}
