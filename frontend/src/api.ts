/* Opiinio API client — same-origin /api only.
 *
 * Mirrors the contract of the previous vanilla client:
 * - Every response is enveloped: { data: ... } on success,
 *   { error: { code, message } } on failure.
 * - The session (access/refresh tokens) lives in sessionStorage only,
 *   cleared on sign-out. Never localStorage, never a cookie.
 * - Sign-in / MFA go through the SERVER /api/auth/* routes, never
 *   directly to Supabase.
 */

export interface Author {
  authorId: string;
  handle: string;
  displayName: string;
  initials: string;
}

export interface Opinion {
  id: string;
  body: string;
  topic: string;
  isAnonymous: boolean;
  dailyQuestionId: string | null;
  author: Author;
  agreeCount: number;
  neutralCount: number;
  disagreeCount: number;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  ownStance: string | null;
  ownLiked: boolean;
  createdAt: string;
}

export interface OpinionList {
  items: Opinion[];
  nextCursor: string | null;
}

export interface Reply {
  id: string;
  opinionId: string;
  body: string;
  side: string;
  voiceScore: number;
  author: Author;
  ownLiked: boolean;
  createdAt: string;
}

export interface Poll {
  id: string;
  opinionId: string;
  options: { id: string; body: string; voteCount: number }[];
  ownOptionId: string | null;
}

export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  opinionCount: number;
  isFollowing: boolean;
  isBlocked: boolean;
}

export interface NotificationItem {
  id: string;
  type: string;
  read: boolean;
  actor: Author | null;
  opinionId: string | null;
  createdAt: string;
}

export interface DailyQuestion {
  id: string;
  body: string;
  date: string;
}

export interface ApiError extends Error {
  status: number;
  code: string;
}

const TOKEN_KEY = "opinio.session";

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string"
    ) {
      return null;
    }
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = loadSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session) {
    headers["Authorization"] = `Bearer ${session.accessToken}`;
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = new Error(
      (parsed as { error?: { message?: string } } | null)?.error?.message ??
        "Request failed",
    ) as ApiError;
    err.status = res.status;
    err.code =
      (parsed as { error?: { code?: string } } | null)?.error?.code ?? "INTERNAL_ERROR";
    // A 401 means the stored session is dead — drop it so the UI
    // returns to signed-out instead of looping on a bad token.
    if (res.status === 401) {
      clearSession();
    }
    throw err;
  }
  return (parsed as { data: T } | null)?.data as T;
}

export interface SessionUser {
  id: string;
  email: string;
}

