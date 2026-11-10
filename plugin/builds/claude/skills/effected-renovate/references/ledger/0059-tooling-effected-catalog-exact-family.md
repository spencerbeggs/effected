---
id: "0059"
title: "The effected catalog serves the Effect family at exact versions: spell peers catalog:effected:peers, and re-export or delete a local catalogs.effected block"
kind: tooling
shows: none
applies:
  "@effected/pnpm-plugin-effected": ">=0.25.1"
detect: ["^[[:space:]]+effected:[[:space:]]*$", "\"peerDependencies\"[^}]*\"catalog:effected(:build)?\""]
changesets: ["effect-413-catalog-pin"]
---

This applies to a repository that has `@effected/pnpm-plugin-effected` as a config dependency and writes `catalog:effected` in its manifests. pnpm never applies a version-selector override such as `effect@^4.0.0` to a `catalog:` specifier (pnpm/pnpm#17922). So while the catalog served `effect: ~4.1.2`, a repository that wrote `catalog:effected` resolved `effect@4.1.3` beside the pinned 4.1.2 as soon as 4.1.3 published: two copies of `effect`. The plugin now serves every Effect-family entry it pins graph-wide at the exact override version, for example `effect: 4.1.3`. The `@effected/*` entries keep their caret ranges.

- **A local `catalogs.effected` block wins over the plugin's catalog.** If your `pnpm-workspace.yaml` carries one, written by an earlier `rolldown-pnpm-config export` or by hand, it still holds the old `~` ranges and you are still exposed. The search finds an `effected:` key nested under `catalogs:`; read each hit to confirm. Re-run the export so the block takes the exact versions, or delete the block and let the plugin serve the catalog. Do not hand-edit the family versions: they move with the plugin.
- After the install, the lockfile should resolve exactly one `effect`. Check with `grep -oE "^  effect@[0-9][^:(]*" pnpm-lock.yaml | sort -u`, which must print one line.
- **Spell every peer `catalog:effected:peers`, never `catalog:effected`.** The plugin now serves the peers twins, `effected:peers` and `effected:build:peers`, which floor each range to its minor (`~4.1.0` for the Effect family, `^0.<minor>.0` for a kit package). `pnpm pack` writes a `catalog:` peer as the served catalog's value, so a peer spelled `catalog:effected` now publishes an exact version, `"effect": "4.1.3"`, and pins every consumer of your library to that patch. Rewrite each Effect-family or `@effected/*` peer that reads `catalog:effected` to `catalog:effected:peers`, and each `catalog:effected:build` peer to `catalog:effected:build:peers`. Keep `catalog:effected` in `dependencies` and `devDependencies`, where the exact pin is what you want.
- **The search cannot find most such peers.** `git grep` reads one line at a time, so its peer pattern only finds a `peerDependencies` object written on one line. List the rest with `for f in $(git ls-files '*package.json'); do jq -r --arg f "$f" '(.peerDependencies // {}) | to_entries[] | select(.value == "catalog:effected" or .value == "catalog:effected:build") | "\($f): \(.key)"' "$f"; done`, and rewrite every package it prints.

Verify with `pnpm install`, then the lockfile check above, then `pnpm pack` in one library: its packed `peerDependencies` must show `~4.<minor>.0`, not an exact version. Then run your build and tests.
