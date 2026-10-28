/**
 * Test helper only — an in-memory Store for Layer 5 service tests.
 * It is labelled a mock wherever it is used: it proves the service
 * logic (auth, can(), validation, serialisation), NOT live RLS or
 * live PostgREST behaviour. The live proof is AUTH-SETUP-GUIDE.md §5.
 */

import { encodeCursor, type Cursor } from "../src/lib/pagination.js";
import type { ListQuery, ListResult, Row, Store } from "../src/db/store.js";

function parseFilter(filter: string): {
  column: string;
  op: string;
  value: string;
} | null {
  const eqIndex = filter.indexOf("=");
  if (eqIndex === -1) {
    return null;
  }
  const column = filter.slice(0, eqIndex);
  const rest = filter.slice(eqIndex + 1);
  if (rest.startsWith("eq.")) {
    return { column, op: "eq", value: decodeURIComponent(rest.slice(3)) };
  }
  if (rest.startsWith("ilike.")) {
    return { column, op: "ilike", value: decodeURIComponent(rest.slice(6)) };
  }
  return null;
}

function matches(row: Row, filter: string): boolean {
  // or=(...) cursor filters are handled by list() separately; a
  // plain filter that is not parseable never matches here.
  if (filter.startsWith("or=")) {
    return true;
  }
  const parsed = parseFilter(filter);
  if (parsed === null) {
    return false;
  }
  const actual = row[parsed.column];
  if (parsed.op === "eq") {
    return String(actual) === parsed.value;
  }
  // ilike.*term*: strip the * wrappers, unescape LIKE wildcards.
  const term = parsed.value
    .replace(/^\*/, "")
    .replace(/\*$/, "")
    .replace(/\\(.)/g, "$1")
    .toLowerCase();
  return typeof actual === "string" && actual.toLowerCase().includes(term);
}

function compareDesc(a: Row, b: Row): number {
  const aCreated = typeof a.created_at === "string" ? a.created_at : "";
  const bCreated = typeof b.created_at === "string" ? b.created_at : "";
  if (aCreated !== bCreated) {
    return bCreated.localeCompare(aCreated);
  }
  const bId = typeof b.id === "string" ? b.id : "";
  const aId = typeof a.id === "string" ? a.id : "";
  return bId.localeCompare(aId);
}

export class FakeStore implements Store {
  readonly tables = new Map<string, Row[]>();
  private counter = 0;

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) {
      this.tables.set(
        table,
        rows.map((row) => ({ ...row })),
      );
    }
  }

  private rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (rows === undefined) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  get(table: string, id: string): Promise<Row | null> {
    return Promise.resolve(this.rows(table).find((row) => row.id === id) ?? null);
  }

  getBy(table: string, filters: string[]): Promise<Row | null> {
    return Promise.resolve(
      this.rows(table).find((row) => filters.every((f) => matches(row, f))) ?? null,
    );
  }

  list(table: string, query: ListQuery): Promise<ListResult> {
    let rows = this.rows(table).filter((row) =>
      query.filters.every((f) => matches(row, f)),
    );
    rows = [...rows].sort(compareDesc);
    if (query.cursor !== null) {
      const cursor: Cursor = query.cursor;
      rows = rows.filter((row) => {
        const created = typeof row.created_at === "string" ? row.created_at : "";
        const id = typeof row.id === "string" ? row.id : "";
        return (
          created < cursor.createdAt || (created === cursor.createdAt && id < cursor.id)
        );
      });
    }
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1] as Row;
      if (typeof last.created_at === "string" && typeof last.id === "string") {
        nextCursor = encodeCursor({ createdAt: last.created_at, id: last.id });
      }
    }
    return Promise.resolve({ rows: page, nextCursor });
  }

  insert(table: string, body: Row): Promise<Row> {
    this.counter += 1;
    const row: Row = {
      id: `fake-${this.counter}`,
      created_at: new Date(Date.now() + this.counter).toISOString(),
      ...body,
    };
    // Composite-key rows carry no id in the real schema; keep the
    // generated id harmless — services never read it for those rows.
    this.rows(table).push(row);
    return Promise.resolve({ ...row });
  }

  async update(table: string, id: string, body: Row): Promise<Row | null> {
    const row = await this.get(table, id);
    if (row === null) {
      return null;
    }
    Object.assign(row, body);
    return { ...row };
  }

  remove(table: string, id: string): Promise<boolean> {
    const rows = this.rows(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index !== -1) {
      rows.splice(index, 1);
    }
    return Promise.resolve(true);
  }

  removeBy(table: string, filters: string[]): Promise<boolean> {
    const rows = this.rows(table);
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (filters.every((f) => matches(rows[i] as Row, f))) {
        rows.splice(i, 1);
      }
    }
    return Promise.resolve(true);
  }
}

export function seedStore(): FakeStore {
  return new FakeStore({
    profiles: [
      {
        id: "user-alice",
        handle: "alice",
        display_name: "Alice A",
        bio: "Hello",
        follower_count: 3,
        following_count: 2,
        pinned_opinion_id: null,
        created_at: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "user-bob",
        handle: "bob",
        display_name: "Bob B",
        bio: null,
        follower_count: 1,
        following_count: 0,
        pinned_opinion_id: null,
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    opinions: [
      {
        id: "op-anon",
        author_id: "user-alice",
        body: "Anonymous take on money",
        topic: "Money",
        is_anonymous: true,
        daily_question_id: null,
        agree_count: 5,
        neutral_count: 1,
        disagree_count: 2,
        like_count: 4,
        repost_count: 1,
        reply_count: 2,
        created_at: "2026-10-02T00:00:00.000Z",
      },
      {
        id: "op-bob",
        author_id: "user-bob",
        body: "Public take on tech",
        topic: "Technology",
        is_anonymous: false,
        daily_question_id: null,
        agree_count: 2,
        neutral_count: 0,
        disagree_count: 0,
        like_count: 1,
        repost_count: 0,
        reply_count: 0,
        created_at: "2026-10-03T00:00:00.000Z",
      },
    ],
    daily_questions: [
      {
        id: "dq-1",
        question: "What is your best money habit?",
        question_date: "2026-10-29",
        created_at: "2026-10-29T00:00:00.000Z",
      },
    ],
  });
}
