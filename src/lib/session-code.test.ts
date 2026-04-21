import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_CODE_FORMAT,
  buildMigratedSessionCodes,
  generateSessionCode,
  generateSessionCodeFromSessions,
} from "@/lib/session-code";

describe("session code generator", () => {
  it("generates next serial safely for the active prefix", () => {
    const code = generateSessionCode({
      date: "2026-04-21",
      venue: "Kaya Padel",
      format: DEFAULT_SESSION_CODE_FORMAT,
      existingCodes: ["kayapadel-0426-001", "kayapadel-0426-002"],
    });

    expect(code).toBe("kayapadel-0426-003");
  });

  it("supports yymm and ddmm variants", () => {
    const yymm = generateSessionCode({
      date: "2026-04-21",
      venue: "R Club",
      format: "venuecode-yymm-nnn",
      existingCodes: [],
    });
    const ddmm = generateSessionCode({
      date: "2026-04-21",
      venue: "R Club",
      format: "venuecode-ddmm-nnn",
      existingCodes: [],
    });

    expect(yymm).toBe("rclub-2604-001");
    expect(ddmm).toBe("rclub-2104-001");
  });

  it("can generate from sessions and exclude current session on edit", () => {
    const code = generateSessionCodeFromSessions({
      seed: { date: "2026-04-21", venue: "Kaya Padel", code: "kayapadel-0426-001" },
      format: DEFAULT_SESSION_CODE_FORMAT,
      sessions: [
        { id: "s1", date: "2026-04-21", code: "kayapadel-0426-001", venue: "Kaya Padel" },
        { id: "s2", date: "2026-04-21", code: "kayapadel-0426-002", venue: "Kaya Padel" },
      ],
      excludeSessionId: "s2",
    });

    expect(code).toBe("kayapadel-0426-002");
  });
});

describe("session code migration", () => {
  it("backfills existing sessions deterministically and collision-safe", () => {
    const updates = buildMigratedSessionCodes([
      { id: "b", date: "2026-04-02", code: "legacy-b", venue: "Kaya Padel" },
      { id: "a", date: "2026-04-02", code: "legacy-a", venue: "Kaya Padel" },
      { id: "c", date: "2026-04-03", code: "legacy-c", venue: "Kaya Padel" },
    ]);

    expect(updates).toEqual([
      { id: "a", code: "kayapadel-0426-001" },
      { id: "b", code: "kayapadel-0426-002" },
      { id: "c", code: "kayapadel-0426-003" },
    ]);
  });
});

