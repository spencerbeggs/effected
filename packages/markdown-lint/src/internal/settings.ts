// Rule settings, read the way markdownlint's rules read them: one reader per
// coercion idiom its rules use (`Number(x ?? d)`, `!!x`, `x === undefined ||
// !!x`, `String(x || d)`, `String(x === undefined ? d : x)`, and a list of
// strings), so a quoted number in a YAML config, a `0` for `false` or a
// number where a string is expected means what it means to markdownlint.
//
// Where markdownlint's own coercion throws (a value whose conversion to a
// primitive throws, such as an object with no prototype), the kit stays total
// and reads the setting as absent instead.

type Config = Readonly<Record<string, unknown>>;

// `Number(value)` and `String(value)` throw only on a value whose conversion to a primitive throws.
const toNumber = (value: unknown): number | undefined => {
	try {
		return Number(value);
	} catch {
		return undefined;
	}
};

const toText = (value: unknown): string | undefined => {
	try {
		return String(value);
	} catch {
		return undefined;
	}
};

/** markdownlint's `Number(config[name] ?? fallback)`: `NaN` for a value that is no number. @internal */
export const numberSetting = (config: Config, name: string, fallback: number): number =>
	toNumber(config[name] ?? fallback) ?? fallback;

/** markdownlint's `!!config[name]`: off unless set to a truthy value. @internal */
export const flagSetting = (config: Config, name: string): boolean => !!config[name];

/** markdownlint's `config[name] === undefined || !!config[name]`: on unless set to a falsy value. @internal */
export const flagSettingOn = (config: Config, name: string): boolean => config[name] === undefined || !!config[name];

/** markdownlint's `String(config[name] || fallback)`: any falsy value reads as `fallback`. @internal */
export const stringSetting = (config: Config, name: string, fallback: string): string =>
	toText(config[name] || fallback) ?? fallback;

/** markdownlint's `String(config[name] === undefined ? fallback : config[name])`: only absence reads as `fallback`. @internal */
export const stringSettingUnlessAbsent = (config: Config, name: string, fallback: string): string => {
	const value = config[name];
	return value === undefined ? fallback : (toText(value) ?? fallback);
};

/**
 * markdownlint's string lists: an array's items, each through `String`, and
 * nothing for any other value. markdownlint throws on a truthy value that is
 * not an array where it calls `.map` on it unguarded (MD010's
 * `ignore_code_languages`); the kit reads that as nothing too. An item whose
 * conversion throws is dropped. @internal
 */
export const stringListSetting = (value: unknown): ReadonlyArray<string> => {
	if (!Array.isArray(value)) return [];
	const items: Array<string> = [];
	for (const item of value) {
		const text = toText(item);
		if (text !== undefined) items.push(text);
	}
	return items;
};

/** `Number(value)` for a raw setting value markdownlint compares by coercion; `NaN` when that throws. @internal */
export const coercedNumber = (value: unknown): number => toNumber(value) ?? Number.NaN;

/** `String(value)`, as a template literal writes a raw setting value; `""` when that throws. @internal */
export const coercedText = (value: unknown): string => toText(value) ?? "";

/**
 * The most a setting-driven `repeat` writes per finding: MD010's spaces per
 * tab, MD022's blank lines per fix. markdownlint repeats by the raw setting,
 * so `spaces_per_tab: 1e9` throws past V8's string limit and a large
 * `lines_above` builds megabytes of line breaks into one fix. No real
 * configuration asks for a tab stop or a run of blank lines anywhere near a
 * thousand, so a cap of 1,000 changes no fix under any setting below it, and
 * bounds a fix's text at a thousand characters per tab or line. @internal
 */
export const REPEAT_CAP = 1_000;
