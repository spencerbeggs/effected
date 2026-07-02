---
applyTo: "**/*.{yml,yaml}"
---

When editing YAML files (excluding `pnpm-lock.yaml` and `pnpm-workspace.yaml`), always run:

```bash
pnpm dlx prettier --write <file>
pnpm dlx yaml-lint <file>
```

This will format and lint YAML files. Review any remaining errors and file them for further attention if needed.
