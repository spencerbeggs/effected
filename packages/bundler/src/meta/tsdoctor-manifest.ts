import type { BundleManifest, OpenGraphImage, RegistryRef } from "./BundleManifest.js";
import { MANIFEST_SPEC } from "./BundleManifest.js";
import type { ManifestSource } from "./ManifestSource.js";
import type { OgImageInfo, TsdoctorMetaOptions } from "./tsdoctor-config.js";

/**
 * A `targets.json` target as the manifest composer sees it: the human label and the registry endpoint.
 *
 * @public
 */
export interface ManifestTarget {
	readonly name: string;
	readonly registry: string;
}

/**
 * Everything {@link composeTsdoctorManifest} needs: the three authoring tiers plus the build facts
 * that derive the rest.
 *
 * @public
 */
export interface ComposeManifestInput {
	readonly config: TsdoctorMetaOptions | undefined;
	readonly leaf: ManifestSource | undefined;
	readonly project: ManifestSource | undefined;
	readonly packageName: string;
	readonly isPrivate: boolean;
	/** `targets.json` targets for the group being emitted. */
	readonly targets: ReadonlyArray<ManifestTarget>;
	/** The image `og-image.ts` wrote, already sized. */
	readonly generatedImage: OpenGraphImage | undefined;
	/** The emitted manifest's `repository` field; a GitHub Packages target derives its page URL from it. */
	readonly repository?: ManifestRepository | undefined;
}

/**
 * The `repository` field of the emitted `package.json`, as far as the manifest composer reads it.
 *
 * @public
 */
export interface ManifestRepository {
	readonly url: string;
	readonly directory?: string | undefined;
}

const first = <A>(...values: ReadonlyArray<A | undefined>): A | undefined => values.find((v) => v !== undefined);

/**
 * `owner/repo` from any of the GitHub URL spellings a `repository.url` carries (https, `git+https`,
 * `git@`, `ssh://`, `git://`, the `github:` shorthand), or `undefined` for anything else.
 *
 * @public
 */
export function githubOwnerRepo(url: string): { readonly owner: string; readonly repo: string } | undefined {
	const match =
		/^(?:git\+)?(?:https?:\/\/|git:\/\/|ssh:\/\/(?:git@)?|git@)?(?:www\.)?github\.com[/:]([^/]{1,214})\/([^/]{1,214}?)(?:\.git)?\/?$/i.exec(
			url.trim(),
		) ?? /^github:([^/]{1,214})\/([^/]{1,214}?)(?:\.git)?$/i.exec(url.trim());
	if (match === null) return undefined;
	const owner = match[1];
	const repo = match[2];
	if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) return undefined;
	return { owner, repo };
}

function unscopedName(name: string): string {
	const slash = name.lastIndexOf("/");
	return slash >= 0 ? name.slice(slash + 1) : name;
}

/**
 * The package's human page on a registry, or `undefined` when no real page can be derived. npmjs
 * has a well-known page; GitHub Packages pages hang off the repository, so they need a parseable
 * `repository.url` and are omitted rather than emitted as a dead link when it is missing.
 */
/** Strip trailing slashes without a `/\/+$/` regex, which backtracks polynomially on slash runs (CodeQL js/polynomial-redos). */
function stripTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
	return value.slice(0, end);
}

function packagePageUrl(registry: string, packageName: string, repository: ManifestRepository | undefined) {
	const host = stripTrailingSlashes(registry);
	if (host === "https://registry.npmjs.org") return `https://www.npmjs.com/package/${packageName}`;
	if (/^https?:\/\/npm\.pkg\.github\.com$/i.test(host)) {
		const gh = repository !== undefined ? githubOwnerRepo(repository.url) : undefined;
		return gh === undefined
			? undefined
			: `https://github.com/${gh.owner}/${gh.repo}/pkgs/npm/${unscopedName(packageName)}`;
	}
	return `${host}/package/${packageName}`;
}

