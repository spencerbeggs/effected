---
"@effected/app": minor
---

## Features

### effected plugin: sharper planning and testing skill guidance

The bundled Effect v4 skills gain guidance drained from the round-4 dogfood
sweep, so the plugin versions with this release.

The planning gate now runs a placement check before design begins: it confirms
the target package's tier admits the capability, treating IO or a service in a
pure-tier package as a stop, and checks the dependency direction against the
peer graph so a capability that would close a cycle is caught up front. Its
contract inventory now greps the sibling packages rather than core alone,
because in this monorepo the likelier duplication is a sibling that already owns
the concept. Its delegated-subagent rule separates a decision that contradicts
the parent's instructions, which stops and asks, from one that exceeds them
without contradicting, which proceeds and flags the consequence in the report.

The testing skill's zero-collected-tests section gains the wrong-directory
producer: a root-relative project filter run from inside a package prints a
clean-looking zero and exits zero, so project-filtered runs belong at the repo
root.
