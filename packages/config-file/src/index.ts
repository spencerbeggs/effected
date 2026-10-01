/**
 * Composable config file loading for Effect: pluggable codecs, resolvers that
 * find the file, and merge strategies that combine several into one value.
 *
 * Name the codec you use (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`)
 * and a bundler drops the rest. Build a service with `ConfigFile.Service` and
 * `ConfigFile.layer`, or read one known path with `ConfigFile.read`.
 *
 * @packageDocumentation
 */

export type { ConfigCodec } from "./ConfigCodec.js";
export { ConfigCodecError } from "./ConfigCodec.js";
export type { ConfigEventsShape } from "./ConfigEvent.js";
export { ConfigEvent, ConfigEventPayload, ConfigEvents, ConfigSourceRef } from "./ConfigEvent.js";
export type {
	ConfigEncodeError,
	ConfigEncodeOptions,
	ConfigFileOptions,
	ConfigFileShape,
	ConfigFileTestOptions,
	ConfigLoadError,
	ConfigReadError,
	ConfigReadOptions,
	ConfigSaveError,
	ConfigUpdateError,
	ConfigWriteError,
} from "./ConfigFile.js";
export {
	ConfigDefaultPathMissingError,
	ConfigFile,
	ConfigFileNotFoundError,
	ConfigFileReadError,
	ConfigFileWriteError,
	ConfigValidationError,
} from "./ConfigFile.js";
export type { ConfigFileMigration, ConfigMigrationOptions } from "./ConfigMigration.js";
export { ConfigMigration, ConfigMigrationError, VersionAccess } from "./ConfigMigration.js";
export type { LayerConfigProviderOptions } from "./ConfigProvider.js";
export { asConfigProvider, layerConfigProvider } from "./ConfigProvider.js";
export type { ConfigMatch, ConfigProbe, UpwardWalkOptions } from "./ConfigResolver.js";
export { ConfigResolver } from "./ConfigResolver.js";
export { ConfigEncryptionError, EncryptedCodec, EncryptedCodecKey } from "./EncryptedCodec.js";
export { JsonCodec } from "./JsonCodec.js";
export { JsoncCodec } from "./JsoncCodec.js";
export type { ConfigSource, NonEmptySources } from "./MergeStrategy.js";
export { MergeStrategy } from "./MergeStrategy.js";
export { TomlCodec } from "./TomlCodec.js";
export { YamlCodec } from "./YamlCodec.js";
