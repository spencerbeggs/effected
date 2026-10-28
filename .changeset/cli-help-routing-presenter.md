---
"@effected/cli": patch
---

## Bug Fixes

- `CliRuntime.main` with `helpOnUsageError: "stderr"` now routes a usage error's help through core's `CliOutput.Presenter`. A `CliOutput.Formatter` or `Console` provided inside the program is honoured: its help goes to stderr beside the errors instead of staying on stdout. A `CliOutput.Presenter` provided inside the program replaces the routing.
