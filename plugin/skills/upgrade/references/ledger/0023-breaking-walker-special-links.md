---
id: "0023"
title: "@effected/walker: record mode reports links to devices, FIFOs and sockets as a new SkippedLink kind \"special\""
kind: breaking
shows: behavioural
applies:
  "@effected/walker": ">=0.32.0"
detect: ["SkippedLink", "kind [!=]== *[\"']dangling[\"']", "case *[\"']dangling[\"']"]
closes: ["#1437"]
changesets: ["walker-special-links", "breaking-floor-effected-app", "breaking-floor-effected-cli-kit", "breaking-floor-effected-config-file", "breaking-floor-effected-tsconfig-json", "breaking-floor-effected-xdg"]
---

Under `onUnreadable: "record"`, the `links` of `descend`, `descendEntries` and their sync twins now include every symbolic link whose target is neither a regular file nor a directory (a character or block device, a FIFO, a socket: `notes.md -> /dev/null`), as a `SkippedLink` with `kind: "special"`. Before, such a link appeared nowhere: not in `links` and not in `matches`. It is still never matched or opened.

- **Break.** `SkippedLink["kind"]` widens to `"directory" | "dangling" | "special"`. An exhaustive `switch` over it stops compiling; handle `"special"`.
- **Silent break.** Code that tests one kind and treats the rest as the other (`if (link.kind === "dangling") … else` handled as a directory link) still compiles, and now sends every special link down the directory branch. Find each such branch and give `"special"` its own handling: report it as a link to a special file, not as a directory link. `target` is the link's raw text; `stat` it if the message must name the file type.
- **Adopt.** If the project ran its own `lstat`/`stat` pass to find links to special files the walk dropped, use `links` instead.

`@effected/app`, `@effected/cli-kit`, `@effected/config-file`, `@effected/tsconfig-json` and `@effected/xdg` raise their peer on `@effected/walker` across that line, so they publish as minors too: upgrade them together with `walker`. Check the installed `.d.ts` for the exact shapes.
