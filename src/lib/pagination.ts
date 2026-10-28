/**
 * Layer 5 — cursor pagination only. No offset pagination anywhere:
 * offsets let a caller enumerate a table page by page, and they
 * drift when rows are inserted. Cursors are opaque (base64url JSON
 * of the last row's created_at + id); a caller cannot forge a
 * cursor into a row they may not see, because every list is still
 * scoped by can() and by the store's filters.
 */

import { badRequest } from "./http.js";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export interface Cursor {
  createdAt: string;
  id: string;
}

export function parseLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") {
    return DEFAULT_PAGE_SIZE;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw badRequest("limit must be a positive number");
  }
  // Capped, never honoured above the cap — a huge limit is a scrape.
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("bad cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw badRequest("cursor is invalid");
  }
}

/** Cursor for the next page, from the last row of this page. */
export function nextCursorFrom(row: {
  created_at?: unknown;
  id?: unknown;
}): string | null {
  if (typeof row.created_at !== "string" || typeof row.id !== "string") {
    return null;
  }
  return encodeCursor({ createdAt: row.created_at, id: row.id });
}
