// The one string-to-string redaction entry point for a remote positional.
// Internal: not part of the package surface. Lives apart from `redact.ts`
// because `GitRemote` imports that module, so folding this in would be a cycle.
import { Option } from "effect";
import { GitRemote } from "../GitRemote.js";
import { MIN_SECRET_LENGTH, REDACTED, credentialSegments, maskUserinfoAnywhere } from "./redact.js";

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

/**
 * The exact secret strings {@link redactRemoteText} masks in a remote
 * positional, for masking the same text wherever git echoes it (stderr).
 *
 * @remarks
 * The form-independent userinfo segments of {@link credentialSegments}, plus
 * each URL part {@link GitRemote.redact} masks that those segments do not
 * reach: the query (everything after the path's first `?`, fragment included, which
 * carries no `@` for any segment or shape masker to find), and a scheme it
 * masks (outside RFC 3986's grammar, or unknown behind `<transport>::`).
 * The parts are read by comparing the parsed remote with its redaction, so a
 * new redaction rule there is covered here without a second copy of it.
 * Secrets under three characters are dropped, as {@link credentialSegments}
 * drops them. The bare `user` is deliberately not a secret: every replacement
 * is a free substring match, so an ordinary user name (`git`, the repository
 * owner) would mask host names, paths and prose. A URL echo carrying the user
 * is masked by the `user:password` segment, or, with the password stripped, by
 * the userinfo backstop the stored stderr passes through next.
 */
export const remoteSecrets = (text: string): ReadonlyArray<string> => {
	const secrets = new Set(credentialSegments(text));
	const parsed = GitRemote.parse(text);
	if (Option.isSome(parsed)) {
		const remote = parsed.value;
		const raw = remote._tag === "GitRemoteTransport" ? remote.address : remote;
		const redacted = GitRemote.redact(remote);
		const masked = redacted._tag === "GitRemoteTransport" ? redacted.address : redacted;
		if (raw._tag === "GitRemoteUrl" && masked._tag === "GitRemoteUrl") {
			if (masked.scheme !== raw.scheme) secrets.add(raw.scheme);
			const query = raw.path.indexOf("?");
			if (masked.path !== raw.path && query !== -1) secrets.add(raw.path.slice(query + 1));
		}
	}
	return [...secrets].filter((secret) => secret.length >= MIN_SECRET_LENGTH && secret !== REDACTED);
};
