/* Opiinio screens — dark neon theme. Part 1: Welcome, SignIn, Explore, Debates.
 *
 * Every screen works in two modes:
 * - live: signed-in (or visitor) against /api.
 * - preview: labelled sample data, actions that would write are disabled
 *   with an honest notice instead of faking a result.
 */

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Opinion, SessionUser } from "./api";
import { api, clearSession, saveSession } from "./api";
import { Avatar, Logo, OpinionCard } from "./components";
import { PREVIEW_OPINIONS } from "./preview";

export interface ScreenCtx {
  mode: "live" | "preview";
  me: SessionUser | null;
  refreshMe: () => void;
}

/* --------------------------------------------------------------- welcome */

export function WelcomeScreen({ onEnter }: { onEnter: () => void }): ReactNode {
  return (
    <div className="welcome">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <Logo size={72} />
      </div>
      <h1>
        Every opinion <span className="grad-text">matters.</span>
      </h1>
      <p>
        Opiinio is a text-only home for opinions. No photos, no videos — just
        conversations that matter. Take a stance, join debates, and find the best
        arguments on any topic.
      </p>
      <div className="welcome-actions">
        <button
          className="btn-gradient"
          style={{ padding: "14px 38px", fontSize: 16 }}
          onClick={onEnter}
        >
          Enter Opiinio →
        </button>
        <a
          className="btn-ghost-light"
          href="#/signin"
          style={{ padding: "14px 38px", fontSize: 16 }}
        >
          Sign in
        </a>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- sign in */

type SignInStep = "choose" | "email";

export function SignInScreen({ ctx }: { ctx: ScreenCtx }): ReactNode {
  const [step, setStep] = useState<SignInStep>("choose");
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const google = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const { url } = await api.googleStart();
      window.location.href = url;
    } catch {
      setError("Could not start Google sign-in. Please try again.");
      setBusy(false);
    }
  }, []);

  const submitEmail = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (tab === "signin") {
        const { session } = await api.signIn(email, password);
        saveSession(session);
      } else {
        const { session } = await api.signUp(email, password);
        if (session) {
          saveSession(session);
          // The profile row is auto-created by the signup trigger with a
          // fallback handle (handles are not API-editable); set the chosen
          // display name on it.
          if (displayName.trim()) {
            const s = await api.getSession().catch(() => null);
            if (s) {
              await api
                .updateProfile(s.user.id, {
                  displayName: displayName.trim(),
                })
                .catch(() => {});
            }
          }
        }
      }
      ctx.refreshMe();
      window.location.hash = "#/";
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message ?? "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [tab, email, password, displayName, ctx]);

  return (
    <div className="form-card">
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Logo size={52} />
      </div>
      <h1>Welcome to Opiinio</h1>
      <p>Words only. No photos, no videos. Just conversations that matter.</p>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      {step === "choose" && (
        <>
          <button
            className="btn-gradient"
            style={{ width: "100%", marginBottom: 12 }}
            onClick={() => void google()}
            disabled={busy}
          >
            Continue with Google
          </button>
          <div className="divider">or</div>
          <button
            className="btn-secondary"
            style={{ width: "100%" }}
            onClick={() => setStep("email")}
          >
            Continue with email
          </button>
        </>
      )}

      {step === "email" && (
        <>
          <div className="tabs" style={{ justifyContent: "center", marginBottom: 16 }}>
            <button
              className={tab === "signin" ? "tab active" : "tab"}
              onClick={() => setTab("signin")}
            >
              Sign in
            </button>
            <button
              className={tab === "signup" ? "tab active" : "tab"}
              onClick={() => setTab("signup")}
            >
              Create account
            </button>
          </div>
          <input
            className="field"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            className="field"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={tab === "signin" ? "current-password" : "new-password"}
          />
          {tab === "signup" && (
            <>
              <input
                className="field"
                placeholder="Display name (e.g. Siddharth)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="nickname"
              />
              <p className="muted-note" style={{ margin: "0 0 12px" }}>
                Your @handle is assigned automatically — you can set your display name and
                bio later in your profile.
              </p>
            </>
          )}
          <button
            className="btn-gradient"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => void submitEmail()}
            disabled={busy || !email || !password}
          >
            {busy ? "Please wait…" : tab === "signin" ? "Sign in" : "Create account"}
          </button>
          <div style={{ marginTop: 14 }}>
            <button className="link-btn" onClick={() => setStep("choose")}>
              ← Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- explore */

const EXPLORE_TOPICS = [
  "AI Regulation",
  "Remote Work",
  "College Degrees",
  "Electric Vehicles",
  "Work Life Balance",
  "Social Media",
  "Education",
  "Policy",
];

export function ExploreScreen({ ctx }: { ctx: ScreenCtx }): ReactNode {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [results, setResults] = useState<Opinion[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const noop = useCallback(() => {}, []);

  const search = useCallback(
    async (q: string, t: string | null) => {
      if (ctx.mode !== "live") {
        // Preview: filter the labelled sample set honestly.
        const needle = (q || t || "").toLowerCase();
        setResults(
          PREVIEW_OPINIONS.filter((op) =>
            needle === "" ? true : op.body.toLowerCase().includes(needle),
          ),
        );
        setSearched(true);
        return;
      }
      setBusy(true);
      try {
        const data = await api.getOpinions(null, 20, {
          search: q || undefined,
          topic: t ?? undefined,
        });
        setResults(data.items);
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
        setSearched(true);
      }
    },
    [ctx.mode],
  );

  return (
    <div>
      <h2 className="page-title">Explore</h2>
      <form
        className="search"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void search(query, topic);
        }}
      >
        <span aria-hidden="true">🔍</span>
        <input
          type="search"
          placeholder="Search opinions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <div className="topic-chips" style={{ margin: "0 0 20px" }}>
        {EXPLORE_TOPICS.map((t) => (
          <button
            key={t}
            className="topic-chip"
            style={topic === t ? { borderColor: "#a855f7", color: "#e9d5ff" } : undefined}
            onClick={() => {
              const next = topic === t ? null : t;
              setTopic(next);
              void search(query, next);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {busy && (
        <div className="loading-wrap" style={{ minHeight: 120 }}>
          <div className="spinner" />
        </div>
      )}
      {!busy && searched && results.length === 0 && (
        <div className="empty-state">
          <b>No matches</b>
          Try a different word or topic.
        </div>
      )}
      {!busy &&
        results.map((op) => (
          <OpinionCard
            key={op.id}
            opinion={op}
            topics={[op.topic]}
            onStance={noop}
            onReply={noop}
            onRepost={noop}
            onQuote={noop}
            onLike={noop}
            onBookmark={noop}
          />
        ))}
    </div>
  );
}

/* --------------------------------------------------------------- debates */

export function DebatesScreen({ ctx }: { ctx: ScreenCtx }): ReactNode {
  const [questions, setQuestions] = useState<
    { id: string; body: string; date: string }[]
  >([]);
  const noop = useCallback(() => {}, []);

  useEffect(() => {
    let cancelled = false;
    if (ctx.mode !== "live") {
      setQuestions([
        {
          id: "q1",
          body: "Should AI be regulated more strictly by governments?",
          date: "Oct 30, 2026",
        },
        {
          id: "q2",
          body: "Is remote work better than office work?",
          date: "Oct 29, 2026",
        },
        { id: "q3", body: "Are college degrees still worth it?", date: "Oct 28, 2026" },
      ]);
      return;
    }
    void (async () => {
      try {
        const data = await api.getDailyQuestions();
        if (!cancelled) setQuestions(data.items);
      } catch {
        if (!cancelled) setQuestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.mode]);

  return (
    <div>
      <h2 className="page-title">Debates</h2>
      <p className="page-sub">
        One big question every day. Answer it and your post is badged a Daily Answer.
      </p>
      {questions.map((q) => (
        <div className="debate-card" key={q.id}>
          <h3>{q.body}</h3>
          <p>{q.date}</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-gradient" onClick={noop}>
              Join Debate →
            </button>
            <button className="btn-secondary" onClick={noop}>
              View All Opinions
            </button>
          </div>
        </div>
      ))}
      {questions.length === 0 && (
        <div className="empty-state">
          <b>No debates yet</b>
          Check back tomorrow for the next daily question.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- following */

export function FollowingScreen({ ctx }: { ctx: ScreenCtx }): ReactNode {
  return (
    <div>
      <h2 className="page-title">Following</h2>
      {ctx.me === null ? (
        <div className="empty-state">
          <b>Sign in to see your following feed</b>
          <div style={{ marginTop: 12 }}>
            <a className="btn-gradient" href="#/signin" style={{ padding: "12px 30px" }}>
              Sign in
            </a>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <b>Your following feed is quiet</b>
          Follow people whose arguments you respect and their latest opinions will appear
          here.
        </div>
      )}
      <p className="muted-note" style={{ marginTop: 16 }}>
        Note: the following feed ranks by the people you follow. Following is public and
        instant — no approval needed.
      </p>
    </div>
  );
}

/* --------------------------------------------------------- notifications */

function notifText(n: { type: string; actor: { displayName: string } | null }): string {
  const who = n.actor?.displayName ?? "Someone";
  switch (n.type) {
    case "reply":
      return `${who} replied to your opinion.`;
    case "like":
      return `${who} liked your opinion.`;
    case "repost":
      return `${who} reposted your opinion.`;
    case "follow":
      return `${who} started following you.`;
    case "vote":
      return `${who} took a stance on your opinion.`;
    default:
      return `${who} interacted with your opinion.`;
  }
}

export function NotificationsScreen({ ctx }: { ctx: ScreenCtx }): ReactNode {
  const [items, setItems] = useState<
    {
      id: string;
      type: string;
      read: boolean;
      actor: { displayName: string } | null;
      createdAt: string;
    }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    if (ctx.mode !== "live" || ctx.me === null) return;
    void (async () => {
      try {
        const data = await api.getNotifications();
        if (!cancelled) setItems(data.items);
      } catch {
        /* leave empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.mode, ctx.me]);

  const markRead = useCallback((id: string) => {
    void api.markNotificationRead(id).catch(() => {});
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  if (ctx.me === null) {
    return (
      <div>
        <h2 className="page-title">Notifications</h2>
        <div className="empty-state">
          <b>Sign in to see notifications</b>
          <div style={{ marginTop: 12 }}>
            <a className="btn-gradient" href="#/signin" style={{ padding: "12px 30px" }}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Notifications</h2>
      {items.length === 0 && (
        <div className="empty-state">
          <b>All caught up</b>
          Replies, likes, reposts and new followers will appear here.
        </div>
      )}
      {items.map((n) => (
        <div key={n.id} className={n.read ? "notif-row" : "notif-row unread"}>
          <Avatar
            initials={n.actor ? n.actor.displayName.slice(0, 2).toUpperCase() : "OP"}
            small
          />
          <div style={{ flex: 1 }}>
            <div className="n-text">{notifText(n)}</div>
            {!n.read && (
              <button
                className="link-btn"
                style={{ marginTop: 6 }}
                onClick={() => markRead(n.id)}
              >
                Mark as read
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- bookmarks */

export function BookmarksScreen({ ctx }: { ctx: ScreenCtx }): ReactNode {
  const [items, setItems] = useState<Opinion[]>([]);
  const noop = useCallback(() => {}, []);

  useEffect(() => {
    let cancelled = false;
    if (ctx.mode !== "live" || ctx.me === null) return;
    void (async () => {
      try {
        const data = await api.getBookmarks();
        if (!cancelled) setItems(data.items);
      } catch {
        /* leave empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.mode, ctx.me]);

  if (ctx.me === null) {
    return (
      <div>
        <h2 className="page-title">Bookmarks</h2>
        <div className="empty-state">
          <b>Sign in to use bookmarks</b>
          <div style={{ marginTop: 12 }}>
            <a className="btn-gradient" href="#/signin" style={{ padding: "12px 30px" }}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Bookmarks</h2>
      <p className="page-sub">Your read-later shelf. Only you can see this.</p>
      {items.length === 0 && (
        <div className="empty-state">
          <b>Nothing bookmarked yet</b>
          Tap Bookmark on any opinion to save it here.
        </div>
      )}
      {items.map((op) => (
        <OpinionCard
          key={op.id}
          opinion={op}
          topics={[op.topic]}
          onStance={noop}
          onReply={noop}
          onRepost={noop}
          onQuote={noop}
          onLike={noop}
          onBookmark={noop}
        />
      ))}
    </div>
  );
}

export function signOutAndGoHome(): void {
  if (loadSessionSafe()) {
    void api.signOut().catch(() => {});
    clearSession();
  }
  window.location.hash = "#/";
}

function loadSessionSafe(): boolean {
  try {
    return sessionStorage.getItem("opinio.session") !== null;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- profile */

export function ProfileScreen({
  ctx,
  userId,
}: {
  ctx: ScreenCtx;
  userId: string;
}): ReactNode {
  const [profile, setProfile] = useState<import("./api").Profile | null>(null);
  const [opinions, setOpinions] = useState<Opinion[]>([]);
  const [tab, setTab] = useState<"opinions" | "reposts">("opinions");
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState("");
  const [displayName, setDisplayName] = useState("");
  const noop = useCallback(() => {}, []);

  const isMe = ctx.me !== null && ctx.me.id === userId;

  useEffect(() => {
    let cancelled = false;
    if (ctx.mode !== "live") {
      setProfile(null);
      setOpinions([]);
      return;
    }
    void (async () => {
      try {
        const p = await api.getProfile(userId);
        if (cancelled) return;
        setProfile(p);
        setBio(p.bio);
        setDisplayName(p.displayName);
        const list =
          tab === "opinions"
            ? await api.getProfileOpinions(userId)
            : await api.getProfileReposts(userId);
        if (!cancelled) setOpinions(list.items);
      } catch {
        if (!cancelled) setProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.mode, userId, tab]);

  const toggleFollow = useCallback(() => {
    if (!profile || ctx.me === null) return;
    const wasFollowing = profile.isFollowing;
    setProfile({ ...profile, isFollowing: !wasFollowing });
    void (wasFollowing ? api.unfollow(userId) : api.follow(userId)).catch(() =>
      setProfile({ ...profile, isFollowing: wasFollowing }),
    );
  }, [profile, userId, ctx.me]);

  const saveProfile = useCallback(() => {
    if (!isMe) return;
    void api
      .updateProfile(userId, { displayName, bio })
      .then((p) => {
        setProfile(p);
        setEditing(false);
      })
      .catch(() => {});
  }, [isMe, userId, displayName, bio]);

  if (ctx.mode !== "live") {
    return (
      <div>
        <h2 className="page-title">Profile</h2>
        <div className="empty-state">
          <b>Sign in to see profiles</b>
          <div style={{ marginTop: 12 }}>
            <a className="btn-gradient" href="#/signin" style={{ padding: "12px 30px" }}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="loading-wrap" style={{ minHeight: 200 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div>
      <div className="profile-hero">
        <div className="profile-hero-inner">
          <Avatar initials={profile.displayName.slice(0, 2).toUpperCase()} />
          <div style={{ flex: 1 }}>
            {editing ? (
              <>
                <input
                  className="field"
                  value={displayName}
                  maxLength={60}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                />
                <input
                  className="field"
                  value={bio}
                  maxLength={160}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Bio"
                />
              </>
            ) : (
              <>
                <h2 className="page-title" style={{ margin: 0 }}>
                  {profile.displayName}
                </h2>
                <div style={{ color: "var(--muted)", fontSize: 14 }}>
                  @{profile.handle}
                </div>
                {profile.bio && (
                  <p
                    style={{ color: "var(--muted)", fontSize: 14.5, margin: "10px 0 0" }}
                  >
                    {profile.bio}
                  </p>
                )}
              </>
            )}
            <div className="profile-stats">
              <div className="stat">
                <b>{profile.opinionCount}</b>
                <span>Opinions</span>
              </div>
              <div className="stat">
                <b>{profile.followerCount}</b>
                <span>Followers</span>
              </div>
              <div className="stat">
                <b>{profile.followingCount}</b>
                <span>Following</span>
              </div>
            </div>
          </div>
          <div className="profile-actions">
            {isMe ? (
              editing ? (
                <>
                  <button className="btn-gradient" onClick={saveProfile}>
                    Save
                  </button>
                  <button className="btn-secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="btn-secondary" onClick={() => setEditing(true)}>
                  Edit profile
                </button>
              )
            ) : (
              ctx.me !== null && (
                <button
                  className={profile.isFollowing ? "btn-secondary" : "btn-gradient"}
                  onClick={toggleFollow}
                >
                  {profile.isFollowing ? "Following" : "Follow"}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      <div className="tabs">
        <button
          className={tab === "opinions" ? "tab active" : "tab"}
          onClick={() => setTab("opinions")}
        >
          Opinions
        </button>
        <button
          className={tab === "reposts" ? "tab active" : "tab"}
          onClick={() => setTab("reposts")}
        >
          Reposts
        </button>
      </div>

      {opinions.length === 0 && (
        <div className="empty-state">
          <b>Nothing here yet</b>
        </div>
      )}
      {opinions.map((op) => (
        <OpinionCard
          key={op.id}
          opinion={op}
          topics={[op.topic]}
          onStance={noop}
          onReply={noop}
          onRepost={noop}
          onQuote={noop}
          onLike={noop}
          onBookmark={noop}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ post detail */

function PollView({ opinionId, ctx }: { opinionId: string; ctx: ScreenCtx }): ReactNode {
  const [poll, setPoll] = useState<import("./api").Poll | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await api.getPoll(opinionId);
      if (!cancelled) {
        setPoll(p);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opinionId]);

  if (!loaded || poll === null) return null;

  const total = poll.options.reduce((n, o) => n + o.voteCount, 0);
  const vote = (optionId: string) => {
    if (ctx.me === null || poll.ownOptionId !== null) return; // one-vote lock
    void api.castPollVote(poll.id, optionId).catch(() => {});
    setPoll({
      ...poll,
      ownOptionId: optionId,
      options: poll.options.map((o) =>
        o.id === optionId ? { ...o, voteCount: o.voteCount + 1 } : o,
      ),
    });
  };

  return (
    <div className="poll" role="group" aria-label="Poll">
      {poll.options.map((o) => {
        const pct = total === 0 ? 0 : Math.round((o.voteCount / total) * 100);
        const locked = poll.ownOptionId !== null || ctx.me === null;
        return (
          <button
            key={o.id}
            className={poll.ownOptionId === o.id ? "poll-option voted" : "poll-option"}
            disabled={locked}
            onClick={() => vote(o.id)}
          >
            <span className="fill" style={{ width: `${pct}%` }} />
            <span className="opt-label">
              <span>{o.body}</span>
              <span>{pct}%</span>
            </span>
          </button>
        );
      })}
      <div className="poll-note">
        {poll.ownOptionId !== null
          ? "Vote locked — one vote per poll."
          : ctx.me === null
            ? "Sign in to vote."
            : `${total} votes · one vote per person`}
      </div>
    </div>
  );
}

export function PostDetailScreen({
  ctx,
  opinionId,
}: {
  ctx: ScreenCtx;
  opinionId: string;
}): ReactNode {
  const [opinion, setOpinion] = useState<Opinion | null>(null);
  const [replies, setReplies] = useState<import("./api").Reply[]>([]);
  const [side, setSide] = useState<"for" | "against" | "neutral">("neutral");
  const [replyBody, setReplyBody] = useState("");
  const [sideFilter, setSideFilter] = useState<"all" | "for" | "against">("all");
  const noop = useCallback(() => {}, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [op, r] = await Promise.all([
          api.getOpinion(opinionId),
          api.getReplies(opinionId).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setOpinion(op);
        setReplies(r.items);
      } catch {
        /* leave empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opinionId]);

  const postReply = useCallback(() => {
    const body = replyBody.trim();
    if (!body || ctx.me === null) return;
    void api
      .postReply(opinionId, body, side)
      .then((r) => {
        setReplies((prev) => [...prev, r]);
        setReplyBody("");
      })
      .catch(() => {});
  }, [replyBody, side, opinionId, ctx.me]);

  const likeReply = useCallback(
    (id: string, liked: boolean) => {
      if (ctx.me === null) return;
      void (liked ? api.unlikeReply(id) : api.likeReply(id)).catch(() => {});
      setReplies((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, ownLiked: !liked, voiceScore: r.voiceScore + (liked ? -1 : 1) }
            : r,
        ),
      );
    },
    [ctx.me],
  );

  if (!opinion) {
    return (
      <div className="loading-wrap" style={{ minHeight: 200 }}>
        <div className="spinner" />
      </div>
    );
  }

  const visible =
    sideFilter === "all" ? replies : replies.filter((r) => r.side === sideFilter);
  // Best Argument: highest voice score first.
  const sorted = [...visible].sort((a, b) => b.voiceScore - a.voiceScore);

  return (
    <div>
      <button
        className="link-btn"
        onClick={() => window.history.back()}
        style={{ marginBottom: 14 }}
      >
        ← Back
      </button>
      <OpinionCard
        opinion={opinion}
        topics={[opinion.topic]}
        onStance={noop}
        onReply={noop}
        onRepost={noop}
        onQuote={noop}
        onLike={noop}
        onBookmark={noop}
      />
      <PollView opinionId={opinionId} ctx={ctx} />

      <div className="row-between" style={{ margin: "22px 0 6px" }}>
        <h3 className="page-title" style={{ margin: 0, fontSize: 19 }}>
          Replies · Best Argument first
        </h3>
        <div className="side-picker" style={{ margin: 0 }}>
          {(["all", "for", "against"] as const).map((s) => (
            <button
              key={s}
              className={
                sideFilter === s
                  ? s === "for"
                    ? "side-btn sel-for"
                    : s === "against"
                      ? "side-btn sel-against"
                      : "side-btn sel-neutral"
                  : "side-btn"
              }
              onClick={() => setSideFilter(s)}
            >
              {s === "all" ? "All" : s === "for" ? "For" : "Against"}
            </button>
          ))}
        </div>
      </div>

      {ctx.me !== null ? (
        <div className="reply-composer">
          <div className="side-picker" role="group" aria-label="Debate side">
            <button
              className={side === "for" ? "side-btn sel-for" : "side-btn"}
              onClick={() => setSide("for")}
            >
              For
            </button>
            <button
              className={side === "against" ? "side-btn sel-against" : "side-btn"}
              onClick={() => setSide("against")}
            >
              Against
            </button>
            <button
              className={side === "neutral" ? "side-btn sel-neutral" : "side-btn"}
              onClick={() => setSide("neutral")}
            >
              Neutral
            </button>
          </div>
          <div className="composer-row" style={{ marginBottom: 12 }}>
            <textarea
              className="composer-input"
              placeholder="Make your argument… (280 chars)"
              value={replyBody}
              maxLength={280}
              onChange={(e) => setReplyBody(e.target.value)}
            />
          </div>
          <button
            className="btn-post"
            disabled={replyBody.trim().length === 0}
            onClick={postReply}
          >
            Reply
          </button>
        </div>
      ) : (
        <div className="empty-state" style={{ margin: "18px 0" }}>
          <b>Sign in to join the debate</b>
        </div>
      )}

      {sorted.length === 0 && (
        <div className="empty-state">
          <b>No replies yet</b>
          Make the first argument.
        </div>
      )}
      <div>
        {sorted.map((r) => (
          <div className="reply" key={r.id}>
            <Avatar initials={r.author.initials} small />
            <div className="reply-body">
              <span className={`reply-side ${r.side}`}>{r.side.toUpperCase()}</span>
              <div style={{ fontSize: 13.5, marginBottom: 4 }}>
                <b>{r.author.displayName}</b>{" "}
                <span style={{ color: "var(--muted)" }}>@{r.author.handle}</span>
              </div>
              <p className="reply-text">{r.body}</p>
              <div className="reply-meta">
                <span className="voice-score">⚡ {r.voiceScore} voice</span>
                <button
                  className="link-btn"
                  onClick={() => likeReply(r.id, r.ownLiked)}
                  aria-pressed={r.ownLiked}
                >
                  {r.ownLiked ? "❤️ Liked" : "🤍 Like"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- compose */

export function ComposeScreen({
  ctx,
  quoteOf,
  onPosted,
}: {
  ctx: ScreenCtx;
  quoteOf: string | null;
  onPosted: () => void;
}): ReactNode {
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState("General");
  const [anonymous, setAnonymous] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ctx.me === null) {
    return (
      <div>
        <h2 className="page-title">New opinion</h2>
        <div className="empty-state">
          <b>Sign in to post</b>
          <div style={{ marginTop: 12 }}>
            <a className="btn-gradient" href="#/signin" style={{ padding: "12px 30px" }}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  const post = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.postOpinion(text, topic, anonymous);
      const options = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (showPoll && options.length >= 2) {
        await api.createPoll(created.id, options.slice(0, 6)).catch(() => {});
      }
      void created;
      onPosted();
    } catch (e) {
      setError((e as Error).message ?? "Could not post. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  void anonymous;

  return (
    <div>
      <h2 className="page-title">{quoteOf ? "Quote repost" : "New opinion"}</h2>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="composer">
        <div className="composer-row">
          <Avatar initials="S" />
          <textarea
            className="composer-input"
            placeholder="What's your opinion? (280 characters, text only)"
            value={body}
            maxLength={280}
            rows={4}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
          />
          <span className="char-count">{body.length}/280</span>
        </div>
        <div className="composer-tools" style={{ paddingLeft: 0, flexWrap: "wrap" }}>
          <select
            className="audience-select"
            style={{ marginLeft: 0 }}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Topic"
          >
            {[
              "General",
              "AI Regulation",
              "Remote Work",
              "College Degrees",
              "Electric Vehicles",
              "Work Life Balance",
              "Social Media",
              "Education",
              "Policy",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <button
            className="tool-btn"
            type="button"
            onClick={() => setShowPoll((v) => !v)}
            aria-pressed={showPoll}
          >
            📊 {showPoll ? "Remove poll" : "Add Poll"}
          </button>
          <button
            className={anonymous ? "anon-toggle on" : "anon-toggle"}
            type="button"
            onClick={() => setAnonymous((v) => !v)}
            aria-pressed={anonymous}
          >
            <span className="switch" />
            Post anonymously
          </button>
          <button
            className="btn-post"
            type="button"
            disabled={body.trim().length === 0 || busy}
            onClick={() => void post()}
            style={{ marginLeft: "auto" }}
          >
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
        {showPoll && (
          <div className="poll-builder">
            <p className="muted-note" style={{ margin: "4px 0 10px" }}>
              Text-only poll · 2–6 options · one vote per person, locked after voting.
            </p>
            {pollOptions.map((opt, i) => (
              <input
                key={i}
                placeholder={`Option ${i + 1}`}
                value={opt}
                maxLength={80}
                onChange={(e) =>
                  setPollOptions((prev) =>
                    prev.map((p, j) => (j === i ? e.target.value : p)),
                  )
                }
              />
            ))}
            {pollOptions.length < 6 && (
              <button
                className="link-btn"
                onClick={() => setPollOptions((prev) => [...prev, ""])}
              >
                + Add option
              </button>
            )}
          </div>
        )}
      </div>
      <p className="muted-note">
        Text only — no photos or videos, ever. Be kind: strong arguments beat personal
        attacks.
      </p>
    </div>
  );
}
