---
id: "0023"
title: "@effected/walker: record mode reports links to devices, FIFOs and sockets as a new SkippedLink kind \"special\""
kind: breaking
shows: behavioural
applies:
  "@effected/walker": ">=0.32.0"
detect: ["SkippedLink", "kind [!=]== *[\"'](dangling|directory)[\"']", "case *[\"'](dangling|directory)[\"']"]
closes: ["#1437"]
changesets: ["walker-special-links", "breaking-floor-effected-app", "breaking-floor-effected-cli-kit", "breaking-floor-effected-config-file", "breaking-floor-effected-tsconfig-json", "breaking-floor-effected-xdg"]
---

Under `onUnreadable: "record"`, the `links` of `descend`, `descendEntries` and their sync twins now include every symbolic link whose target is neither a regular file nor a directory (a character or block device, a FIFO, a socket: `notes.md -> /dev/null`), as a `SkippedLink` with `kind: "special"`. Before, such a link appeared nowhere: not in `links` and not in `matches`. It is still never matched or opened.

- **Break.** `SkippedLink["kind"]` widens to `"directory" | "dangling" | "special"`. An exhaustive `switch` over it stops compiling; handle `"special"`.
- **Silent break.** Code that tests one kind and treats the rest as the other (`if (link.kind === "dangling") … else` handled as a directory link, or `link.kind === "directory" ? … : …` handled as a dangling one) still compiles, and now sends every special link down the other branch. Find each such branch and give `"special"` its own handling: report it as a link to a special file, not as a directory link. If the message must name the file type, `stat` the link's own path under `cwd`, which follows the link; never `stat` the raw `target` text, which may be relative to the link's directory.
- **Adopt.** If the project runs its own `lstat`/`stat` pass to find links to special files, `links` can replace it only where the record-mode walk reads every directory that pass covers: `links` sees only directories the walk reads, so nothing under a pruned or boundary directory, or outside the pattern's reach (`src/*.ts` never reads `assets/`). From a sync port, it also needs `readLink`. Keep the pass for anything the walk does not read.

`@effected/app`, `@effected/cli-kit`, `@effected/config-file`, `@effected/tsconfig-json` and `@effected/xdg` raise their peer on `@effected/walker` across that line, so they publish as minors too: upgrade them together with `walker`. Check the installed `.d.ts` for the exact shapes.
