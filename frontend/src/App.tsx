/* Opiinio React app — dark neon theme.
 *
 * Hash routing (no router dependency):
 *   #/            feed            #/welcome        welcome
 *   #/signin      sign in         #/explore        explore
 *   #/debates     debates         #/following      following
 *   #/notifications               #/bookmarks      bookmarks
 *   #/profile/:id                 #/post/:id       post detail
 *   #/compose                     #/compose?quote= quote repost
 *
 * Data: live via /api when the backend is configured, otherwise the
 * LABELLED preview set (preview.ts) — sample posts are never presented
 * as real.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { DailyQuestion, Opinion, SessionUser } from "./api";
import { api, clearSession, loadSession } from "./api";
import {
  Composer,
  Hero,
  ModeBanner,
  OpinionCard,
  OpinionMeter,
  Sidebar,
  SuggestedDebates,
  Tabs,
  Topbar,
  TrendingTopics,
} from "./components";
import { PREVIEW_METER, PREVIEW_OPINIONS, PREVIEW_QUESTION } from "./preview";
import {
  BookmarksScreen,
  ComposeScreen,
  DebatesScreen,
  ExploreScreen,
  FollowingScreen,
  NotificationsScreen,
  PostDetailScreen,
  ProfileScreen,
  SignInScreen,
  WelcomeScreen,
} from "./screens";
import type { ScreenCtx } from "./screens";

type Mode = "loading" | "preview" | "live";
type Stance = "agree" | "neutral" | "disagree";

const TRENDING = [
  { name: "AI Regulation", count: "12.4K", up: true },
  { name: "Remote Work", count: "8.7K", up: true },
  { name: "College Degrees", count: "6.1K", up: true },
  { name: "Electric Vehicles", count: "5.8K", up: false },
  { name: "Work Life Balance", count: "5.2K", up: true },
];

const DEBATES = [
  { question: "Is remote work better than office work?", count: "6.1K", icon: "💻" },
  { question: "Are college degrees still worth it?", count: "5.8K", icon: "🎓" },
  { question: "Should social media be more regulated?", count: "4.9K", icon: "💬" },
];

const TOPIC_BY_OPINION: Record<string, string[]> = {
  "sample-1": ["Work", "Future", "Lifestyle"],
  "sample-2": ["Education", "Career", "Society"],
  "sample-3": ["Current Affairs", "Social Media", "Policy"],
};

/** Pick up OAuth tokens from the URL hash (Google redirect lands here),
 *  store them in sessionStorage, and clear the hash so tokens never
 *  linger in the address bar. */
function consumeOAuthHash(): boolean {
  const hash = window.location.hash || "";
  if (!hash.includes("access_token=")) return false;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    try {
      sessionStorage.setItem(
        "opinio.session",
        JSON.stringify({ accessToken, refreshToken }),
      );
    } catch {
      /* storage unavailable — stay signed out */
    }
  }
  window.location.hash = "#/";
  return true;
}

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export type Theme = "dark" | "light";

/** Site theme (dark default). Persisted in localStorage — a display
 *  preference only, never auth or personal data. */
function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return window.localStorage.getItem("opiinio.theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("opiinio.theme", theme);
    } catch {
      /* storage unavailable — theme just won't persist */
    }
  }, [theme]);
  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );
  return { theme, toggleTheme };
}

function applyStance(op: Opinion, stance: Stance): Opinion {
  if (op.ownStance === stance) return op;
  const delta = (key: Stance): number =>
    (stance === key ? 1 : 0) - (op.ownStance === key ? 1 : 0);
  return {
    ...op,
    agreeCount: Math.max(0, op.agreeCount + delta("agree")),
    neutralCount: Math.max(0, op.neutralCount + delta("neutral")),
    disagreeCount: Math.max(0, op.disagreeCount + delta("disagree")),
    ownStance: stance,
  };
}

