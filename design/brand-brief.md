# effected — brand & asset brief

A design brief for building the visual identity and asset system for **effected**, an open-source developer library ecosystem. Deliver a cohesive design system plus a set of production assets, all theme-aware (light **and** dark) and accessible (WCAG AA).

## Project context

**effected** (lowercase; npm org `@effected`) is an open-source ecosystem of 18 Effect v4 TypeScript libraries.

> **Tagline:** The unglamorous app plumbing that Effect leaves to you, done right.

It provides the boring-but-essential machinery every CLI, dev tool, and service needs — reading and writing config files, parsing `package.json` and `tsconfig.json`, walking a monorepo's workspaces and lockfiles, shelling out to git, resolving semver ranges and runtime versions, finding the right XDG directory, keeping a little durable state on disk — all as typed Effect schemas and composable services.

- **Audience:** TypeScript / Effect developers building CLIs, dev tools, and services.
- **Repo:** <https://github.com/spencerbeggs/effected> (connected to this project — read the README for the tagline, the package tables, the four tier definitions, and each package's one-line description; those are the source of truth for names and copy).
- **Docs:** an RSPress site (theme-aware, light + dark).
- **Relationship to Effect:** built on Effect v4. Harmonize with Effect's visual world so it reads as part of that ecosystem, but stay clearly distinct — do not copy Effect's mark or palette.
- **Status:** shipping `0.1.0` as a pre-release; every package is currently marked `unstable`.

The 18 packages fall into **four tiers** by dependency surface — **integrated, boundary, pure, companion**. Treat that as a reusable visual language: one accent color and one icon per tier, used consistently across the docs, badges, and per-package OG images. Definitions and the full package list (name / slug / tier / description) are in the accompanying `packages.json`.

## Brand personality

Precise, foundational, developer-credible, quietly confident — *the reliable plumbing you never think about, done right.* Warm, not corporate-sterile; the mascot carries the warmth. Available metaphors: plumbing / pipes / fittings, foundations / blueprints, layers, and the wordplay on "effected" (past participle of *effect* — brought about, accomplished).

## Mascot: the bored plumber

The mascot is a **bored, deadpan plumber**, and the joke sits directly on the tagline: effected's plumbing is so reliable and so well-made that the plumber has nothing left to fix — so they're quietly, comfortably bored. Competent, unbothered, seen-it-all. Not grumpy or lazy — *relaxed to the point of ennui, because everything just works.*

- **Personality:** deadpan, dry, unflappable, quietly expert. The energy of someone who has fixed every pipe there is and now just... watches them not leak.
- **Visual traits:** work overalls / dungarees, a classic pipe wrench they rarely need, a tool belt that stays clipped shut, maybe a flat cap or rolled beanie. Clean and a little stylized — modern and developer-friendly, not a cartoon cliché. Neutral / androgynous is fine.
- **Signature pose:** leaning on the upright wrench with a flat, half-lidded expression. Optionally sitting on a length of gleaming, leak-free pipe with a coffee, feet up, phone out — waiting for a call that never comes.
- **Character sheet to deliver:** (1) the signature deadpan lean; (2) "everything's fine" — feet up, coffee in hand; (3) a small "huh, still not leaking" glance at a perfect pipe joint; (4) a subtle approving nod / small thumbs-up (for success and callout states). Plus a spec (proportions, palette, construction) so the character is reusable.
- **Name:** open — deadpan options: *Gus*, *Murph*, *Flo* (a flow pun), or just *Pipe*. Pick one or leave it for later.
- **Where the mascot appears:** the deadpan lean in the docs corner and OG hero art; "everything's fine" on the 404 / empty state; the approving nod for success callouts.

## Deliverables

Produce **light and dark** variants throughout, WCAG AA contrast, SVG where scalable plus rendered PNGs at the required pixel sizes.

### 1. Design system / tokens (for the RSPress docs site)

- A palette: primary, accent, neutrals, and semantic success / warning / error / info — in both light and dark modes.
- Type scale and font choices: a readable sans for body, a mono for code.
- Component tokens: links, code blocks, admonitions / callouts, tables, badges, inline code.
- The **four-tier visual language**: a color and an icon for each of integrated / boundary / pure / companion, reused across docs and OG images.
- Output as CSS custom properties and/or JSON design tokens that can be wired into RSPress.

### 2. Logo

- A `effected` wordmark plus a standalone **mark** that reads at 16px and on a sticker. Consider a pipe-fitting / wrench motif, or a monogram, that can also read as an icon.
- Light, dark, and single-color variants, delivered as SVG. The mark seeds the favicon and the avatars.

### 3. Mascot character (the bored plumber, above)

Character sheet + reuse spec, as described.

### 4. Favicons

From the mark: an SVG favicon, 16 / 32 / 48 PNG, an apple-touch-icon (180), and a maskable icon — with light and dark variants (the SVG can adapt via `prefers-color-scheme`).

### 5. GitHub social preview image

1280×640, safe-area aware — wordmark + tagline + mascot on an on-brand background. (This is the repo's "Social preview" setting.)

### 6. Open Graph image — overall project

1200×630 — wordmark + tagline + mascot.

### 7. Templated per-package Open Graph images (data-driven)

A **single reusable 1200×630 template** with swappable slots for the package **name** (e.g. `@effected/git`), its **one-line description**, and its **tier accent** (color + icon), so all 18 render programmatically rather than by hand. Deliver the template as SVG or HTML with clearly-marked variables, **plus the 18 rendered outputs**. Drive it from `packages.json` (name / slug / tier / description for all 18). A slug like `git` maps to the filename (e.g. `og/git.png`).

### 8. Mermaid / diagram theme

The docs use mermaid diagrams — a diagram theme (colors, node/edge styles) matching the palette, for light and dark.

### 9. Avatars

Square avatars for the npm org and the GitHub profile, derived from the mark (and optionally a mascot variant).

### 10. Docs section / nav icons

A small icon set for the docs navigation. The four tier icons double as category markers.

### 11. 404 / empty-state illustration

Featuring the "everything's fine" mascot pose.

### 12. Terminal / CLI treatment

A styled treatment for hero code samples and terminal snippets — it's dev tooling, so a credible terminal aesthetic (prompt, window chrome, syntax palette) that matches the tokens.

### 13. Release announcement graphics

Social-post templates for the `0.1.0` announcement (and a reusable shape for future releases).

### 14. One-page brand guide

Logo usage, color, spacing, mascot do's and don'ts — so future assets stay consistent.

## Constraints & reusability

- Everything theme-aware (light + dark) and WCAG AA.
- The per-package OG template must be **data-driven** (swap name / description / tier) and renderable in CI — prefer an SVG or HTML template over 18 hand-built images.
- The assets and the RSPress site share **one** token system.
- Deliver SVG (scalable) plus rendered PNGs at the required pixel sizes, organized so filenames map to package slugs.

## Data

`packages.json` (alongside this brief) carries the project metadata, the four tier definitions, and all 18 packages as `{ name, slug, tier, stability, description }` — the source of truth for the per-package OG template, the docs, and any badges. Since the repo is connected, you can also read the same content live from the README.
