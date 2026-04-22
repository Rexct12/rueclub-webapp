import { todayInBangkok } from "@/lib/domain";

export const sessionCodeFormatOptions = [
  ["venuecode-mmyy-nnn", "venuecode-mmyy-nnn"],
  ["venuecode-yymm-nnn", "venuecode-yymm-nnn"],
  ["venuecode-ddmm-nnn", "venuecode-ddmm-nnn"],
] as const;

export type SessionCodeFormat = (typeof sessionCodeFormatOptions)[number][0];

export const DEFAULT_SESSION_CODE_FORMAT: SessionCodeFormat = "venuecode-mmyy-nnn";

type SessionLike = {
  id: string;
  date: string;
  venue?: string;
  code: string;
};

type SessionCodeSeed = {
  date: string;
  venue?: string;
  code?: string;
};

export function isSessionCodeFormat(value: unknown): value is SessionCodeFormat {
  return sessionCodeFormatOptions.some(([format]) => format === value);
}

function normalizeVenueCode(value: string | undefined) {
  const source = String(value ?? "")
    .trim()
    .toLowerCase();
  const normalized = source.replace(/[^a-z0-9]+/g, "");
  return normalized || "venue";
}

function dateToken(date: string, format: SessionCodeFormat) {
  const [year = "", month = "", day = ""] = String(date).split("-");
  if (format === "venuecode-yymm-nnn") {
    return `${year.slice(-2)}${month}`;
  }
  if (format === "venuecode-ddmm-nnn") {
    return `${day}${month}`;
  }
  return `${month}${year.slice(-2)}`;
}

function deriveVenueCode(venue: string | undefined, codeFallback: string | undefined) {
  if (venue?.trim()) return normalizeVenueCode(venue);
  const fallbackPrefix = String(codeFallback ?? "").split("-")[0];
  return normalizeVenueCode(fallbackPrefix);
}

function prefixFor(input: { date: string; venue?: string; codeFallback?: string; format: SessionCodeFormat }) {
  const token = dateToken(input.date || todayInBangkok(), input.format);
  const venueCode = deriveVenueCode(input.venue, input.codeFallback);
  return `${venueCode}-${token}`;
}

export function generateSessionCode(input: {
  date: string;
  venue?: string;
  codeFallback?: string;
  format: SessionCodeFormat;
  existingCodes: Iterable<string>;
}) {
  const prefix = prefixFor(input);
  const lowerUsed = new Set(Array.from(input.existingCodes, (code) => code.toLowerCase()));
  let serial = 1;
  while (lowerUsed.has(`${prefix}-${String(serial).padStart(3, "0")}`.toLowerCase())) {
    serial += 1;
  }
  return `${prefix}-${String(serial).padStart(3, "0")}`;
}

export function generateSessionCodeFromSessions(input: {
  seed: SessionCodeSeed;
  format: SessionCodeFormat;
  sessions: SessionLike[];
  excludeSessionId?: string;
}) {
  const existingCodes = input.sessions
    .filter((session) => session.id !== input.excludeSessionId)
    .map((session) => session.code);

  return generateSessionCode({
    date: input.seed.date,
    venue: input.seed.venue,
    codeFallback: input.seed.code,
    format: input.format,
    existingCodes,
  });
}

export function resolveSessionCodeForUpsert(input: {
  seed: SessionCodeSeed;
  format: SessionCodeFormat;
  sessions: SessionLike[];
  requestedCode?: string;
  sessionId?: string;
}) {
  const requestedCode = String(input.requestedCode ?? "").trim();
  const isCodeTaken = (code: string) =>
    input.sessions.some(
      (session) => session.id !== input.sessionId && session.code.toLowerCase() === code.toLowerCase(),
    );

  if (!requestedCode) {
    return generateSessionCodeFromSessions({
      seed: input.seed,
      format: input.format,
      sessions: input.sessions,
      excludeSessionId: input.sessionId,
    });
  }

  if (isCodeTaken(requestedCode)) {
    if (input.sessionId) {
      throw new Error("Kode sesi sudah dipakai sesi lain.");
    }

    return generateSessionCodeFromSessions({
      seed: { ...input.seed, code: requestedCode },
      format: input.format,
      sessions: input.sessions,
      excludeSessionId: input.sessionId,
    });
  }

  return requestedCode;
}

export function buildMigratedSessionCodes(sessions: SessionLike[], format: SessionCodeFormat = DEFAULT_SESSION_CODE_FORMAT) {
  const sorted = [...sessions].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });
  const nextSerialByPrefix = new Map<string, number>();
  const assignedCodes = new Set<string>();
  const updates: Array<{ id: string; code: string }> = [];

  for (const session of sorted) {
    const prefix = prefixFor({
      date: session.date,
      venue: session.venue,
      codeFallback: session.code,
      format,
    });

    let serial = nextSerialByPrefix.get(prefix) ?? 1;
    let nextCode = `${prefix}-${String(serial).padStart(3, "0")}`;

    while (assignedCodes.has(nextCode.toLowerCase())) {
      serial += 1;
      nextCode = `${prefix}-${String(serial).padStart(3, "0")}`;
    }

    nextSerialByPrefix.set(prefix, serial + 1);
    assignedCodes.add(nextCode.toLowerCase());

    if (session.code !== nextCode) {
      updates.push({ id: session.id, code: nextCode });
    }
  }

  return updates;
}