function FeedScreen({
  opinions,
  onStance,
  onPost,
  onOpenPost,
  ctx,
}: {
  opinions: Opinion[];
  onStance: (id: string, stance: Stance) => void;
  onPost: (body: string) => void;
  onOpenPost: (id: string) => void;
  ctx: ScreenCtx;
}): ReactNode {
  const [tab, setTab] = useState("For You");
  const noop = useCallback(() => {}, []);
  const live = ctx.mode === "live";
  const [question, setQuestion] = useState<DailyQuestion | null>(null);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void api
      .getDailyQuestion()
      .then((q) => {
        if (!cancelled) setQuestion(q);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live]);
  return (
    <>
      <Tabs active={tab} onChange={setTab} />
      {live ? (
        question && (
          <Hero
            question={question.body}
            date={question.date}
            opinionCount={String(
              opinions.filter((o) => o.dailyQuestionId === question.id).length,
            )}
            onJoinDebate={() => {
              window.location.hash = "#/compose";
            }}
            onViewAll={() => {
              window.location.hash = "#/explore";
            }}
          />
        )
      ) : (
        <Hero
          question={PREVIEW_QUESTION.body}
          date={PREVIEW_QUESTION.date}
          opinionCount="12.4K"
          onJoinDebate={noop}
          onViewAll={noop}
        />
      )}
      <Composer initials="S" onPost={onPost} />
      {opinions.length === 0 ? (
        <div className="empty-state" role="status">
          <b>No opinions yet</b>
          Be the first to share — post the opening take above.
        </div>
      ) : (
        opinions.map((op) => (
          <div
            key={op.id}
            onClick={() => onOpenPost(op.id)}
            style={{ cursor: "pointer" }}
          >
            <OpinionCard
              opinion={op}
              topics={TOPIC_BY_OPINION[op.id] ?? [op.topic]}
              onStance={(stance) => onStance(op.id, stance)}
              onReply={noop}
              onRepost={noop}
              onQuote={noop}
              onLike={noop}
              onBookmark={noop}
            />
          </div>
        ))
      )}
    </>
  );
}

