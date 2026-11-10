import { defineConfig } from "pluginfinity";

export default defineConfig({
	name: "effected",
	// One description reaches every manifest: pluginfinity has no per-target plugin description, so the monitor,
	// which Copilot does not ship, is named as Claude Code's.
	description:
		"Effect v4 development skills, a GitHub Actions and GitHub API suite, kit build and TSDoc guidance, specialist subagents (developer, reviewer, action-engineer, tsdoc-fixer), a build-diagnostics monitor on Claude Code, and a session briefing, distilled from the @effected packages and the official Effect-TS v4 guides.",
	author: { name: "C. Spencer Beggs", email: "spencer@beggs.codes", url: "https://spencerbeg.gs" },
	homepage: "https://github.com/spencerbeggs/effected",
	repository: "https://github.com/spencerbeggs/effected.git",
	license: "MIT",
	keywords: ["effect", "effect-ts", "github", "actions", "typescript"],
	hooks: {
		SessionStart: [{ script: "hooks/session-start/orientation.sh", timeout: 5 }],
	},
	// Claude Code only: Copilot has no monitors, and the build drops this with a monitor-omitted note. A node script,
	// so a command entry; the build ships the file it names and rewrites ${PLUGIN_ROOT} to ${CLAUDE_PLUGIN_ROOT}.
	monitors: {
		"build-diagnostics": {
			description:
				"Reports ae-*/tsdoc-* diagnostics from an effected package build's dist/prod/issues.json once a package's count settles",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: pluginfinity placeholder
			command: 'node "${PLUGIN_ROOT}/monitors/build-diagnostics.mjs"',
		},
	},
	mcpServers: {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: pluginfinity placeholder
		effected: { command: "sh", args: ["${PLUGIN_ROOT}/bin/start-mcp.sh"] },
	},
	claude: true,
	copilot: true,
});
