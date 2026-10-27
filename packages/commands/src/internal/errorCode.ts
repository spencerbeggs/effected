// The `code` of a thrown value (`"MODULE_NOT_FOUND"`, `"ENOENT"`), shared by
// the resolution and filesystem code that branches on one. Platform-free.

/** The `code` property of `error` when it is an object carrying one; `undefined` otherwise. */
export const errorCode = (error: unknown): unknown =>
	typeof error === "object" && error !== null ? (error as { readonly code?: unknown }).code : undefined;
