export type ConnectionProfilePreset = "chrome" | "node";

export type HeaderValue = string | number | boolean | null | undefined;

export type HeaderBag = Record<string, HeaderValue>;

export type ConnectionProfile = {
  preset?: ConnectionProfilePreset;
  userAgent?: string;
  acceptLanguage?: string;
  origin?: string;
  referer?: string;
  headers?: HeaderBag;
};

export type ConnectionProfileInput =
  | ConnectionProfilePreset
  | ConnectionProfile;

export type NormalizedConnectionProfile = {
  preset: ConnectionProfilePreset;
  userAgent?: string;
  acceptLanguage?: string;
  origin?: string;
  referer?: string;
  headers: HeaderBag;
};

const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const CHROME_ACCEPT_LANGUAGE = "en-US,en;q=0.9";

const RESTRICTED_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
  "upgrade",
]);

export function resolveConnectionProfile(
  input: ConnectionProfileInput = "chrome",
): NormalizedConnectionProfile {
  if (typeof input === "string") {
    return { preset: input, headers: {} };
  }

  const preset = input.preset ?? "chrome";

  return {
    preset,
    userAgent: input.userAgent,
    acceptLanguage: input.acceptLanguage,
    origin: input.origin,
    referer: input.referer,
    headers: input.headers ?? {},
  };
}

export function defaultOriginForUrl(urlOrOrigin: string): string {
  const input = urlOrOrigin.match(/^[a-z][a-z0-9+.-]*:\/\//i)
    ? urlOrOrigin
    : `https://${urlOrOrigin}`;

  try {
    const url = new URL(input);
    const protocol =
      url.protocol === "wss:"
        ? "https:"
        : url.protocol === "ws:"
          ? "http:"
          : url.protocol;

    return `${protocol}//${url.host}`;
  } catch {
    return urlOrOrigin.replace(/\/+$/, "");
  }
}

export function resolveConnectionOrigin(
  profile: NormalizedConnectionProfile,
  defaultUrlOrOrigin: string,
): string | undefined {
  if (profile.origin) return profile.origin;
  if (profile.preset === "node") return undefined;
  return defaultOriginForUrl(defaultUrlOrOrigin);
}

export function buildConnectionHeaders(
  profile: NormalizedConnectionProfile,
  options: {
    defaultOrigin: string;
    headers?: HeaderBag;
  },
): Record<string, string> {
  const headers: HeaderBag = {};
  const origin = resolveConnectionOrigin(profile, options.defaultOrigin);
  const referer =
    profile.referer ??
    (profile.preset === "node" || !origin ? undefined : `${origin}/`);

  if (profile.preset !== "node") {
    headers["User-Agent"] = profile.userAgent ?? CHROME_USER_AGENT;
    headers["Accept-Language"] =
      profile.acceptLanguage ?? CHROME_ACCEPT_LANGUAGE;
  }

  if (origin) headers.Origin = origin;
  if (referer) headers.Referer = referer;

  return sanitizeHeaders({
    ...headers,
    ...profile.headers,
    ...options.headers,
  });
}

export function sanitizeHeaders(headers: HeaderBag): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === null || value === undefined) continue;
    if (isRestrictedHeader(name)) continue;
    sanitized[name] = String(value);
  }

  return sanitized;
}

function isRestrictedHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    RESTRICTED_HEADERS.has(normalized) ||
    normalized.startsWith("sec-websocket-")
  );
}
