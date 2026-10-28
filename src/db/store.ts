/**
 * Layer 5 — data access behind an interface, via Supabase PostgREST.
 *
 * Privacy rules enforced here, not left to callers:
 * - DATA MINIMISATION: every query names its columns explicitly
 *   (COLUMNS below). No query uses a wildcard column list, so a
 *   new column can never leak through an old query.
 * - NO SERVICE ROLE: the store authenticates with the anon key
 *   plus the caller's own session token (so RLS still applies).
 *   The service_role key must NEVER appear here — notifications
 *   and daily questions are server-created in a later layer, and
 *   until then their creation is a stubbed 403, not a key wired
 *   into this file. Warning to future editors: do not "fix" a
 *   server-only insert by pasting a service_role key here.
 * - Errors from PostgREST are reduced to a status + a generic
 *   message before they leave this module (no SQL, no PG codes).
 *
 * Tests inject a fake Store (in-memory, labelled as a mock in the
 * test files). The RestStore below is the real implementation and
 * is only exercised against a mocked fetch in tests — no live
 * Supabase call is made in this layer (no key has been shared).
 */

import type { AuthConfig } from "../lib/auth.js";
import type { Cursor } from "../lib/pagination.js";

export type Row = Record<string, unknown>;

/** Explicit column lists per table — the data-minimisation contract. */
export const COLUMNS: Record<string, string> = {
  profiles:
    "id,handle,display_name,bio,follower_count,following_count,pinned_opinion_id,created_at,updated_at",
  daily_questions: "id,question,question_date,created_at",
  opinions:
    "id,author_id,body,topic,is_anonymous,daily_question_id,agree_count,neutral_count,disagree_count,like_count,repost_count,reply_count,created_at,updated_at",
  replies: "id,opinion_id,author_id,body,side,voice_score,created_at,updated_at",
  opinion_votes: "user_id,opinion_id,stance,created_at",
  opinion_likes: "user_id,opinion_id,created_at",
  reply_likes: "user_id,reply_id,created_at",
  reposts: "id,user_id,opinion_id,quote_take,created_at",
  follows: "follower_id,following_id,created_at",
  polls: "id,opinion_id,created_at",
  poll_options: "id,poll_id,option_text,position,vote_count,created_at",
  poll_votes: "user_id,poll_id,option_id,created_at",
  bookmarks: "user_id,opinion_id,created_at",
  muted_topics: "user_id,topic,created_at",
  muted_words: "user_id,word,created_at",
  blocks: "blocker_id,blocked_id,created_at",
  reports: "id,reporter_id,opinion_id,reply_id,reason,created_at",
  notifications: "id,user_id,actor_id,type,opinion_id,reply_id,is_read,created_at",
};

export interface ListQuery {
  /** Raw PostgREST filter fragments, e.g. "author_id=eq.<id>". */
  filters: string[];
  cursor: Cursor | null;
  limit: number;
  /**
   * PostgREST order clause. Default is created_at desc, id desc.
   * Replies sorted by Best Argument use voice_score desc instead;
   * the cursor still pages on (created_at, id), so a voice-score
   * list may repeat a row across pages if scores change mid-page
   * — documented in docs/api-conventions.md, not hidden.
   */
  order?: string;
}

export interface ListResult {
  rows: Row[];
  nextCursor: string | null;
}

export interface Store {
  get(table: string, id: string): Promise<Row | null>;
  getBy(table: string, filters: string[]): Promise<Row | null>;
  list(table: string, query: ListQuery): Promise<ListResult>;
  insert(table: string, body: Row): Promise<Row>;
  update(table: string, id: string, body: Row): Promise<Row | null>;
  remove(table: string, id: string): Promise<boolean>;
  removeBy(table: string, filters: string[]): Promise<boolean>;
}

/** PostgREST failure, reduced to a status. Callers map it generically. */
export class StoreError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Store request failed");
    this.name = "StoreError";
    this.status = status;
  }
}

type RestFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

function encodeFilterValue(value: string): string {
  return encodeURIComponent(value);
}

export function eqFilter(column: string, value: string): string {
  return `${column}=eq.${encodeFilterValue(value)}`;
}

