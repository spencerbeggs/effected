# Glossary

* [Companion package](companion-package.md) - A published, installable package that is not a library — no API, nothing to import, no tier; the pnpm plugin and the schemastore bin.
* [Ghost workspace](ghost-workspace.md) - A pnpm workspace member that is real to the tooling but excluded from release, CI and coverage — committed shell, gitignored working areas.
* [Library tier (pure / boundary / integrated)](library-tier.md) - The three-way classification of an @effected library by its own runtime dependency surface, distinct from what its consumers pull in.
* [The github-split (program name)](github-split.md) - "The github-split" names the joint program that carved five packages — commands, templates, github, github-actions and sbom — out of @savvy-web/github-action-effects and the mechanism half of @savvy-web/silk-effects, replacing both wholesale across six consumer repos.
