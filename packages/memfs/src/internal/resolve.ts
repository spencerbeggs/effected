// KIT EXTENSION (ports, errno fidelity). The synchronous path resolver behind
// the `node:fs` ports, and node's JS `realpath` walk, over any LITERAL tree:
// the inspection view (`MemoryFileSystemVolume`), or the engine's own state.
// Nothing here follows a link it was not asked to; `lstat` and `readLink` are
// literal, and every link is followed by this module.

import { lexicallyNormalized } from "./lexical.js";

/**
 * The two literal queries the walks need. A link is `"symlink"`, never its
 * target's kind, and a component under a link is absent: nothing is followed.
 *
 * @internal
 */
export interface LiteralTree {
	readonly lstat: (path: string) => { readonly kind: "file" | "directory" | "symlink" } | undefined;
	readonly readLink: (path: string) => string | undefined;
}

// The port is defined in `stat` terms, so it FOLLOWS symbolic links — unlike
// the literal inspection view it is built on. `MAX_LINK_HOPS` mirrors the
// ELOOP guard a real filesystem applies; the budget is ONE counter shared by
// the whole resolution (recursive target walks included), so a cycle spread
// across nested link targets terminates as ELOOP.
const MAX_LINK_HOPS = 40;

/** @internal */
export type Resolved = { readonly path: string } | { readonly code: "ENOENT" | "ENOTDIR" | "ELOOP" };

interface HopBudget {
	hops: number;
}

const walk = (tree: LiteralTree, path: string, followFinal: boolean, budget: HopBudget): Resolved => {
	// Resolution is per COMPONENT, not just the final one: `/links/pkg/a.json`
	// has to follow the link at `/links/pkg` before it can see `a.json`, exactly
	// as a real filesystem walks a path.
	let current = "";
	const parts = path.split("/").filter((part) => part !== "");
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === ".") {
			// `.` names the directory it is in, so under a non-directory it is
			// ENOTDIR exactly as `..` is (#1284) — never the file itself.
			const here = tree.lstat(current === "" ? "/" : current);
			if (here !== undefined && here.kind !== "directory") return { code: "ENOTDIR" };
			continue;
		}
		if (part === "..") {
			// `..` under a non-directory is ENOTDIR, as the kernel reports it.
			const here = tree.lstat(current === "" ? "/" : current);
			if (here !== undefined && here.kind !== "directory") return { code: "ENOTDIR" };
			// Applied to the RESOLVED location, so ".." after a link ascends from
			// the target rather than from the link's own parent.
			current = current.slice(0, Math.max(0, current.lastIndexOf("/")));
			continue;
		}
		// A component under something that is not a directory is ENOTDIR, not absence.
		const parent = tree.lstat(current === "" ? "/" : current);
		if (parent !== undefined && parent.kind !== "directory") return { code: "ENOTDIR" };
		let candidate = `${current}/${part}`;
		if (i < parts.length - 1 || followFinal) {
			for (;;) {
				const target = tree.readLink(candidate);
				if (target === undefined) break;
				// An empty target names nothing: macOS stores the link and answers
				// ENOENT through it (Linux refuses to create it), so it must not
				// join as `${current}/` and land on the link's own parent.
				if (target === "") return { code: "ENOENT" };
				budget.hops += 1;
				if (budget.hops > MAX_LINK_HOPS) return { code: "ELOOP" };
				const resolved = walk(tree, target.startsWith("/") ? target : `${current}/${target}`, true, budget);
				if ("code" in resolved) return resolved;
				candidate = resolved.path;
			}
		}
		if (tree.lstat(candidate) === undefined) return { code: "ENOENT" };
		current = candidate;
	}
	return { path: current === "" ? "/" : current };
};

/**
 * Resolves `path` the way `stat` (or, with `followFinal: false`, `lstat`) does,
 * reporting WHY it is absent: `ENOENT`, `ENOTDIR` (a component under a
 * non-directory) or `ELOOP` (too many links).
 *
 * @internal
 */
export const resolvePath = (tree: LiteralTree, path: string, followFinal = true): Resolved => {
	// A trailing slash asserts "this is a directory", as on node: the final
	// link is followed even for `lstat`, and a resolved non-directory is
	// ENOTDIR — never the file itself (which `walk`, dropping the empty
	// segment, would otherwise answer).
	const trailingSlash = path.length > 1 && path.endsWith("/");
	const r = walk(tree, path, followFinal || trailingSlash, { hops: 0 });
	if (trailingSlash && !("code" in r) && tree.lstat(r.path)?.kind !== "directory") return { code: "ENOTDIR" };
	return r;
};

/** @internal */
export type RealPath =
	| { readonly path: string }
	| { readonly code: "ENOENT" | "ENOTDIR" | "ELOOP"; readonly syscall: "lstat" | "stat"; readonly path: string };

/**
 * node's JS `fs.realpath` / `fs.realpathSync` walk (errno fidelity, #1328 and
 * #1339) — the one the platform adapter and the ports mirror, never
 * `.native`. It folds the path lexically, then walks it a component at a
 * time: an `lstat` of the prefix built so far (links before it already
 * resolved), and for a link a PHYSICAL `stat` of that same prefix before
 * `readlink`, the target joined LEXICALLY with the rest (`path.resolve`) and
 * the walk restarted from the root. So `a -> sub/../b` answers the `b` beside
 * `a` even when `sub` is a link elsewhere, and needs the physical target to
 * exist too. A failure is the `lstat` or `stat` it happened in, naming that
 * prefix — the path is not the caller's when a link or a deeper component
 * failed. Host-probed identical on macOS and Linux.
 *
 * @internal
 */
export const realPathOf = (tree: LiteralTree, path: string): RealPath => {
	let remaining = lexicallyNormalized(path)
		.split("/")
		.filter((part) => part !== "");
	let resolved = "";
	const hard = new Set<string>();
	let restarts = 0;
	while (remaining.length > 0) {
		const base = `${resolved}/${remaining[0]}`;
		remaining = remaining.slice(1);
		if (hard.has(base)) {
			resolved = base;
			continue;
		}
		const entry = tree.lstat(base);
		if (entry === undefined) {
			// The prefix is link-free, so its literal kind is its real one.
			const parent = tree.lstat(resolved === "" ? "/" : resolved);
			const code = parent === undefined || parent.kind === "directory" ? "ENOENT" : "ENOTDIR";
			return { code, syscall: "lstat", path: base };
		}
		if (entry.kind !== "symlink") {
			hard.add(base);
			resolved = base;
			continue;
		}
		const followed = resolvePath(tree, base);
		restarts += 1;
		if ("code" in followed || restarts > MAX_LINK_HOPS) {
			return { code: "code" in followed ? followed.code : "ELOOP", syscall: "stat", path: base };
		}
		const target = tree.readLink(base) ?? "";
		const joined = target.startsWith("/") ? target : `${resolved}/${target}`;
		remaining = lexicallyNormalized(`${joined}/${remaining.join("/")}`)
			.split("/")
			.filter((part) => part !== "");
		resolved = "";
	}
	return { path: resolved === "" ? "/" : resolved };
};