function projectIdentityOf(
	project: ManifestSource | undefined,
): { readonly name?: string; readonly tagline?: string } | undefined {
	if (project === undefined) return undefined;
	if (project.name === undefined && project.tagline === undefined) return undefined;
	return {
		...(project.name !== undefined ? { name: project.name } : {}),
		...(project.tagline !== undefined ? { tagline: project.tagline } : {}),
	};
}

/**
 * Derive the registries block from the build's targets. Only for a public
 * package: a private one is published nowhere.
 *
 * @public
 */
export function registriesFromTargets(
	input: Pick<ComposeManifestInput, "targets" | "packageName" | "isPrivate" | "repository">,
): ReadonlyArray<RegistryRef> {
	if (input.isPrivate) return [];
	const out: RegistryRef[] = [];
	for (const t of input.targets) {
		const url = packagePageUrl(t.registry, input.packageName, input.repository);
		if (url !== undefined) out.push({ type: "npm", name: t.name, url });
	}
	return out;
}

/**
 * Flatten the three authoring tiers into the emitted manifest. Pure.
 *
 * @remarks
 * Config beats leaf beats project per FIELD; the project tier is emitted
 * nested, never flattened, because the consumer's provenance ranking depends
 * on telling the tiers apart. Returns `undefined` when there is nothing to
 * say, so a package with no metadata emits no file. An `sbom` pointer is
 * never written here — the release action upserts it at publish.
 *
 * @public
 */
export function composeTsdoctorManifest(input: ComposeManifestInput): BundleManifest | undefined {
	const { config, leaf, project } = input;
	const images: OpenGraphImage[] = [
		...(input.generatedImage !== undefined ? [input.generatedImage] : []),
		...(config?.openGraph?.images ?? []),
		...(leaf?.openGraph?.images ?? []),
		...(project?.openGraph?.images ?? []),
	];
	const themeColor = first(config?.openGraph?.themeColor, leaf?.openGraph?.themeColor, project?.openGraph?.themeColor);
	const openGraph =
		images.length > 0 || themeColor !== undefined
			? { ...(images.length > 0 ? { images } : {}), ...(themeColor !== undefined ? { themeColor } : {}) }
			: undefined;

	const registries =
		config?.registries === false
			? undefined
			: (first(config?.registries, leaf?.registries) ?? registriesFromTargets(input));

	const name = first(config?.name, leaf?.name);
	const tagline = first(config?.tagline, leaf?.tagline);
	const description = first(config?.description, leaf?.description);
	const projectIdentity = projectIdentityOf(project);

	const manifest: BundleManifest = {
		spec: MANIFEST_SPEC,
		...(name !== undefined ? { name } : {}),
		...(tagline !== undefined ? { tagline } : {}),
		...(description !== undefined ? { description } : {}),
		...(projectIdentity !== undefined ? { project: projectIdentity } : {}),
		...(openGraph !== undefined ? { openGraph } : {}),
		...(registries !== undefined && registries.length > 0 ? { registries } : {}),
	};
	return Object.keys(manifest).length > 1 ? manifest : undefined;
}

/**
 * What the generator sees. Built from the same tiers as the manifest.
 *
 * @public
 */
export function ogImageInfoOf(input: ComposeManifestInput & { readonly version: string }): OgImageInfo {
	const { config, leaf, project } = input;
	const tagline = first(config?.tagline, leaf?.tagline, project?.tagline);
	const description = first(config?.description, leaf?.description);
	const projectIdentity = projectIdentityOf(project);
	return {
		name: first(config?.name, leaf?.name) ?? input.packageName,
		packageName: input.packageName,
		version: input.version,
		...(tagline !== undefined ? { tagline } : {}),
		...(description !== undefined ? { description } : {}),
		...(projectIdentity !== undefined ? { project: projectIdentity } : {}),
	};
}
