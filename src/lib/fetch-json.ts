/**
 * Read fetch Response body as JSON without using `response.json()` (which throws
 * on empty bodies). Handles whitespace-only bodies and non-JSON error pages.
 */
export async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const preview = trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
    throw new Error(
      response.ok
        ? `Respons server bukan JSON yang valid.`
        : `Server mengembalikan error (${response.status}) bukan JSON. ${preview}`,
    );
  }
}

export function jsonErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as Record<string, unknown>).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  return "";
}
