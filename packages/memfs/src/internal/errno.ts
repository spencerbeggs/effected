// KIT EXTENSION (errno fidelity — adaptation ledger entry 10). Moved out of the
// ported engine so the engine, the synchronous/promises ports and the
// NodeSyncFileSystem subpath share one errno → tag mapping.
import type { PlatformError, SystemErrorTag } from "effect/PlatformError";
import { systemError } from "effect/PlatformError";

export type ErrnoCode =
	| "EACCES"
	| "EBADF"
	| "EBUSY"
	| "EEXIST"
	| "EINVAL"
	| "EISDIR"
	| "ELOOP"
	| "ENOENT"
	| "ENOTDIR"
	| "ENOTEMPTY"
	| "EPERM"
	| "ERR_FS_CP_DIR_TO_NON_DIR"
	| "ERR_FS_CP_EINVAL"
	| "ERR_FS_CP_NON_DIR_TO_DIR"
	| "ERR_FS_EISDIR";

export const errnoMessages: { readonly [Code in ErrnoCode]: string } = {
	EACCES: "permission denied",
	EBADF: "bad file descriptor",
	EBUSY: "resource busy or locked",
	EEXIST: "file already exists",
	EINVAL: "invalid argument",
	EISDIR: "illegal operation on a directory",
	ELOOP: "too many symbolic links encountered",
	ENOENT: "no such file or directory",
	ENOTDIR: "not a directory",
	ENOTEMPTY: "directory not empty",
	EPERM: "operation not permitted",
	ERR_FS_CP_DIR_TO_NON_DIR: "cannot overwrite non-directory with directory",
	ERR_FS_CP_EINVAL: "invalid src or dest",
	ERR_FS_CP_NON_DIR_TO_DIR: "cannot overwrite directory with non-directory",
	ERR_FS_EISDIR: "path is a directory",
};

// Mirrors `handleErrnoException` in @effect/platform-node-shared: only these
// codes map to a specific tag, everything else is "Unknown".
export const errnoTag = (code: string | undefined): SystemErrorTag => {
	switch (code) {
		case "ENOENT":
			return "NotFound";
		case "EACCES":
			return "PermissionDenied";
		case "EEXIST":
			return "AlreadyExists";
		case "EISDIR":
		case "ENOTDIR":
		case "ELOOP":
			return "BadResource";
		case "EBUSY":
			return "Busy";
		default:
			return "Unknown";
	}
};

/** The `cause` of an errno-backed failure: an `Error` carrying node's `code` (and `path` for path operations). */
export class ErrnoException extends Error {
	readonly code: ErrnoCode;
	readonly path: string | undefined;
	constructor(code: ErrnoCode, pathOrDescriptor: string | number | undefined) {
		super(`${code}: ${errnoMessages[code]}${typeof pathOrDescriptor === "string" ? `, '${pathOrDescriptor}'` : ""}`);
		this.code = code;
		this.path = typeof pathOrDescriptor === "string" ? pathOrDescriptor : undefined;
	}
}

export const errnoError = (
	method: string,
	pathOrDescriptor: string | number,
	code: ErrnoCode,
	description?: string,
): PlatformError =>
	systemError({
		module: "FileSystem",
		_tag: errnoTag(code),
		method,
		pathOrDescriptor,
		description,
		cause: new ErrnoException(code, pathOrDescriptor),
	});

/** The error a synchronous `node:fs` call throws: an `Error` carrying `code`, `syscall` and `path`. */
export type NodeErrnoError = Error & { readonly code: string; readonly syscall: string; readonly path: string };

export const nodeErrno = (code: string, syscall: string, path: string): NodeErrnoError => {
	const message = (errnoMessages as Record<string, string | undefined>)[code];
	return Object.assign(new Error(`${code}: ${message ?? "error"}, ${syscall} '${path}'`), { code, syscall, path });
};
