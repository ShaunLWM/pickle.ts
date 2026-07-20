import type { QueueUpdate } from "./types/adapter-types.js";

export type ClientLifecyclePhase =
  | "transport_connecting"
  | "queueing"
  | "authenticating"
  | "joining_session"
  | "awaiting_initial_state"
  | "ready"
  | "disconnecting"
  | "disconnected";

export type ClientLifecycleUpdate = {
  phase: ClientLifecyclePhase;
  occurredAt: number;
  queue?: QueueUpdate;
};

export type ClientOperationOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ClientConnectionTimeouts = {
  loginMs: number;
  transportMs: number;
  /** Maximum silence between queue updates, not total time spent queued. */
  queueMs: number;
  authenticationMs: number;
  initialStateMs: number;
  requestMs: number;
};

export const DEFAULT_CLIENT_CONNECTION_TIMEOUTS = {
  loginMs: 20_000,
  transportMs: 20_000,
  queueMs: 300_000,
  authenticationMs: 20_000,
  initialStateMs: 15_000,
  requestMs: 15_000,
} as const satisfies ClientConnectionTimeouts;

export type ClientDisconnectInfo = {
  intentional: boolean;
  reason: string | null;
  occurredAt: number;
};
