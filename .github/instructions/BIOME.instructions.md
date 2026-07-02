---
applyTo: "**/*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}"
---

When editing files matching these extensions, always run:

```bash
pnpm exec biome check --write --no-errors-on-unmatched <file>
```

This command will auto-fix supported issues and display any remaining errors. Review unresolved errors and file them for further attention if needed.
