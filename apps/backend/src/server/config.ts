export type AppEnvironment = "development" | "test" | "production";
export type LogLevel =
  "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface AppConfig {
  environment: AppEnvironment;
  host: string;
  port: number;
  logLevel: LogLevel;
  name: string;
  version: string;
}

const DEFAULT_PORT = 3210;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_NAME = "@departify/backend";
const DEFAULT_VERSION = "0.0.0";

const environments = new Set<AppEnvironment>([
  "development",
  "test",
  "production",
]);
const logLevels = new Set<LogLevel>([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

type EnvironmentRecord = Record<string, string | undefined>;

export function loadConfig(env: EnvironmentRecord = process.env): AppConfig {
  const environment = readEnvironment(env.NODE_ENV);

  return {
    environment,
    host: env.HOST ?? DEFAULT_HOST,
    port: readPort(env.PORT),
    logLevel: readLogLevel(env.LOG_LEVEL, environment),
    name: env.npm_package_name ?? DEFAULT_NAME,
    version: env.npm_package_version ?? DEFAULT_VERSION,
  };
}

function readEnvironment(value: string | undefined): AppEnvironment {
  if (value && environments.has(value as AppEnvironment)) {
    return value as AppEnvironment;
  }

  return "development";
}

function readPort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;

  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port <= 65_535) {
    return port;
  }

  throw new Error(`Invalid PORT value: ${value}`);
}

function readLogLevel(
  value: string | undefined,
  environment: AppEnvironment,
): LogLevel {
  if (value && logLevels.has(value as LogLevel)) {
    return value as LogLevel;
  }

  if (environment === "test") return "silent";
  return "info";
}
