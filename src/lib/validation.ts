/**
 * Layer 5 — input validation at the boundary, mirroring migration 01
 * CHECKs so a bad request fails here with a generic message instead
 * of reaching the database. Validation never trusts a user_id,
 * author_id, or email from the body — callers derive identity from
 * the verified session (src/lib/auth.ts) and pass it separately.
 */

import { badRequest } from "./http.js";

export const MAX_TEXT = 280;
export const MAX_TOPIC = 50;
export const MAX_DISPLAY_NAME = 80;
export const MAX_POLL_OPTION = 80;
export const MAX_SEARCH = 100;

export const STANCES = ["agree", "neutral", "disagree"] as const;
export type Stance = (typeof STANCES)[number];

export const SIDES = ["for", "against", "neutral"] as const;
export type Side = (typeof SIDES)[number];

export function validateText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${field} must be 1–280 characters`);
  }
  if (value.length > MAX_TEXT) {
    throw badRequest(`${field} must be 1–280 characters`);
  }
  return value;
}

export function validateOptionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return validateText(value, field);
}

export function validateTopic(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest("topic must be 1–50 characters");
  }
  if (value.length > MAX_TOPIC) {
    throw badRequest("topic must be 1–50 characters");
  }
  return value;
}

export function validateDisplayName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest("display_name must be 1–80 characters");
  }
  if (value.length > MAX_DISPLAY_NAME) {
    throw badRequest("display_name must be 1–80 characters");
  }
  return value;
}

export function validateStance(value: unknown): Stance {
  if (typeof value !== "string" || !(STANCES as readonly string[]).includes(value)) {
    throw badRequest("stance must be agree, neutral, or disagree");
  }
  return value as Stance;
}

export function validateSide(value: unknown): Side {
  if (typeof value !== "string" || !(SIDES as readonly string[]).includes(value)) {
    throw badRequest("side must be for, against, or neutral");
  }
  return value as Side;
}

export function validatePollOptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) {
    throw badRequest("poll must have 2–6 options");
  }
  return value.map((option) => {
    if (typeof option !== "string" || option.trim() === "") {
      throw badRequest("poll option must be 1–80 characters");
    }
    if (option.length > MAX_POLL_OPTION) {
      throw badRequest("poll option must be 1–80 characters");
    }
    return option;
  });
}

export function validateSearch(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > MAX_SEARCH) {
    throw badRequest("search must be at most 100 characters");
  }
  return value;
}

/** UUID-shaped ids only — anything else is a 400, not a DB error. */
export function validateId(value: string, field = "id"): string {
  if (
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    )
  ) {
    throw badRequest(`${field} must be a valid id`);
  }
  return value;
}

/**
 * Test ids in this repo's tests are short strings ("user-alice"),
 * not UUIDs — the fake store accepts them, but the HTTP boundary
 * must not. Services use validateId only on ids that reach the
 * real store; unit tests call services directly with test ids.
 * This helper is the HTTP-boundary gate, kept separate on purpose.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value,
  );
}
