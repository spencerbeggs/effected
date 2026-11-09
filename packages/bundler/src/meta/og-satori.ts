import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { OgImageGenerator, OgImageInfo } from "./bundle-config.js";

/**
 * The bundled Inter SemiBold face (SIL OFL 1.1; see `assets/LICENSE-Inter.txt`). Resolved
 * relative to THIS module: the built `meta/og-satori.js` reaches `assets/` at the package root, while
 * the source `src/meta/og-satori.ts` reaches it through `public/`, so both candidates are tried.
 */
const FONT_CANDIDATES = [
	new URL("../assets/Inter-SemiBold.ttf", import.meta.url),
	new URL("../../public/assets/Inter-SemiBold.ttf", import.meta.url),
];

function fontPath(): string {
	for (const candidate of FONT_CANDIDATES) {
		const path = fileURLToPath(candidate);
		if (existsSync(path)) return path;
	}
	throw new Error("ogImage.satori() could not locate its bundled font assets/Inter-SemiBold.ttf");
}

/** The installed version of an optional renderer peer, or `"absent"` (rendering then fails, and nothing is cached). */
function peerVersion(name: string): string {
	try {
		const manifest = createRequire(import.meta.url).resolve(`${name}/package.json`);
		return (JSON.parse(readFileSync(manifest, "utf-8")) as { version?: string }).version ?? "unknown";
	} catch {
		return "absent";
	}
}

async function loadRenderers(): Promise<{
	satori: typeof import("satori").default;
	Resvg: typeof import("@resvg/resvg-js").Resvg;
}> {
	try {
		const [{ default: satori }, { Resvg }] = await Promise.all([import("satori"), import("@resvg/resvg-js")]);
		return { satori, Resvg };
	} catch (cause) {
		throw new Error(
			"ogImage.satori() needs the optional peers satori and @resvg/resvg-js; install both to generate Open Graph images",
			{ cause },
		);
	}
}

/**
 * Colors for the default Open Graph card.
 *
 * @public
 */
export interface SatoriOgOptions {
	/** The project-name accent (CSS color). */
	readonly accent?: string | undefined;
	readonly background?: string | undefined;
	readonly foreground?: string | undefined;
}

/** The resolved palette: every option with its default applied. */
interface Colors {
	readonly accent: string;
	readonly background: string;
	readonly foreground: string;
}

/** The subset of satori's element tree this renderer emits. */
interface OgNode {
	readonly type: "div";
	readonly props: {
		readonly style: Record<string, string | number>;
		readonly children: string | ReadonlyArray<OgNode>;
	};
}

function card(info: OgImageInfo, colors: Colors): OgNode {
	const text = (style: Record<string, string | number>, children: string): OgNode => ({
		type: "div",
		props: { style, children },
	});
	return {
		type: "div",
		props: {
			style: {
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				width: "100%",
				height: "100%",
				padding: 64,
				background: colors.background,
				color: colors.foreground,
				fontFamily: "Inter",
			},
			children: [
				text({ fontSize: 32, color: colors.accent }, info.project?.name ?? ""),
				{
					type: "div",
					props: {
						style: { display: "flex", flexDirection: "column", gap: 16 },
						children: [
							text({ fontSize: 72, fontWeight: 600 }, info.name),
							text({ fontSize: 36, opacity: 0.8 }, info.tagline ?? info.description ?? ""),
						],
					},
				},
				text({ fontSize: 28, opacity: 0.7 }, `${info.packageName}@${info.version}`),
			],
		},
	};
}

/**
 * Build-time Open Graph image renderers for `[package.bundle.openGraph] generate`.
 *
 * @remarks
 * `satori()` returns the default card: project name, package name and version, tagline,
 * 1200×630 PNG, rendered through the optional peers `satori` and `@resvg/resvg-js`. The peers
 * load lazily on first render, so a build that does not generate an image never needs them.
 *
 * The returned generator carries a `cacheSalt` (this package's version, the peers' versions and
 * the colors), so its renders are cached across builds by default; `openGraph.cacheSalt: false`
 * turns that off.
 *
 * @public
 */
export const ogImage = {
	satori(options: SatoriOgOptions = {}): OgImageGenerator {
		const colors: Colors = {
			accent: options.accent ?? "#38bdf8",
			background: options.background ?? "#0f172a",
			foreground: options.foreground ?? "#f8fafc",
		};
		// Everything besides the info that shapes the bytes: the card layout and font ship with this
		// package's version, the colors are the options, and the two peers do the rendering.
		const cacheSalt = JSON.stringify({
			renderer: "@effected/bundler/og#satori",
			version: process.env.__PACKAGE_VERSION__ ?? "source",
			satori: peerVersion("satori"),
			resvg: peerVersion("@resvg/resvg-js"),
			colors,
		});
		const render = async (info: OgImageInfo): Promise<Uint8Array> => {
			const { satori, Resvg } = await loadRenderers();
			const font = await readFile(fontPath());
			// satori's element type is React's ReactNode; the plain `{ type, props }` tree is the shape it
			// walks at runtime, so the cast only bridges the nominal React typing.
			const svg = await satori(card(info, colors) as unknown as Parameters<typeof satori>[0], {
				width: 1200,
				height: 630,
				fonts: [{ name: "Inter", data: font, weight: 600, style: "normal" }],
			});
			return new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng());
		};
		return Object.assign(render, { cacheSalt });
	},
};