export default function App(): ReactNode {
  const [mode, setMode] = useState<Mode>("loading");
  const [opinions, setOpinions] = useState<Opinion[]>([]);
  const [me, setMe] = useState<SessionUser | null>(null);
  const route = useHashRoute();
  const { theme, toggleTheme } = useTheme();

  const refreshMe = useCallback(() => {
    if (loadSession() === null) {
      setMe(null);
      return;
    }
    void api
      .getSession()
      .then((s) => setMe(s ? s.user : null))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    consumeOAuthHash();
    refreshMe();
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.getOpinions();
        if (cancelled) return;
        setOpinions(data.items);
        setMode("live");
      } catch {
        if (cancelled) return;
        setOpinions(PREVIEW_OPINIONS);
        setMode("preview");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  const ctx: ScreenCtx = {
    mode: mode === "loading" ? "preview" : mode,
    me,
    refreshMe,
  };

  const handleStance = useCallback(
    (id: string, stance: Stance) => {
      if (mode !== "live" || me === null) return; // preview: no writes
      void api.vote(id, stance).catch(() => {});
      setOpinions((prev) =>
        prev.map((op) => (op.id === id ? applyStance(op, stance) : op)),
      );
    },
    [mode, me],
  );

  const handlePost = useCallback(
    (body: string) => {
      if (mode !== "live" || me === null) return; // preview: no writes
      void api
        .postOpinion(body, "General", false)
        .then((op) => setOpinions((prev) => [op, ...prev]))
        .catch(() => {});
    },
    [mode, me],
  );

  const noop = useCallback(() => {}, []);
  const openPost = useCallback((id: string) => {
    window.location.hash = `#/post/${id}`;
  }, []);

  const navFor = (r: string): string => {
    if (r.startsWith("#/explore")) return "explore";
    if (r.startsWith("#/debates")) return "debates";
    if (r.startsWith("#/notifications")) return "notifications";
    if (r.startsWith("#/bookmarks")) return "bookmarks";
    if (r.startsWith("#/profile")) return "profile";
    return "home";
  };

  const goNav = useCallback(
    (key: string) => {
      const map: Record<string, string> = {
        home: "#/",
        explore: "#/explore",
        debates: "#/debates",
        notifications: "#/notifications",
        bookmarks: "#/bookmarks",
        profile: me ? `#/profile/${me.id}` : "#/signin",
      };
      window.location.hash = map[key] ?? "#/";
    },
    [me],
  );

  const signOut = useCallback((): void => {
    if (me === null) {
      window.location.hash = "#/signin";
      return;
    }
    void api.signOut().catch(() => {});
    clearSession();
    setMe(null);
    window.location.hash = "#/";
  }, [me]);

  if (mode === "loading") {
    return (
      <div className="loading-wrap" role="status" aria-label="Loading">
        <div className="spinner" />
        <div>Loading Opiinio…</div>
      </div>
    );
  }

  // Full-page screens (no app shell).
  if (route.startsWith("#/welcome")) {
    return <WelcomeScreen onEnter={() => (window.location.hash = "#/")} />;
  }
  if (route.startsWith("#/signin")) {
    return <SignInScreen ctx={ctx} />;
  }

  const liveMode = mode === "live";

  // Real trending topics, derived from the loaded opinions. Only used in
  // live mode — the rail never shows sample counts as real data.
  const liveTrending = useMemo(() => {
    const counts = new Map<string, number>();
    for (const op of opinions) {
      const t = (op.topic || "General").trim() || "General";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, n]) => ({ name, count: String(n), up: true }));
  }, [opinions]);
  let screen: ReactNode;
  if (route.startsWith("#/explore")) {
    screen = <ExploreScreen ctx={ctx} />;
  } else if (route.startsWith("#/debates")) {
    screen = <DebatesScreen ctx={ctx} />;
  } else if (route.startsWith("#/following")) {
    screen = <FollowingScreen ctx={ctx} />;
  } else if (route.startsWith("#/notifications")) {
    screen = <NotificationsScreen ctx={ctx} />;
  } else if (route.startsWith("#/bookmarks")) {
    screen = <BookmarksScreen ctx={ctx} />;
  } else if (route.startsWith("#/profile/")) {
    const userId = route.split("/")[2] ?? "";
    screen = <ProfileScreen ctx={ctx} userId={userId} />;
  } else if (route.startsWith("#/post/")) {
    const opinionId = route.split("/")[2] ?? "";
    screen = <PostDetailScreen ctx={ctx} opinionId={opinionId} />;
  } else if (route.startsWith("#/compose")) {
    const q = new URLSearchParams(route.split("?")[1] ?? "");
    screen = (
      <ComposeScreen
        ctx={ctx}
        quoteOf={q.get("quote")}
        onPosted={() => (window.location.hash = "#/")}
      />
    );
  } else {
    screen = (
      <FeedScreen
        opinions={opinions}
        onStance={handleStance}
        onPost={handlePost}
        onOpenPost={openPost}
        ctx={ctx}
      />
    );
  }

  const showRail =
    route === "#/" ||
    route === "" ||
    route.startsWith("#/explore") ||
    route.startsWith("#/debates");

  return (
    <div className="app">
      <Sidebar
        active={navFor(route)}
        onNavigate={goNav}
        onPost={() => (window.location.hash = "#/compose")}
      />
      <main>
        <Topbar
          displayName={me ? "You" : "Siddharth"}
          handle={me ? (me.email.split("@")[0] ?? "you") : "siddharth"}
          initials={me ? "YO" : "S"}
          signedIn={me !== null}
          onSignOut={signOut}
          onProfile={() => {
            if (me) window.location.hash = `#/profile/${me.id}`;
          }}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        {!liveMode && <ModeBanner mode="preview" />}
        {screen}
      </main>
      {showRail && (
        <div className="rail">
          {liveMode ? (
            // Live: only real data. The meter and suggested debates have no
            // live source yet, so they stay hidden instead of showing samples.
            liveTrending.length > 0 && (
              <TrendingTopics
                topics={liveTrending}
                onViewAll={() => {
                  window.location.hash = "#/explore";
                }}
              />
            )
          ) : (
            // Preview: sample content under the ModeBanner label.
            <>
              <OpinionMeter
                question={PREVIEW_QUESTION.body}
                agree={PREVIEW_METER.agree}
                neutral={PREVIEW_METER.neutral}
                disagree={PREVIEW_METER.disagree}
                agreeCount="7.2K"
                neutralCount="1.7K"
                disagreeCount="3.5K"
                onViewFull={noop}
              />
              <TrendingTopics topics={TRENDING} onViewAll={noop} />
              <SuggestedDebates debates={DEBATES} onViewAll={noop} onJoin={noop} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
