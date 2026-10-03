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

/**
 * A subdirectory is a relative path of single components, joined under the
 * app's own directory. Every component obeys the filename rule, and the whole
 * must not be absolute — so it can never climb out of the namespace directory.
 */
export const badSubdir = (context: string, subdir: string): Error | undefined => {
	const reject = () =>
		new Error(
			`${context}: \`subdir\` must be a relative path of single path components, received ${JSON.stringify(subdir)}`,
		);
	if (subdir.length === 0) {
		return new Error(`${context}: \`subdir\` must not be empty`);
	}
	if (subdir.includes("\\") || subdir.startsWith("/")) return reject();
	for (const component of subdir.split("/")) {
		if (component.length === 0 || component === "." || component === "..") return reject();
	}
	return undefined;
};
