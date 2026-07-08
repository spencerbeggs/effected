# @effected/pnpm-plugin-effect

[![npm](https://img.shields.io/npm/v/@effected%2Fpnpm-plugin-effect?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/pnpm-plugin-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-f69220.svg)](https://pnpm.io/)

A pnpm config dependency that centralizes Effect-ecosystem versioning through two [pnpm catalogs](https://pnpm.io/catalogs). The `effect` catalog pins every `effect` and `@effect/*` package to the latest [Effect v4](https://effect.website/blog/releases/effect/40-beta/) release. The `effectPeers` catalog resolves the same packages down to a calculated shared floor — the lowest common version safe to declare as a peer range — so your libraries don't over-constrain the projects that depend on them. Every `@effected/*` package uses these catalogs.

## Install

Add as a config dependency using pnpm:

```bash
pnpm add --config @effected/pnpm-plugin-effect
```

This adds the package to your `pnpm-workspace.yaml` with the required integrity hash (pnpm fills in the version and hash automatically):

```yaml
configDependencies:
  "@effected/pnpm-plugin-effect": <version>+sha512-...
```

## Usage

Installing the config dependency gives your workspace both catalogs. Reference them in `package.json` based on whether you are building an application or a library.

Applications reference the pinned versions directly in `dependencies`:

```json
{ "dependencies": { "effect": "catalog:effect", "@effect/ai-openai": "catalog:effect" } }
```

Libraries pin the same versions for development and declare the calculated floor as the peer range consumers must satisfy:

```json
{
  "devDependencies": { "effect": "catalog:effect", "@effect/ai-openai": "catalog:effect" },
  "peerDependencies": { "effect": "catalog:effectPeers", "@effect/ai-openai": "catalog:effectPeers" }
}
```

## License

[MIT](LICENSE)
