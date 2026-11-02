---
id: "0001"
title: Repin vendored Effect source to the installed release
kind: tooling
shows: none
applies:
  effect: ">=4.1.0"
detect: ["^\\[submodule \"([^\"]*/)?effect\"\\]"]
---

If this repository vendors Effect source (usually `.repos/effect`, registered in `.gitmodules`; the detect pattern finds that registration), repin it to the tag matching the `effect` you now resolve before you touch code. The vendored tree is the authority on what Effect exports, and it must agree with the installed package, or every API check you make against it is wrong.

Repin through the repository's own tooling, for example `savvy repos pin effect effect@<version>` or the `repos_manage` MCP tool with `action: "pin"`. Review any stale notes it reports. Commit the pin together with the lockfile move, never separately. Never write under the vendored tree by hand and never run git inside it.

If no detect hit names a vendored Effect tree, skip this entry.
