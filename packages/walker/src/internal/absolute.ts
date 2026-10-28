// The one absoluteness rule for a caller-named root (`descend`'s `cwd`,
// `confineReal`'s base, a ceiling): absolute AND independent of the process.

/**
 * A win32 path rooted on the CURRENT drive: one leading separator, not two
 * (`\\server\share` and `\\?\C:\x` are UNC and device paths, which name their
 * root). `path.win32.isAbsolute` calls `\repo` absolute, yet which drive it
 * names depends on the process working directory — exactly like the
 * drive-relative `C:x`.
 */
const CURRENT_DRIVE_ROOT = /^[\\/](?![\\/])/;

/** Whether `path` is rooted on the current drive under win32 path rules. */
export const isCurrentDriveRooted = (path: string, sep: string): boolean =>
	sep === "\\" && CURRENT_DRIVE_ROOT.test(path);

/**
 * Whether `path` names one location whatever the process working directory:
 * absolute to the injected implementation, and on win32 not rooted on the
 * current drive.
 */
export const isPinnedAbsolute = (
	path: string,
	ops: { readonly sep: string; readonly isAbsolute: (path: string) => boolean },
): boolean => ops.isAbsolute(path) && !isCurrentDriveRooted(path, ops.sep);