export const api = {
  getSession: (): Promise<{ user: SessionUser; aal: string } | null> =>
    request<{ user: SessionUser; aal: string } | null>("/auth/session").catch(() => null),
  getOpinions: (
    cursor?: string | null,
    limit = 20,
    opts?: { topic?: string; search?: string },
  ): Promise<OpinionList> => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (cursor) qs.set("cursor", cursor);
    if (opts?.topic) qs.set("topic", opts.topic);
    if (opts?.search) qs.set("search", opts.search);
    return request<OpinionList>(`/opinions?${qs.toString()}`);
  },

  getOpinion: (id: string): Promise<Opinion> => request(`/opinions/${id}`),

  getDailyQuestion: (): Promise<DailyQuestion | null> =>
    request<{ items: DailyQuestion[] }>("/daily-questions?limit=1").then(
      (list) => list.items[0] ?? null,
    ),

  getDailyQuestions: (): Promise<{ items: DailyQuestion[] }> =>
    request("/daily-questions"),

  googleStart: (): Promise<{ url: string }> => request("/auth/google"),

  signIn: (email: string, password: string): Promise<{ session: Session }> =>
    request("/auth/signin", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  signUp: (
    email: string,
    password: string,
  ): Promise<{
    user: { id: string; email: string | null };
    session: Session | null;
    emailConfirmationRequired: boolean;
  }> =>
    request("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  signOut: (): Promise<void> => request("/auth/signout", { method: "POST" }),

  requestPasswordReset: (email: string): Promise<void> =>
    request("/auth/reset", { method: "POST", body: JSON.stringify({ email }) }),

  mfaEnroll: (): Promise<{ qrCode: string; secret: string; uri: string }> =>
    request("/auth/mfa/enroll", { method: "POST" }),

  mfaChallenge: (factorId: string): Promise<{ challengeId: string }> =>
    request("/auth/mfa/challenge", {
      method: "POST",
      body: JSON.stringify({ factorId }),
    }),

  mfaVerify: (
    factorId: string,
    challengeId: string,
    code: string,
  ): Promise<{ session: Session | null }> =>
    request("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ factorId, challengeId, code }),
    }),

  postOpinion: (body: string, topic: string, isAnonymous: boolean): Promise<Opinion> =>
    request("/opinions", {
      method: "POST",
      body: JSON.stringify({ body, topic, is_anonymous: isAnonymous }),
    }),

  vote: (opinionId: string, stance: "agree" | "neutral" | "disagree"): Promise<void> =>
    request(`/opinions/${opinionId}/stance`, {
      method: "POST",
      body: JSON.stringify({ stance }),
    }),

  unvote: (opinionId: string): Promise<void> =>
    request(`/opinions/${opinionId}/stance`, { method: "DELETE" }),

  like: (opinionId: string): Promise<void> =>
    request(`/opinions/${opinionId}/like`, { method: "POST" }),

  unlike: (opinionId: string): Promise<void> =>
    request(`/opinions/${opinionId}/like`, { method: "DELETE" }),

  getReplies: (opinionId: string): Promise<{ items: Reply[] }> =>
    request(`/opinions/${opinionId}/replies`),

  postReply: (
    opinionId: string,
    body: string,
    side: "for" | "against" | "neutral",
  ): Promise<Reply> =>
    request(`/opinions/${opinionId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body, side }),
    }),

  likeReply: (replyId: string): Promise<void> =>
    request(`/replies/${replyId}/like`, { method: "POST" }),

  unlikeReply: (replyId: string): Promise<void> =>
    request(`/replies/${replyId}/like`, { method: "DELETE" }),

  getPoll: (opinionId: string): Promise<Poll | null> =>
    request<Poll>(`/opinions/${opinionId}/polls`).catch(() => null),

  createPoll: (opinionId: string, options: string[]): Promise<Poll> =>
    request(`/opinions/${opinionId}/polls`, {
      method: "POST",
      body: JSON.stringify({ options }),
    }),

  castPollVote: (pollId: string, optionId: string): Promise<void> =>
    request(`/polls/${pollId}/votes`, {
      method: "POST",
      body: JSON.stringify({ option_id: optionId }),
    }),

  undoPollVote: (pollId: string): Promise<void> =>
    request(`/polls/${pollId}/votes`, { method: "DELETE" }),

  repost: (opinionId: string, quoteTake?: string): Promise<void> =>
    request(`/opinions/${opinionId}/reposts`, {
      method: "POST",
      body: JSON.stringify(quoteTake ? { quote_take: quoteTake } : {}),
    }),

  getProfile: (id: string): Promise<Profile> => request(`/profiles/${id}`),

  getProfileOpinions: (id: string): Promise<OpinionList> =>
    request(`/profiles/${id}/opinions`),

  getProfileReposts: (id: string): Promise<OpinionList> =>
    request(`/profiles/${id}/reposts`),

  updateProfile: (
    id: string,
    patch: { displayName?: string; bio?: string },
  ): Promise<Profile> =>
    request(`/profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      }),
    }),

  follow: (followingId: string): Promise<void> =>
    request("/follows", {
      method: "POST",
      body: JSON.stringify({ following_id: followingId }),
    }),

  unfollow: (followingId: string): Promise<void> =>
    request(`/follows/${followingId}`, { method: "DELETE" }),

  getBookmarks: (): Promise<OpinionList> => request("/bookmarks"),

  addBookmark: (opinionId: string): Promise<void> =>
    request("/bookmarks", {
      method: "POST",
      body: JSON.stringify({ opinion_id: opinionId }),
    }),

  removeBookmark: (opinionId: string): Promise<void> =>
    request(`/bookmarks/${opinionId}`, { method: "DELETE" }),

  getNotifications: (): Promise<{ items: NotificationItem[] }> =>
    request("/notifications"),

  markNotificationRead: (id: string): Promise<void> =>
    request(`/notifications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_read: true }),
    }),

  muteWord: (word: string): Promise<void> =>
    request("/muted-words", { method: "POST", body: JSON.stringify({ word }) }),

  report: (opinionId: string, reason: string): Promise<void> =>
    request("/reports", {
      method: "POST",
      body: JSON.stringify({ opinion_id: opinionId, reason }),
    }),
};
