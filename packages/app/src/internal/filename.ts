/**
 * A filename is one path component. Anything else escapes the app's own
 * directory, so it dies rather than resolving somewhere surprising — the same
 * wiring-defect rule xdg applies to `namespace`. Shared by every module with
 * a `filename` option, so a new rejected shape is added here once; the
 * test-side mirror is `__test__/filenameGuard.ts`.
 */
export const badFilename = (context: string, filename: string): Error | undefined => {
	if (filename.length === 0) {
		return new Error(`${context}: \`filename\` must not be empty`);
	}
	if (/[/\\]/.test(filename) || filename === "." || filename === "..") {
		return new Error(`${context}: \`filename\` must be a single path component, received ${JSON.stringify(filename)}`);
	}
	return undefined;
};
