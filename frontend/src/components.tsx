/* Presentational components for the dark neon theme.
 * No data fetching here — screens own state and pass props down.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import type { Opinion } from "./api";
import { formatCount, timeAgo } from "./preview";

/* ------------------------------------------------------------------ logo */

/** Opiinio mark: a three-ribbon swirl (fuchsia/violet/blue) in the style
 *  of the approved mockup. Pure SVG, no image asset. */
export function Logo({ size = 44 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Opiinio logo"
      style={{ flexShrink: 0 }}
    >
      <g fill="none" strokeWidth="8" strokeLinecap="round">
        <path d="M 34.7 15.0 A 14 14 0 0 1 28.8 37.2" stroke="#ec4899" />
        <path d="M 26.4 37.8 A 14 14 0 0 1 10.2 21.6" stroke="#8b5cf6" />
        <path d="M 10.8 19.2 A 14 14 0 0 1 33.0 13.3" stroke="#3b82f6" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ avatar */

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#6366f1,#a855f7)",
  "linear-gradient(135deg,#ec4899,#f43f5e)",
  "linear-gradient(135deg,#14b8a6,#06b6d4)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#8b5cf6,#3b82f6)",
];

function gradientFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const g = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
  return g ?? AVATAR_GRADIENTS[0] ?? "";
}

export function Avatar({
  initials,
  small,
}: {
  initials: string;
  small?: boolean;
}): ReactNode {
  return (
    <div
      className={small ? "avatar sm" : "avatar"}
      style={{ background: gradientFor(initials) }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

/* ------------------------------------------------------------------ sidebar */

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  badge?: number;
}

const NAV: NavItem[] = [
  { key: "home", label: "Home", icon: "⌂" },
  { key: "explore", label: "Explore", icon: "◈" },
  { key: "debates", label: "Debates", icon: "💬" },
  { key: "notifications", label: "Notifications", icon: "🔔", badge: 8 },
  { key: "bookmarks", label: "Bookmarks", icon: "🔖" },
  { key: "profile", label: "Profile", icon: "👤" },
];

export function Sidebar({
  active,
  onNavigate,
  onPost,
}: {
  active: string;
  onNavigate: (key: string) => void;
  onPost: () => void;
}): ReactNode {
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={44} />
        <div className="brand-name">Opiinio</div>
      </div>
      <nav className="nav" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={item.key === active ? "nav-item active" : "nav-item"}
            onClick={() => onNavigate(item.key)}
          >
            <span className="icon">{item.icon}</span>
            {item.label}
            {typeof item.badge === "number" && (
              <span className="nav-badge">{item.badge}</span>
            )}
          </button>
        ))}
      </nav>
      <button className="post-cta" onClick={onPost}>
        ＋ Post Opinion
      </button>
      <div className="promo-card">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <Logo size={56} />
        </div>
        <p className="promo-title">Opiinio</p>
        <p className="promo-tag">EVERY OPINION MATTERS.</p>
        <p className="promo-text">
          Words only. No photos, no videos. Just conversations that matter.
        </p>
        <a className="promo-link" href="#/welcome">
          Learn More →
        </a>
      </div>
      <div className="sidebar-footer">
        <nav>
          <a href="#/about">About</a>
          <a href="#/help">Help</a>
          <a href="#/privacy">Privacy</a>
          <a href="#/terms">Terms</a>
        </nav>
        <div>© 2026 Opiinio. All rights reserved.</div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ topbar */

