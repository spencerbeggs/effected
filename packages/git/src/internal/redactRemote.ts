// The one string-to-string redaction entry point for a remote positional.
// Internal: not part of the package surface. Lives apart from `redact.ts`
// because `GitRemote` imports that module, so folding this in would be a cycle.
import { Option } from "effect";
import { GitRemote } from "../GitRemote.js";
import { maskUserinfoAnywhere } from "./redact.js";

/**
 * Masks the credential positions of any remote text, total over a string.
 *
 * @remarks
 * A URL remote (`scheme://user:token@host/...`, bare or behind
 * `<transport>::`) goes through {@link GitRemote.redact}: the password is
 * dropped, the user, query and any invalid scheme are masked, and the
 * userinfo is found at the LAST `@`, so a password holding `@`, `/`, `?` or
 * `#` is consumed whole. Anything else — a blank string included — goes
 * through the form-independent {@link maskUserinfoAnywhere} backstop, so a
 * typo'd or malformed credential URL is masked whatever form it parses as.
 *
 * A remote name, a credential-free URL and a plain scp `git@host:path` pass
 * through untouched. An `@` in a URL path is read as userinfo and over-masks
 * by design.
 */
export const redactRemoteText = (text: string): string => {
	const parsed = GitRemote.parse(text);
	if (Option.isNone(parsed)) return maskUserinfoAnywhere(text);
	const remote = parsed.value;
	const address = remote._tag === "GitRemoteTransport" ? remote.address : remote;
	return address._tag === "GitRemoteUrl" ? GitRemote.format(GitRemote.redact(remote)) : maskUserinfoAnywhere(text);
};
