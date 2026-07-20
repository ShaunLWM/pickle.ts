import { randomBytes } from "node:crypto";
import { io } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";

const BASE_URL = "https://play.cpjourney.net";
const LOGIN_PATH = "/world/login/";
const TIMEOUT_MS = 20_000;
const BETWEEN_ATTEMPTS_MS = 1_500;
const REDACTED = "[REDACTED]";
const SENSITIVE_FIELD = /password|token|key|secret|cookie|authorization/i;

function generatedUsername() {
  return `zz${randomBytes(5).toString("hex")}`;
}

function generatedPassword() {
  return `Probe-${randomBytes(18).toString("base64url")}`;
}

function sanitize(value, depth = 0) {
  if (depth > 6) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitize(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_FIELD.test(key) ? REDACTED : sanitize(entry, depth + 1),
      ]),
    );
  }
  if (typeof value === "string") return value.slice(0, 500);
  return value;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function probeLogin({ scenario, username }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = io(BASE_URL, {
      path: LOGIN_PATH,
      parser: msgpackParser,
      transports: ["websocket"],
      reconnection: false,
      timeout: TIMEOUT_MS,
      extraHeaders: {
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        "User-Agent": "pickle.ts-cpj-login-probe/1.0",
      },
    });
    let settled = false;

    const finish = (outcome, detail = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.disconnect();
      const result = {
        scenario,
        username,
        outcome,
        elapsedMs: Date.now() - startedAt,
        ...sanitize(detail),
      };
      printResult(result);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish("timeout", { timeoutMs: TIMEOUT_MS });
    }, TIMEOUT_MS);

    socket.on("connect", () => {
      socket.emit("message", {
        action: "login",
        args: {
          username,
          password: generatedPassword(),
          secret: "skip",
        },
      });
    });

    socket.on("message", (message) => {
      if (!message || message.action !== "login") return;
      finish("login_response", {
        action: message.action,
        response: message.args ?? {},
      });
    });

    socket.on("connect_error", (error) => {
      finish("connect_error", {
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
      });
    });

    socket.on("disconnect", (reason, description) => {
      finish("disconnected_before_response", {
        reason,
        description:
          description instanceof Error
            ? { name: description.name, message: description.message }
            : description,
      });
    });
  });
}

async function main() {
  const existingUsername = process.env.CPJ_TEST_USERNAME?.trim();
  const scenarios = [
    {
      scenario: "generated_nonexistent_username",
      username: generatedUsername(),
    },
  ];

  if (existingUsername) {
    scenarios.push({
      scenario: "existing_test_account_wrong_password",
      username: existingUsername,
    });
  }

  printResult({
    event: "probe_start",
    target: "CPJourney login",
    attempts: scenarios.length,
    safeguards: {
      retries: 0,
      generatedWrongPasswords: true,
      credentialsLogged: false,
    },
  });

  for (const [index, scenario] of scenarios.entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_ATTEMPTS_MS));
    }
    await probeLogin(scenario);
  }

  if (!existingUsername) {
    printResult({
      event: "scenario_skipped",
      scenario: "existing_test_account_wrong_password",
      reason: "Set CPJ_TEST_USERNAME to the username of an account you own.",
    });
  }
}

await main();
