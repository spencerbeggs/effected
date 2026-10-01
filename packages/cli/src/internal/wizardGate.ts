import { Context } from "effect";

/**
 * Whether `CliPrompt.gateWizard` removed `--wizard` from the ambient `CliConfig`.
 *
 * It is how a later decision can put the flag back without inventing it: a consumer who left `Wizard` out of their own
 * `builtIns` never sets this, so a flag that makes the run interactive restores the wizard only where the gate took it.
 *
 * @internal
 */
export class WizardDropped extends Context.Reference<boolean>("@effected/cli/WizardDropped", {
	defaultValue: () => false,
}) {}
