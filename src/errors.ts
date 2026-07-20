import type { ClientLifecyclePhase } from "./lifecycle.js";

export type ClientOperationErrorCategory =
  | "login_timeout"
  | "login_rejected"
  | "invalid_credentials"
  | "account_banned"
  | "queue_timeout"
  | "transport_error"
  | "auth_timeout"
  | "auth_failed"
  | "initial_state_timeout"
  | "operation_timeout"
  | "unsupported_operation"
  | "aborted"
  | "disconnected"
  | "kicked"
  | "server_error";

export type ClientOperationErrorOptions = {
  category: ClientOperationErrorCategory;
  phase: ClientLifecyclePhase;
  retryable: boolean;
  message: string;
  cause?: unknown;
};

const MAX_PUBLIC_MESSAGE_LENGTH = 500;
const QUOTED_SECRET_FIELD =
  /\b(password|token|login[_-]?key|confirmation[_-]?key|secret)(["']?\s*[:=]\s*)(["'])([^"']*)\3/gi;
const BARE_SECRET_FIELD =
  /\b(password|token|login[_-]?key|confirmation[_-]?key|secret)(\s*[:=]\s*)([^\s&,;]+)/gi;
const URL_CREDENTIALS = /\b([a-z][a-z\d+.-]*:\/\/)([^\s/@]+)@/gi;

export function sanitizeClientErrorMessage(message: string): string {
  return message
    .replace(URL_CREDENTIALS, "$1[REDACTED]@")
    .replace(QUOTED_SECRET_FIELD, "$1$2$3[REDACTED]$3")
    .replace(BARE_SECRET_FIELD, "$1$2[REDACTED]")
    .slice(0, MAX_PUBLIC_MESSAGE_LENGTH);
}

export class ClientOperationError extends Error {
  readonly category: ClientOperationErrorCategory;
  readonly phase: ClientLifecyclePhase;
  readonly retryable: boolean;

  constructor(options: ClientOperationErrorOptions) {
    super(sanitizeClientErrorMessage(options.message), {
      cause: options.cause,
    });
    this.name = "ClientOperationError";
    this.category = options.category;
    this.phase = options.phase;
    this.retryable = options.retryable;
  }
}
