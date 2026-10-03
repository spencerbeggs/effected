import { defineConfig } from "pluginfinity";

export default defineConfig({
	name: "effected",
	description:
		"Effect v4 development skills, a GitHub Actions and GitHub API suite, specialist subagents (developer, reviewer, action-engineer), and a session briefing, distilled from the @effected packages and the official Effect-TS v4 guides.",
	author: { name: "C. Spencer Beggs", email: "spencer@beggs.codes", url: "https://spencerbeg.gs" },
	homepage: "https://github.com/spencerbeggs/effected",
	repository: "https://github.com/spencerbeggs/effected.git",
	license: "MIT",
	keywords: ["effect", "effect-ts", "github", "actions", "typescript"],
	hooks: {
		SessionStart: [{ script: "hooks/session-start/orientation.sh", timeout: 5 }],
	},
	claude: true,
	copilot: {
		// Copilot gets its own briefing: it gives no project-root variable, so the
		// script walks up from the envelope's cwd, and its output is flat.
		hooks: {
			SessionStart: [{ script: "hooks/session-start/orientation.copilot.sh", timeout: 5 }],
		},
	},
});
