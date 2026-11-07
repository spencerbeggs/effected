import { Schema } from "effect";

/**
 * The Feather icons GitHub accepts as an action's branding icon.
 *
 * @public
 */
export const ActionYmlBrandingIcon = Schema.Literals([
	"activity",
	"airplay",
	"alert-circle",
	"alert-octagon",
	"alert-triangle",
	"align-center",
	"align-justify",
	"align-left",
	"align-right",
	"anchor",
	"aperture",
	"archive",
	"arrow-down-circle",
	"arrow-down-left",
	"arrow-down-right",
	"arrow-down",
	"arrow-left-circle",
	"arrow-left",
	"arrow-right-circle",
	"arrow-right",
	"arrow-up-circle",
	"arrow-up-left",
	"arrow-up-right",
	"arrow-up",
	"at-sign",
	"award",
	"bar-chart-2",
	"bar-chart",
	"battery-charging",
	"battery",
	"bell-off",
	"bell",
	"bluetooth",
	"bold",
	"book-open",
	"book",
	"bookmark",
	"box",
	"briefcase",
	"calendar",
	"camera-off",
	"camera",
	"cast",
	"check-circle",
	"check-square",
	"check",
	"chevron-down",
	"chevron-left",
	"chevron-right",
	"chevron-up",
	"chevrons-down",
	"chevrons-left",
	"chevrons-right",
	"chevrons-up",
	"circle",
	"clipboard",
	"clock",
	"cloud-drizzle",
	"cloud-lightning",
	"cloud-off",
	"cloud-rain",
	"cloud-snow",
	"cloud",
	"code",
	"command",
	"compass",
	"copy",
	"corner-down-left",
	"corner-down-right",
	"corner-left-down",
	"corner-left-up",
	"corner-right-down",
	"corner-right-up",
	"corner-up-left",
	"corner-up-right",
	"cpu",
	"credit-card",
	"crop",
	"crosshair",
	"database",
	"delete",
	"disc",
	"dollar-sign",
	"download-cloud",
	"download",
	"droplet",
	"edit-2",
	"edit-3",
	"edit",
	"external-link",
	"eye-off",
	"eye",
	"fast-forward",
	"feather",
	"file-minus",
	"file-plus",
	"file-text",
	"file",
	"film",
	"filter",
	"flag",
	"folder-minus",
	"folder-plus",
	"folder",
	"gift",
	"git-branch",
	"git-commit",
	"git-merge",
	"git-pull-request",
	"globe",
	"grid",
	"hard-drive",
	"hash",
	"headphones",
	"heart",
	"help-circle",
	"home",
	"image",
	"inbox",
	"info",
	"italic",
	"layers",
	"layout",
	"life-buoy",
	"link-2",
	"link",
	"list",
	"loader",
	"lock",
	"log-in",
	"log-out",
	"mail",
	"map-pin",
	"map",
	"maximize-2",
	"maximize",
	"menu",
	"message-circle",
	"message-square",
	"mic-off",
	"mic",
	"minimize-2",
	"minimize",
	"minus-circle",
	"minus-square",
	"minus",
	"monitor",
	"moon",
	"more-horizontal",
	"more-vertical",
	"move",
	"music",
	"navigation-2",
	"navigation",
	"octagon",
	"package",
	"paperclip",
	"pause-circle",
	"pause",
	"percent",
	"phone-call",
	"phone-forwarded",
	"phone-incoming",
	"phone-missed",
	"phone-off",
	"phone-outgoing",
	"phone",
	"pie-chart",
	"play-circle",
	"play",
	"plus-circle",
	"plus-square",
	"plus",
	"pocket",
	"power",
	"printer",
	"radio",
	"refresh-ccw",
	"refresh-cw",
	"repeat",
	"rewind",
	"rotate-ccw",
	"rotate-cw",
	"rss",
	"save",
	"scissors",
	"search",
	"send",
	"server",
	"settings",
	"share-2",
	"share",
	"shield-off",
	"shield",
	"shopping-bag",
	"shopping-cart",
	"shuffle",
	"sidebar",
	"skip-back",
	"skip-forward",
	"slash",
	"sliders",
	"smartphone",
	"speaker",
	"square",
	"star",
	"stop-circle",
	"sun",
	"sunrise",
	"sunset",
	"table",
	"tablet",
	"tag",
	"target",
	"terminal",
	"thermometer",
	"thumbs-down",
	"thumbs-up",
	"toggle-left",
	"toggle-right",
	"trash-2",
	"trash",
	"trending-down",
	"trending-up",
	"triangle",
	"truck",
	"tv",
	"type",
	"umbrella",
	"underline",
	"unlock",
	"upload-cloud",
	"upload",
	"user-check",
	"user-minus",
	"user-plus",
	"user-x",
	"user",
	"users",
	"video-off",
	"video",
	"voicemail",
	"volume-1",
	"volume-2",
	"volume-x",
	"volume",
	"watch",
	"wifi-off",
	"wifi",
	"wind",
	"x-circle",
	"x-square",
	"x",
	"zap-off",
	"zap",
	"zoom-in",
	"zoom-out",
]);

