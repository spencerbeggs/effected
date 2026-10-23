---
"@effected/xdg": minor
---

## Breaking Changes

These changes alter how directories resolve; types are unchanged.

- `Xdg.layer` ignores a relative `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` or `XDG_RUNTIME_DIR`, as the XDG spec requires. The value is treated as unset and resolution falls to the next source.
- Relative entries are dropped from `XDG_CONFIG_DIRS` and `XDG_DATA_DIRS`. A list left empty takes the spec default.
- `APPDATA` and `LOCALAPPDATA` are always judged by the win32 absolute-path rule. A relative value is dropped, and `NativeDirs` falls back to `<home>/AppData/Roaming` or `<home>/AppData/Local`.
- On win32, home is `USERPROFILE`, then `HOME`. When neither is set, `XdgEnvError.variable` is `USERPROFILE` (previously `HOME`) and the message names both.
- On win32, `XDG_CONFIG_DIRS` and `XDG_DATA_DIRS` split on `;` instead of `:`.
- `Xdg.layer` reads `CurrentPlatform`. It is a `Context.Reference`, so `R` does not change; an app that overrides the platform should provide it once, at the edge.