export function Topbar({
  displayName,
  handle,
  initials,
  signedIn,
  onSignOut,
  theme,
  onToggleTheme,
}: {
  displayName: string;
  handle: string;
  initials: string;
  signedIn: boolean;
  onSignOut: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}): ReactNode {
  return (
    <div className="topbar">
      <label className="search">
        <span aria-hidden="true">🔍</span>
        <input type="search" placeholder="Search opinions, people, or topics..." />
      </label>
      <button className="lang-select" type="button" aria-label="Language">
        EN ▾
      </button>
      <button
        className="icon-btn"
        type="button"
        onClick={onToggleTheme}
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Light theme" : "Dark theme"}
      >
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
      <button className="icon-btn" type="button" aria-label="Notifications">
        🔔
        <span className="dot" />
      </button>
      <button
        className="user-chip"
        type="button"
        onClick={onSignOut}
        title={signedIn ? "Sign out" : "Sign in"}
      >
        <Avatar initials={initials} small />
        <span className="who">
          <b>{displayName}</b>
          <span>@{handle}</span>
        </span>
        ▾
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------- tabs */

const TABS = ["For You", "Trending", "Debates", "Following"] as const;

export function Tabs({
  active,
  onChange,
}: {
  active: string;
  onChange: (tab: string) => void;
}): ReactNode {
  return (
    <div className="tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={tab === active}
          className={tab === active ? "tab active" : "tab"}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- hero */

export function Hero({
  question,
  date,
  opinionCount,
  onJoinDebate,
  onViewAll,
}: {
  question: string;
  date: string;
  opinionCount: string;
  onJoinDebate: () => void;
  onViewAll: () => void;
}): ReactNode {
  return (
    <section className="hero" aria-label="Today's question">
      <div className="hero-date">📅 {date}</div>
      <div className="hero-kicker">
        <span className="cal">📅</span> TODAY'S QUESTION
      </div>
      <h2>{question}</h2>
      <p className="hero-sub">
        {opinionCount} opinions &nbsp;•&nbsp; Answer it and your post is badged a Daily
        Answer
      </p>
      <div className="hero-actions">
        <button className="btn-gradient" onClick={onJoinDebate}>
          Join Debate →
        </button>
        <button className="btn-ghost-light" onClick={onViewAll}>
          View All Opinions
        </button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- composer */

const MAX_LEN = 280;

export function Composer({
  initials,
  onPost,
}: {
  initials: string;
  onPost: (body: string) => void;
}): ReactNode {
  const [body, setBody] = useState("");
  const remaining = MAX_LEN - body.length;
  return (
    <div className="composer">
      <div className="composer-row">
        <Avatar initials={initials} />
        <textarea
          className="composer-input"
          placeholder="What's your opinion?"
          value={body}
          maxLength={MAX_LEN}
          onChange={(e) => setBody(e.target.value)}
          aria-label="What's your opinion?"
        />
        <span className="char-count">
          {body.length}/{MAX_LEN}
        </span>
      </div>
      <div className="composer-tools">
        <button className="tool-btn" type="button">
          🏷️ Choose Topic
        </button>
        <button className="tool-btn" type="button">
          📊 Add Poll
        </button>
        <select className="audience-select" aria-label="Audience">
          <option>🌐 Everyone</option>
          <option>👥 Followers</option>
        </select>
        <button
          className="btn-post"
          type="button"
          disabled={body.trim().length === 0 || remaining < 0}
          onClick={() => {
            onPost(body.trim());
            setBody("");
          }}
        >
          Post
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- opinion card */

export function OpinionCard({
  opinion,
  topics,
  onStance,
  onReply,
  onRepost,
  onQuote,
  onLike,
  onBookmark,
}: {
  opinion: Opinion;
  topics: string[];
  onStance: (stance: "agree" | "neutral" | "disagree") => void;
  onReply: () => void;
  onRepost: () => void;
  onQuote: () => void;
  onLike: () => void;
  onBookmark: () => void;
}): ReactNode {
  const author = opinion.isAnonymous
    ? { displayName: "Anonymous", handle: "anonymous", initials: "AN" }
    : opinion.author;
  return (
    <article className="opinion">
      <div className="opinion-head">
        <Avatar initials={author.initials} />
        <div className="who">
          <b>{author.displayName}</b>
          <span>
            @{author.handle} · {timeAgo(opinion.createdAt)}
          </span>
        </div>
        <button className="opinion-menu" aria-label="More options">
          •••
        </button>
      </div>
      <p className="opinion-body">{opinion.body}</p>
      {topics.length > 0 && (
        <div className="topic-chips">
          {topics.map((t) => (
            <span key={t} className="topic-chip">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="stance-row" role="group" aria-label="Your stance">
        <button
          className={
            opinion.ownStance === "agree" ? "stance-btn agree active" : "stance-btn agree"
          }
          onClick={() => onStance("agree")}
          aria-pressed={opinion.ownStance === "agree"}
        >
          👍 Agree <span className="count">{formatCount(opinion.agreeCount)}</span>
        </button>
        <button
          className={
            opinion.ownStance === "neutral"
              ? "stance-btn neutral active"
              : "stance-btn neutral"
          }
          onClick={() => onStance("neutral")}
          aria-pressed={opinion.ownStance === "neutral"}
        >
          ➖ Neutral <span className="count">{formatCount(opinion.neutralCount)}</span>
        </button>
        <button
          className={
            opinion.ownStance === "disagree"
              ? "stance-btn disagree active"
              : "stance-btn disagree"
          }
          onClick={() => onStance("disagree")}
          aria-pressed={opinion.ownStance === "disagree"}
        >
          👎 Disagree <span className="count">{formatCount(opinion.disagreeCount)}</span>
        </button>
      </div>
      <div className="opinion-actions">
        <button className="action-btn" onClick={onReply}>
          💬 Reply {opinion.replyCount}
        </button>
        <button className="action-btn" onClick={onRepost}>
          🔁 Repost {opinion.repostCount}
        </button>
        <button className="action-btn" onClick={onQuote}>
          🗨️ Quote
        </button>
        <button
          className={opinion.ownLiked ? "action-btn liked" : "action-btn"}
          onClick={onLike}
          aria-pressed={opinion.ownLiked}
        >
          {opinion.ownLiked ? "❤️" : "🤍"} Like {formatCount(opinion.likeCount)}
        </button>
        <button className="action-btn" onClick={onBookmark}>
          🔖 Bookmark
        </button>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------- right rail */

export function OpinionMeter({
  question,
  agree,
  neutral,
  disagree,
  agreeCount,
  neutralCount,
  disagreeCount,
  onViewFull,
}: {
  question: string;
  agree: number;
  neutral: number;
  disagree: number;
  agreeCount: string;
  neutralCount: string;
  disagreeCount: string;
  onViewFull: () => void;
}): ReactNode {
  const total = agree + neutral + disagree;
  const pct = (n: number): number => (total === 0 ? 0 : Math.round((n / total) * 100));
  return (
    <section className="rail-card" aria-label="Opinion meter">
      <h3>
        Opinion Meter <span className="info">ⓘ</span>
      </h3>
      <p className="meter-question">{question}</p>
      <div
        className="meter-bar"
        role="img"
        aria-label={`${pct(agree)}% agree, ${pct(neutral)}% neutral, ${pct(disagree)}% disagree`}
      >
        <div className="meter-seg agree" style={{ width: `${pct(agree)}%` }}>
          {pct(agree)}%
        </div>
        <div className="meter-seg neutral" style={{ width: `${pct(neutral)}%` }}>
          {pct(neutral)}%
        </div>
        <div className="meter-seg disagree" style={{ width: `${pct(disagree)}%` }}>
          {pct(disagree)}%
        </div>
      </div>
      <div className="meter-labels">
        <div className="meter-label agree">
          <b>Agree</b>
          <span>{agreeCount}</span>
        </div>
        <div className="meter-label neutral">
          <b>Neutral</b>
          <span>{neutralCount}</span>
        </div>
        <div className="meter-label disagree">
          <b>Disagree</b>
          <span>{disagreeCount}</span>
        </div>
      </div>
      <button className="btn-full" onClick={onViewFull}>
        View Full Debate →
      </button>
    </section>
  );
}

const TREND_GRADIENTS = [
  "linear-gradient(135deg,#7c3aed,#4f46e5)",
  "linear-gradient(135deg,#3b82f6,#06b6d4)",
  "linear-gradient(135deg,#ec4899,#f43f5e)",
  "linear-gradient(135deg,#f59e0b,#f97316)",
  "linear-gradient(135deg,#eab308,#ca8a04)",
];

export function TrendingTopics({
  topics,
  onViewAll,
}: {
  topics: { name: string; count: string; up: boolean }[];
  onViewAll: () => void;
}): ReactNode {
  return (
    <section className="rail-card" aria-label="Trending topics">
      <h3>
        Trending Topics
        <button className="view-all" onClick={onViewAll}>
          View All
        </button>
      </h3>
      {topics.map((t, i) => (
        <div className="trend-row" key={t.name}>
          <div
            className="trend-num"
            style={{ background: TREND_GRADIENTS[i % TREND_GRADIENTS.length] }}
          >
            {i + 1}
          </div>
          <div>
            <div className="t-name">{t.name}</div>
            <div className="t-count">{t.count} opinions</div>
          </div>
          <span className={t.up ? "trend-arrow up" : "trend-arrow down"}>
            {t.up ? "↗" : "↘"}
          </span>
        </div>
      ))}
    </section>
  );
}

export function SuggestedDebates({
  debates,
  onViewAll,
  onJoin,
}: {
  debates: { question: string; count: string; icon: string }[];
  onViewAll: () => void;
  onJoin: (question: string) => void;
}): ReactNode {
  return (
    <section className="rail-card" aria-label="Suggested debates">
      <h3>
        Suggested Debates
        <button className="view-all" onClick={onViewAll}>
          View All
        </button>
      </h3>
      {debates.map((d) => (
        <div className="debate-row" key={d.question}>
          <div className="debate-icon">{d.icon}</div>
          <div>
            <div className="d-q">{d.question}</div>
            <div className="d-c">{d.count} opinions</div>
          </div>
          <button className="btn-join" onClick={() => onJoin(d.question)}>
            Join
          </button>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------- mode banner */

export function ModeBanner({ mode }: { mode: "preview" | "live" }): ReactNode {
  if (mode === "live") return null;
  return (
    <div className="mode-banner preview" role="status">
      Preview mode — sample posts below. Sign in to see live opinions.
    </div>
  );
}
