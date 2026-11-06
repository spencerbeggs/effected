import type { OpenGraphImage, RegistryRef } from "@tsdoctor/manifest";

/**
 * What an Open Graph image generator receives: the merged identity of the
 * package being built, after the config, leaf and project tiers resolved.
 *
 * @public
 */
export interface OgImageInfo {
	/** Display name — the merged `name`, falling back to the npm name. */
	readonly name: string;
	/** The npm package name. */
	readonly packageName: string;
	/** The emitted version (the optimistic next version when enabled). */
	readonly version: string;
	readonly tagline?: string | undefined;
	readonly description?: string | undefined;
	/** The inherited project tier, when the workspace root declares one. */
	readonly project?: { readonly name?: string | undefined; readonly tagline?: string | undefined } | undefined;
}

/**
 * An `openGraph.generate` renderer. A renderer whose output is fully determined by its input can
 * carry its own `cacheSalt`, naming everything else that shapes the bytes (its version, its
 * options); that turns on the cross-build cache without any config. `ogImage.satori()` does.
 *
 * @public
 */
export interface OgImageGenerator {
	(info: OgImageInfo): Promise<Uint8Array>;
	readonly cacheSalt?: string | undefined;
}

/**
 * The `meta.tsdoctor` block: the CONFIG tier of the emitted `tsdoctor.json`,
 * ranked over the package's `tsdoctor.json` (leaf) and the workspace root's
 * (project).
 *
 * @public
 */
export interface TsdoctorMetaOptions {
	readonly name?: string | undefined;
	readonly tagline?: string | undefined;
	readonly description?: string | undefined;
	readonly openGraph?:
		| {
				/** Static images, path (bundle-relative) or url. Listed after a generated image. */
				readonly images?: ReadonlyArray<OpenGraphImage> | undefined;
				readonly themeColor?: string | undefined;
				/** Render an image at build time; the bytes are written to `meta/og/<unscoped>.<png|jpg|webp>` and listed first. */
				readonly generate?: OgImageGenerator | undefined;
				/**
				 * The cross-build image cache, keyed on the {@link OgImageInfo} plus this salt. A string
				 * caches under it: change it whenever the generator's output changes for the same input,
				 * since the cache cannot see code. `false` always regenerates. Omitted, the generator's own
				 * {@link OgImageGenerator.cacheSalt} is used when it has one, otherwise it always regenerates.
				 */
				readonly cacheSalt?: string | false | undefined;
		  }
		| undefined;
	/** Registries; `false` disables the default derived from `targets.json`. */
	readonly registries?: ReadonlyArray<RegistryRef> | false | undefined;
}
