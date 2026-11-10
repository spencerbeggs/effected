---
id: "0049"
title: "@effected/semver reads an empty || part as *, so a range with a leading, trailing or doubled || matches every version"
kind: behaviour
shows: behavioural
applies:
  "@effected/semver": ">=0.23.0"
detect: ["[0-9xX*][[:space:]]*\\|\\|[[:space:]]*[\"'`]", "[\"'`][[:space:]]*\\|\\|[[:space:]]*[~^<>=0-9xX*v]", "\\|\\|[[:space:]]*\\|\\|"]
changesets: ["semver-written-sets"]
---

This applies to code that parses ranges with `@effected/semver` (`Range.parse`, `Range.parseResult`, `Range.FromString`, `VersionCache.resolveString`), or with a kit package that parses through it. An empty part beside `||` now matches every version, which is what npm does: node-semver splits a range on `||` and reads an empty part as `*`. Before, such a range failed `InvalidRangeError`. Effect core's `SemVerRange` still rejects it.

- **A typo now widens instead of failing.** `^1.0.0 ||`, `|| ^1.0.0`, `^1.0.0 || || ^2.0.0` and a bare `||` all parse, and each matches every release. A typo that used to stop a run now accepts any version, with no error. Find each range literal the detect patterns hit and drop the stray `||` unless you meant "any version".
- **Code that relied on the failure must check for it itself.** If you validate user-supplied ranges by catching `InvalidRangeError`, an empty part no longer reaches that branch. To keep refusing it, test `range.isAny()` after parsing, or reject a blank part between `||` before you parse.
- A test that pinned the old rejection (asserting `InvalidRangeError` for one of these inputs) now fails. Update it to the npm answer: the range parses, and `isAny()` is `true`.

Check the installed `.d.ts` for the exact shapes. Verify by parsing `^1.0.0 ||`, then asserting it succeeds, that `isAny()` is `true`, and that it matches `9.0.0`.
