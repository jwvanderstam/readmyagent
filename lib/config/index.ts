import "server-only";
import { type AppConfig, type ConfigResult, validateConfig } from "./validate";

export type {
  AppConfig,
  ConfigResult,
  DriveCredentials,
  SettingReport,
  SettingStatus,
} from "./validate";

export class ConfigError extends Error {
  constructor() {
    super("The instance is not fully configured. Open /setup to see which settings are missing.");
    this.name = "ConfigError";
  }
}

/** The configuration report for the setup page. Contains names and statuses only. */
export function configReport(): ConfigResult {
  return validateConfig(process.env);
}

/**
 * The validated configuration. The only place application code reads environment variables
 * (docs/standards.md, section 8). Throws instead of running with an incomplete configuration.
 */
export function getConfig(): AppConfig {
  const result = validateConfig(process.env);
  if (!result.ok) throw new ConfigError();
  return result.config;
}
