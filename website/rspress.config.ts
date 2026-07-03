import { join } from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginSitemap } from "@rspress/plugin-sitemap";
import { ApiExtractorPlugin } from "rspress-plugin-api-extractor";
import mermaid from "rspress-plugin-mermaid";

export default defineConfig({
	root: "docs",
	outDir: "dist",
	lang: "en",
	locales: [
		{
			lang: "en",
			label: "English",
		},
	],
	title: "Effected | Persistent test-run memory for LLM coding agents",
	description:
		"An Effected plugin, CLI and MCP server family that gives AI coding agents structured, token-efficient test feedback and a disciplined TDD workflow.",
	themeConfig: {
		socialLinks: [{ icon: "github", mode: "link", content: "https://github.com/spencerbeggs/vitest-agent" }],
		llmsUI: {
			viewOptions: ["markdownLink", "chatgpt", "claude"],
			placement: "outline",
		},
	},
	markdown: {
		link: {
			checkDeadLinks: false,
		},
	},
	llms: true,
	route: { cleanUrls: true },
	head: [
		'<link rel="icon" href="/favicon.ico" sizes="any">',
		'<link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png">',
		'<link rel="icon" type="image/png" sizes="16x16" href="/images/favicon-16.png">',
		'<link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png">',
		'<link rel="manifest" href="/site.webmanifest">',
		'<meta name="theme-color" content="#D6219B">',
	],

	globalStyles: join(import.meta.dirname, "theme/vitest-agent-theme.css"),
	logo: { light: "/images/logo-horizontal.svg", dark: "/images/logo-horizontal-dark.svg" },
	icon: "/images/favicon-32x32.png",
	plugins: [
		ApiExtractorPlugin({
			siteUrl: "https://effected.spencerbeg.gs",
			ogImage: {
				url: "https://effected.spencerbeg.gs/og-image.png",
			},
			apis: ApiExtractorPlugin.apis.fromDir("./lib/models"),
			observability: {
				logLevel: "info",
			},
		}),
		pluginSitemap({
			siteUrl: "https://effected.spencerbeg.gs",
		}),
		mermaid(),
	],
});
