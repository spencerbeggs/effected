---
"@effected/xdg": minor
---

## Features

A program that follows a shell rule such as `XDG_STATE_HOME:-HOME/.local/state` can now use `Xdg`. Both departures from the XDG spec are opt-in through `XdgEnvOptions`; every default stays the spec (#1119).

* `Xdg.layerWith(options)`, plus an options argument on `layerFromEnv`.
* `homeFallback` replaces only a missing home, never a set one.
* `relativeHomes: "keep"` uses a relative XDG home value as given instead of discarding it.
* The runtime directory and the search paths keep the spec rule.
