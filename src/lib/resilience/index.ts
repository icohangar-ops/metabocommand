// Vendored subset of cubiczan-resilience (typescript/src).
// No npm registry is available, so the primitives are copied here verbatim.
// Only the pieces the audit required are vendored: safeFetch (timeout + retry
// + backoff) and its dependencies (retry, errors). Keep in sync with upstream
// except for import specifiers: they are extensionless here so Turbopack
// resolves them (it does not map ".js" specifiers to ".ts", unlike tsc's
// bundler resolution).
export {
  ResilienceError,
  isResilienceError,
  type ResilienceErrorKind,
  type ResilienceErrorOptions,
} from "./errors";

export { retry, computeBackoff, type RetryOptions } from "./retry";

export {
  safeFetch,
  type SafeFetchOptions,
  type AllowlistHook,
} from "./safeFetch";