export function ilikeFilter(column: string, value: string): string {
  // Escape PostgREST LIKE wildcards so a search term cannot widen
  // itself into a wildcard scan.
  const escaped = value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `${column}=ilike.*${encodeURIComponent(escaped)}*`;
}

export class RestStore implements Store {
  private readonly base: string;
  private readonly config: AuthConfig;
  private readonly token: string | null;
  private readonly fetchImpl: RestFetch;

  constructor(
    config: AuthConfig,
    token: string | null,
    fetchImpl: RestFetch = fetch as unknown as RestFetch,
  ) {
    this.base = `${config.supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
    this.config = config;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private headers(preferRepresentation = false): Record<string, string> {
    const headers: Record<string, string> = {
      apikey: this.config.anonKey,
      // Visitor reads use the anon key; signed-in calls use the
      // caller's session token so RLS sees the real user.
      Authorization: `Bearer ${this.token ?? this.config.anonKey}`,
      "Content-Type": "application/json",
    };
    if (preferRepresentation) {
      headers.Prefer = "return=representation";
    }
    return headers;
  }

  private async call(
    url: string,
    init: { method?: string; body?: string; prefer?: boolean } = {},
  ): Promise<unknown> {
    let response: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      response = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers: this.headers(init.prefer ?? false),
        body: init.body,
      });
    } catch {
      throw new StoreError(503);
    }
    if (!response.ok) {
      throw new StoreError(response.status);
    }
    return response.json();
  }

  private tableUrl(table: string, extra: string[] = []): string {
    const select = COLUMNS[table];
    if (select === undefined) {
      throw new Error(`Unknown table: ${table}`);
    }
    const params = [`select=${encodeURIComponent(select)}`, ...extra];
    return `${this.base}/${table}?${params.join("&")}`;
  }

  async get(table: string, id: string): Promise<Row | null> {
    return this.getBy(table, [eqFilter("id", id)]);
  }

  async getBy(table: string, filters: string[]): Promise<Row | null> {
    const body = (await this.call(
      this.tableUrl(table, [...filters, "limit=1"]),
    )) as Row[];
    return Array.isArray(body) && body.length > 0 ? (body[0] as Row) : null;
  }

  async list(table: string, query: ListQuery): Promise<ListResult> {
    const extras = [...query.filters];
    if (query.cursor !== null) {
      // Descending (created_at, id): rows strictly before the cursor.
      const ts = encodeURIComponent(query.cursor.createdAt);
      const id = encodeURIComponent(query.cursor.id);
      extras.push(`or=(created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id}))`);
    }
    extras.push(`order=${query.order ?? "created_at.desc,id.desc"}`);
    extras.push(`limit=${query.limit + 1}`);
    const body = (await this.call(this.tableUrl(table, extras))) as Row[];
    const rows = Array.isArray(body) ? body : [];
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1] as Row;
      if (typeof last.created_at === "string" && typeof last.id === "string") {
        nextCursor = Buffer.from(
          JSON.stringify({ createdAt: last.created_at, id: last.id }),
          "utf8",
        ).toString("base64url");
      }
    }
    return { rows: page, nextCursor };
  }

  async insert(table: string, body: Row): Promise<Row> {
    const result = (await this.call(this.tableUrl(table), {
      method: "POST",
      body: JSON.stringify(body),
      prefer: true,
    })) as Row[];
    if (!Array.isArray(result) || result.length === 0) {
      throw new StoreError(500);
    }
    return result[0] as Row;
  }

  async update(table: string, id: string, body: Row): Promise<Row | null> {
    const result = (await this.call(this.tableUrl(table, [eqFilter("id", id)]), {
      method: "PATCH",
      body: JSON.stringify(body),
      prefer: true,
    })) as Row[];
    return Array.isArray(result) && result.length > 0 ? (result[0] as Row) : null;
  }

  async remove(table: string, id: string): Promise<boolean> {
    await this.call(this.tableUrl(table, [eqFilter("id", id)]), {
      method: "DELETE",
    });
    return true;
  }

  async removeBy(table: string, filters: string[]): Promise<boolean> {
    await this.call(this.tableUrl(table, filters), { method: "DELETE" });
    return true;
  }
}
