/**
 * Platform-free primitives shared by every front end of an Effect v4 tool.
 *
 * @packageDocumentation
 */
export {
	CurrentDistribution,
	Distribution,
	DistributionField,
	distributionSuffix,
	withDistribution,
	withDistributionVersion,
} from "./Distribution.js";
export { Exclusive, type ExclusivePromiseOptions, type ExclusiveRunOptions, ExclusiveTimeout } from "./Exclusive.js";
export { LaunchContext, type ProjectDirInput, type ResolveInput } from "./LaunchContext.js";
export { type ProcessCwdHost, ProcessScope, ProcessScopeError } from "./ProcessScope.js";
export { Remediation } from "./Remediation.js";