/**
 * The decoded type of {@link (ActionYmlBrandingIcon:variable)}.
 *
 * @public
 */
export type ActionYmlBrandingIcon = typeof ActionYmlBrandingIcon.Type;

/**
 * The colors GitHub accepts as an action's branding color.
 *
 * @public
 */
export const ActionYmlBrandingColor = Schema.Literals([
	"white",
	"black",
	"yellow",
	"blue",
	"green",
	"orange",
	"red",
	"purple",
	"gray-dark",
]);

/**
 * The decoded type of {@link (ActionYmlBrandingColor:variable)}.
 *
 * @public
 */
export type ActionYmlBrandingColor = typeof ActionYmlBrandingColor.Type;

/**
 * One input an action declares.
 *
 * @public
 */
export class ActionYmlInput extends Schema.Class<ActionYmlInput>("ActionYmlInput")({
	/** What the input is for. */
	description: Schema.String,
	/** Whether a workflow must supply the input. */
	required: Schema.optionalKey(Schema.Boolean),
	/** The value used when a workflow supplies none. A string only, so a YAML `default: true` is a schema error: quote it. */
	default: Schema.optionalKey(Schema.String),
	/** The warning shown when a workflow supplies the input. */
	deprecationMessage: Schema.optionalKey(Schema.String),
}) {}

/**
 * One output an action declares.
 *
 * @public
 */
export class ActionYmlOutput extends Schema.Class<ActionYmlOutput>("ActionYmlOutput")({
	/** What the output holds. */
	description: Schema.String,
}) {}

/**
 * How an action runs, the `runs` key.
 *
 * @remarks
 * The action builder emits Node 24 actions only, so `using` takes `node24` and nothing else.
 *
 * @public
 */
export class ActionYmlRuns extends Schema.Class<ActionYmlRuns>("ActionYmlRuns")({
	/** The runtime. */
	using: Schema.Literal("node24"),
	/** The file that runs as the main step. */
	main: Schema.String,
	/** The file that runs before `main`. */
	pre: Schema.optionalKey(Schema.String),
	/** The condition for running `pre`. */
	"pre-if": Schema.optionalKey(Schema.String),
	/** The file that runs after `main`. */
	post: Schema.optionalKey(Schema.String),
	/** The condition for running `post`. */
	"post-if": Schema.optionalKey(Schema.String),
}) {}

/**
 * An action's Marketplace branding.
 *
 * @public
 */
export class ActionYmlBranding extends Schema.Class<ActionYmlBranding>("ActionYmlBranding")({
	/** The icon. */
	icon: Schema.optionalKey(ActionYmlBrandingIcon),
	/** The background color. */
	color: Schema.optionalKey(ActionYmlBrandingColor),
}) {}

/**
 * A decoded `action.yml`, per GitHub's metadata syntax for actions.
 *
 * @remarks
 * Keys it does not model are dropped rather than rejected. Parse the file with `Yaml.parse` from `@effected/yaml`,
 * then decode the document with this schema.
 *
 * @public
 */
export class ActionYml extends Schema.Class<ActionYml>("ActionYml")({
	/** The action's name. */
	name: Schema.String,
	/** What the action does. */
	description: Schema.String,
	/** The action's author. */
	author: Schema.optionalKey(Schema.String),
	/** The inputs, by name. */
	inputs: Schema.optionalKey(Schema.Record(Schema.String, ActionYmlInput)),
	/** The outputs, by name. */
	outputs: Schema.optionalKey(Schema.Record(Schema.String, ActionYmlOutput)),
	/** How the action runs. */
	runs: ActionYmlRuns,
	/** The Marketplace branding. */
	branding: Schema.optionalKey(ActionYmlBranding),
}) {}
