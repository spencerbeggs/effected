---
applyTo: "**/*.md"
---

When editing any Markdown file (`*.md`), always run:

```bash
pnpm exec markdownlint-cli2 <file> --config .markdownlint.json --fix
```

This command auto-fixes Markdown issues and displays any remaining errors. Any unresolved errors should be reviewed and, if necessary, filed for further attention.
