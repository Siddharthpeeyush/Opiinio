/* Opiinio Layer 6 — editorial frontend (vanilla JS, no dependencies).
 *
 * PRIVACY RULES, enforced here and tested in tests/frontend.test.ts:
 * - The ONLY network calls are same-origin /api/* (Layer 5). This file
 *   never calls Supabase, PostgREST, or GoTrue directly, never builds
 *   a URL from a Supabase host, and never offers a direct-table or
 *   "view raw" path. Direct PostgREST would bypass anonymous masking.
 * - No email, token, MFA secret, voter list, or another user's private
 *   data (bookmarks, muted lists, blocks, reports, notifications) is
 *   ever rendered. Votes render as aggregates + the caller's own
 *   status only. Anonymous authors render as "Anonymous" / "AN" only.
 * - No third-party scripts, fonts, analytics, or trackers. System
 *   serif/sans stacks only. No secrets in this file or in the HTML.
 * - PREVIEW MODE IS LABELLED, NEVER FAKED: when the API is
 *   unconfigured (503 / unavailable), the app shows sample content
 *   under a banner that says it is a preview, and preview actions
 *   are local-only with a "Preview only — not saved" notice. Sample
 *   posts, authors, and counts are never presented as real posts,
 *   real users, or a real session. Sign-in / MFA go through the
 *   SERVER /api/auth/* routes (server auth layer) — never
 *   directly to Supabase — and a session is stored in
 *   sessionStorage only, cleared on sign-out, never persistent browser storage.
 *   When the API is unconfigured, auth calls return 503 and no
 *   session is ever faked.
 * - Language toggle changes UI chrome only. It never translates
 *   another user's post (no paid translation API, by the ₹0 rule).
 */

(function () {
  "use strict";

  /* ---------------- helpers ---------------- */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Layer 10 — the MFA QR code arrives from GoTrue via the server
   * auth routes as an SVG string. It is the only raw-HTML sink in
   * this file, so it is allow-listed narrowly: it must be an SVG
   * document and must carry no active content (no scripts, no
   * event-handler attributes, no javascript:/data: URLs, no
   * embedded HTML frames). Anything else returns null and the
   * caller falls back to the data:image path or nothing.
   */
  function safeSvg(svg) {
    if (typeof svg !== "string") return null;
    var s = svg.trim();
    if (s.indexOf("<svg") !== 0) return null;
    if (/<script[\s>]/i.test(s)) return null;
    if (/<foreignObject[\s>]/i.test(s)) return null;
    if (/<iframe[\s>]/i.test(s)) return null;
    if (/\son[a-z]+\s*=/i.test(s)) return null;
    if (/javascript\s*:/i.test(s)) return null;
    return s;
  }

  function initialsFor(name) {
    var words = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return "OP";
    var out = words[0].charAt(0) + (words.length > 1 ? words[1].charAt(0) : "");
    return out.toUpperCase() || "OP";
  }

  function authorView(author, isAnonymous) {
    if (isAnonymous) {
      return {
        authorId: null,
        handle: "Anonymous",
        displayName: "Anonymous",
        initials: "AN",
      };
    }
    return {
      authorId: author && author.authorId ? author.authorId : null,
      handle: author && author.handle ? author.handle : "unknown",
      displayName: author && author.displayName ? author.displayName : "Unknown",
      initials: initialsFor(author && author.displayName ? author.displayName : ""),
    };
  }

  function pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function meterPercents(opinion) {
    var total = opinion.agreeCount + opinion.neutralCount + opinion.disagreeCount;
    return {
      agree: pct(opinion.agreeCount, total),
      neutral: pct(opinion.neutralCount, total),
      disagree: pct(opinion.disagreeCount, total),
      total: total,
    };
  }

  function showToast(message) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("toast--visible");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(function () {
      toast.classList.remove("toast--visible");
    }, 4200);
  }

  /* ---------------- UI chrome language (chrome only) ---------------- */

  var I18N = {
    en: {
      tagline: "EVERY OPINION MATTERS",
      navFeed: "Feed",
      navExplore: "Explore",
      navDebates: "Debates",
      navNotifications: "Notifications",
      navCompose: "Compose",
      navSettings: "Settings",
      navSignIn: "Sign in",
    },
    hi: {
      tagline: "हर राय मायने रखती है",
      navFeed: "फ़ीड",
      navExplore: "खोजें",
      navDebates: "बहस",
      navNotifications: "सूचनाएँ",
      navCompose: "लिखें",
      navSettings: "सेटिंग्स",
      navSignIn: "साइन इन",
    },
  };

  function applyLang() {
    var dict = I18N[state.lang] || I18N.en;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (dict[key]) el.textContent = dict[key];
    });
    document.documentElement.lang = state.lang === "hi" ? "hi" : "en";
  }

  /* ---------------- sample data (PREVIEW ONLY, labelled) ---------------- */

  var SAMPLE_AUTHORS = {
    meera: { authorId: "sample-meera", handle: "meera", displayName: "Meera Sharma" },
    arjun: { authorId: "sample-arjun", handle: "arjun", displayName: "Arjun Verma" },
    sid: { authorId: "sample-sid", handle: "sidpeeyush", displayName: "Sid Peeyush" },
  };

  var SAMPLE_OPINIONS = [
    {
      id: "sample-1",
      body: "Skills beat degrees when the work is real — hiring should prove it, not just ask for a certificate.",
      topic: "Work",
      isAnonymous: false,
      author: SAMPLE_AUTHORS.meera,
      agreeCount: 58,
      neutralCount: 14,
      disagreeCount: 28,
      likeCount: 42,
      repostCount: 9,
      replyCount: 3,
      ownStance: null,
      ownLiked: false,
      dailyQuestionId: null,
      createdAt: "2026-10-29",
      poll: null,
      replies: [
        {
          id: "sample-r1",
          body: "Exactly. A portfolio review tells you more than a marksheet.",
          side: "for",
          voiceScore: 12,
          author: SAMPLE_AUTHORS.arjun,
          ownLiked: false,
        },
        {
          id: "sample-r2",
          body: "Degrees still signal discipline and basics. Skills alone are hard to compare.",
          side: "against",
          voiceScore: 7,
          author: SAMPLE_AUTHORS.sid,
          ownLiked: false,
        },
        {
          id: "sample-r3",
          body: "Both matter, in different roles. A trial task settles it.",
          side: "neutral",
          voiceScore: 3,
          author: SAMPLE_AUTHORS.meera,
          ownLiked: false,
        },
      ],
    },
    {
      id: "sample-2",
      body: "Remote work should be the default, not the exception.",
      topic: "Work",
      isAnonymous: false,
      author: SAMPLE_AUTHORS.arjun,
      agreeCount: 62,
      neutralCount: 10,
      disagreeCount: 28,
      likeCount: 35,
      repostCount: 5,
      replyCount: 1,
      ownStance: null,
      ownLiked: false,
      dailyQuestionId: null,
      createdAt: "2026-10-28",
      poll: {
        id: "sample-p2",
        options: [
          { id: "sample-p2-a", optionText: "Fully remote", voteCount: 41 },
          { id: "sample-p2-b", optionText: "Hybrid", voteCount: 33 },
          { id: "sample-p2-c", optionText: "Office only", voteCount: 9 },
        ],
        ownOptionId: null,
      },
      replies: [
        {
          id: "sample-r4",
          body: "Focus time at home beats commute time, every week.",
          side: "for",
          voiceScore: 9,
          author: SAMPLE_AUTHORS.meera,
          ownLiked: false,
        },
      ],
    },
    {
      id: "sample-3",
      body: "Street food should get the same hygiene rating as restaurants — same food, same standard.",
      topic: "Cities",
      isAnonymous: true,
      author: SAMPLE_AUTHORS.meera,
      agreeCount: 71,
      neutralCount: 12,
      disagreeCount: 17,
      likeCount: 28,
      repostCount: 4,
      replyCount: 1,
      ownStance: null,
      ownLiked: false,
      dailyQuestionId: null,
      createdAt: "2026-10-28",
      poll: null,
      replies: [
        {
          id: "sample-r5",
          body: "Yes, and the rating board should be visible at the cart.",
          side: "for",
          voiceScore: 5,
          author: SAMPLE_AUTHORS.sid,
          ownLiked: false,
        },
      ],
    },
    {
      id: "sample-4",
      body: "What is one habit that actually changed your mornings?",
      topic: "Everyday life",
      isAnonymous: false,
      author: SAMPLE_AUTHORS.sid,
      agreeCount: 20,
      neutralCount: 45,
      disagreeCount: 5,
      likeCount: 18,
      repostCount: 2,
      replyCount: 2,
      ownStance: null,
      ownLiked: false,
      dailyQuestionId: "sample-dq1",
      createdAt: "2026-10-29",
      poll: null,
      replies: [
        {
          id: "sample-r6",
          body: "Phone stays outside the bedroom until after breakfast.",
          side: "for",
          voiceScore: 11,
          author: SAMPLE_AUTHORS.meera,
          ownLiked: false,
        },
        {
          id: "sample-r7",
          body: "A 10-minute walk before any screen.",
          side: "for",
          voiceScore: 8,
          author: SAMPLE_AUTHORS.arjun,
          ownLiked: false,
        },
      ],
    },
    {
      id: "sample-5",
      body: "AI tools should be taught in school like calculators were — as a tool, with its limits explained.",
      topic: "Education",
      isAnonymous: false,
      author: SAMPLE_AUTHORS.meera,
      agreeCount: 66,
      neutralCount: 18,
      disagreeCount: 16,
      likeCount: 31,
      repostCount: 6,
      replyCount: 0,
      ownStance: null,
      ownLiked: false,
      dailyQuestionId: null,
      createdAt: "2026-10-27",
      poll: null,
      replies: [],
    },
    {
      id: "sample-6",
      body: "UPI should stay free for small payments — convenience for everyone beats a small fee.",
      topic: "Money",
      isAnonymous: false,
      author: SAMPLE_AUTHORS.arjun,
      agreeCount: 74,
      neutralCount: 9,
      disagreeCount: 17,
      likeCount: 40,
      repostCount: 11,
      replyCount: 0,
      ownStance: null,
      ownLiked: false,
      dailyQuestionId: null,
      createdAt: "2026-10-27",
      poll: null,
      replies: [],
    },
    {
      id: "sample-7",
      body: "Phones should get five years of updates — a working phone should not become waste.",
      topic: "Technology",
      isAnonymous: false,
      author: SAMPLE_AUTHORS.sid,
      agreeCount: 68,
      neutralCount: 15,
      disagreeCount: 17,
      likeCount: 22,
      repostCount: 3,
      replyCount: 0,
      ownStance: null,
      ownLiked: false,
      dailyQuestionId: null,
      createdAt: "2026-10-26",
      poll: null,
      replies: [],
    },
  ];

  var SAMPLE_DAILY = {
    id: "sample-dq1",
    question: "What is one habit that actually changed your mornings?",
    questionDate: "2026-10-29",
  };

  var SAMPLE_NOTIFICATIONS = [
    {
      id: "sample-n1",
      type: "like",
      opinionId: "sample-1",
      actor: SAMPLE_AUTHORS.arjun,
      actorAnonymous: false,
      isRead: false,
    },
    {
      id: "sample-n2",
      type: "reply",
      opinionId: "sample-3",
      actor: SAMPLE_AUTHORS.meera,
      actorAnonymous: true,
      isRead: false,
    },
    {
      id: "sample-n3",
      type: "repost",
      opinionId: "sample-2",
      actor: SAMPLE_AUTHORS.sid,
      actorAnonymous: false,
      isRead: true,
    },
  ];

  var SAMPLE_REPOSTS = [
    {
      id: "sample-rep1",
      opinionId: "sample-1",
      quoteTake: null,
      repostedBy: SAMPLE_AUTHORS.sid,
    },
    {
      id: "sample-rep2",
      opinionId: "sample-6",
      quoteTake: "Exactly this. Small payments must stay free for everyone.",
      repostedBy: SAMPLE_AUTHORS.sid,
    },
  ];

  function sampleOpinionById(id) {
    return (
      SAMPLE_OPINIONS.find(function (o) {
        return o.id === id;
      }) || null
    );
  }

  /* ---------------- state ---------------- */

  var state = {
    mode: "loading", // loading | preview | live
    lang: "en",
    // Session from the SERVER /api/auth/* routes only, stored in
    // sessionStorage only. Null in preview.
    token: null,
    refreshToken: null,
    user: null,
    authMode: "signin", // signin | signup
    pendingMfa: null, // { factorId, challengeId } while a sign-in challenge is open
    mfaEnrollment: null, // { factorId, qrCode, secret, uri, challengeId } — discarded after verify
    mfaFactors: null,
    route: "welcome",
    param: null,
    query: {},
    tab: "for-you",
    profileTab: "opinions",
    debateMode: false,
    replySort: "best",
    replySideFilter: "all",
    mutedWords: [],
    mutedTopics: [],
    hiddenIds: [],
    blockedAuthors: [],
    bookmarkedIds: [],
    followedAuthors: [],
    notifications: SAMPLE_NOTIFICATIONS.map(function (n) {
      return Object.assign({}, n);
    }),
    // Live-list pass (Layer 12 in spirit, see decision 0012):
    // live data fetched from /api/* only. Null means "not loaded
    // yet"; an empty array means "loaded, nothing there". Sample
    // data is never copied into these fields.
    liveFeedItems: [],
    liveFeedCursor: null,
    liveFeedKey: null,
    liveFeedError: null,
    liveNotifications: null,
    liveNotificationsCursor: null,
    liveNotificationsError: null,
    liveProfile: null,
    liveProfileId: null,
    liveProfileTab: null,
    liveProfileTabItems: null,
    liveProfileTabCursor: null,
    liveProfileError: null,
    livePinnedOpinion: null,
    livePost: null,
    livePostReplies: null,
    livePostError: null,
    liveDaily: null,
    liveMore: null,
    skipLiveRefetch: false,
  };

  function isPreview() {
    return state.mode === "preview";
  }
  function isHidden(opinion) {
    if (state.hiddenIds.indexOf(opinion.id) !== -1) return true;
    if (state.blockedAuthors.indexOf(opinion.author.authorId) !== -1) return true;
    if (state.mutedTopics.indexOf(opinion.topic) !== -1) return true;
    return state.mutedWords.some(function (w) {
      return opinion.body.toLowerCase().indexOf(w.toLowerCase()) !== -1;
    });
  }
  function visibleOpinions(list) {
    return list.filter(function (o) {
      return !isHidden(o);
    });
  }

  /* ---------------- live lists (same-origin /api only) ---------------- */

  function isLive() {
    return state.mode === "live";
  }

  function dedupeById(items) {
    var seen = {};
    var out = [];
    items.forEach(function (item) {
      if (!item || seen[item.id]) return;
      seen[item.id] = true;
      out.push(item);
    });
    return out;
  }

  function liveOpinionById(id) {
    var pools = [state.liveFeedItems, state.livePost ? [state.livePost] : []];
    if (Array.isArray(state.liveProfileTabItems)) pools.push(state.liveProfileTabItems);
    for (var i = 0; i < pools.length; i++) {
      var found = (pools[i] || []).find(function (o) {
        return o && o.id === id;
      });
      if (found) return found;
    }
    return null;
  }

  function toLiveOpinion(item) {
    // Server OpinionView already matches the card shape (author
    // with authorId/handle/displayName/initials, counts, own
    // stance/like). Normalise only the fields the card reads so
    // a missing field renders as zero/empty, never undefined.
    return {
      id: item.id,
      body: item.body || "",
      topic: item.topic || "",
      isAnonymous: item.isAnonymous === true,
      author: item.author || {
        authorId: null,
        handle: "Anonymous",
        displayName: "Anonymous",
        initials: "AN",
      },
      agreeCount: item.agreeCount || 0,
      neutralCount: item.neutralCount || 0,
      disagreeCount: item.disagreeCount || 0,
      likeCount: item.likeCount || 0,
      repostCount: item.repostCount || 0,
      replyCount: item.replyCount || 0,
      ownStance: item.ownStance || null,
      ownLiked: item.ownLiked === true,
      dailyQuestionId: item.dailyQuestionId || null,
      createdAt: item.createdAt || "",
      poll: item.poll || null,
      replies: item.replies || [],
    };
  }

  function toLiveRepost(item) {
    return {
      id: item.id,
      opinionId: item.opinionId,
      quoteTake: item.quoteTake || null,
      repostedBy: item.repostedBy || null,
      original: item.original ? toLiveOpinion(item.original) : null,
      createdAt: item.createdAt || "",
    };
  }

  // Live fetch with the task's error contract:
  // 401 on a private call -> clear the stale session, caller
  // shows the auth-required state (never sample as live).
  // 401 on a public call -> clear, retry once without a token.
  // 503 / network -> fall back to labelled preview mode.
  async function liveFetch(path, opts) {
    opts = opts || {};
    try {
      return await api(path);
    } catch (e) {
      if (e.status === 401 && state.token && !opts.privateCall) {
        clearSession();
        try {
          return await api(path);
        } catch (retryErr) {
          if (retryErr.status === 401) throw { status: 401, authRequired: true };
          throw retryErr;
        }
      }
      if (e.status === 401) {
        clearSession();
        throw { status: 401, authRequired: true };
      }
      if (e.status === 503 || !e.status) {
        state.mode = "preview";
        renderModeBanner();
        throw { status: 503, previewFallback: true };
      }
      throw e;
    }
  }

  async function resolveOwnId() {
    if (state.user && state.user.id) return state.user.id;
    if (!state.token) return null;
    try {
      var data = await liveFetch("/auth/session", { privateCall: true });
      if (data && data.user) {
        state.user = data.user;
        return data.user.id;
      }
    } catch (e) {
      /* 401 already cleared the session above; 503 fell back */
    }
    return null;
  }

  async function loadLiveDaily() {
    if (state.liveDaily !== null) return state.liveDaily;
    try {
      var data = await liveFetch("/daily-questions?limit=20");
      state.liveDaily =
        data && Array.isArray(data.items) && data.items.length > 0
          ? data.items[0]
          : false;
    } catch (e) {
      state.liveDaily = false;
    }
    return state.liveDaily;
  }

  async function loadLiveFeed(key, topic) {
    if (!isLive()) return false;
    if (state.skipLiveRefetch && state.liveFeedKey === key) return true;
    state.liveFeedError = null;
    state.liveMore = null;
    try {
      var path = "/opinions?limit=20";
      if (topic) path += "&topic=" + encodeURIComponent(topic);
      var data = await liveFetch(path);
      var items = (data.items || []).map(toLiveOpinion);
      if (state.tab === "debates" || state.route === "debates") {
        // Debates need both sides: fetch replies per opinion and
        // keep only opinions that have a For and an Against reply.
        var withReplies = await Promise.all(
          items.map(async function (op) {
            try {
              var r = await liveFetch(
                "/opinions/" + op.id + "/replies?limit=20&sort=best",
              );
              op.replies = r.items || [];
            } catch (e2) {
              op.replies = [];
            }
            return op;
          }),
        );
        items = withReplies.filter(function (op) {
          return (
            op.replies.some(function (r) {
              return r.side === "for";
            }) &&
            op.replies.some(function (r) {
              return r.side === "against";
            })
          );
        });
      }
      state.liveFeedItems = dedupeById(items);
      state.liveFeedCursor = data.nextCursor || null;
      state.liveFeedKey = key;
      if (state.liveFeedCursor) {
        state.liveMore = {
          kind: "feed",
          cursor: state.liveFeedCursor,
          topic: topic || null,
        };
      }
      return true;
    } catch (e) {
      if (e.authRequired) state.liveFeedError = "auth";
      else if (e.previewFallback) state.liveFeedError = "preview";
      else state.liveFeedError = "error";
      return false;
    }
  }

  async function loadMoreLive() {
    var more = state.liveMore;
    if (!more || !more.cursor) return false;
    try {
      var path;
      if (more.kind === "feed") {
        path = "/opinions?limit=20&cursor=" + encodeURIComponent(more.cursor);
        if (more.topic) path += "&topic=" + encodeURIComponent(more.topic);
        var data = await liveFetch(path);
        state.liveFeedItems = dedupeById(
          state.liveFeedItems.concat((data.items || []).map(toLiveOpinion)),
        );
        state.liveFeedCursor = data.nextCursor || null;
        state.liveMore = state.liveFeedCursor
          ? { kind: "feed", cursor: state.liveFeedCursor, topic: more.topic }
          : null;
        return true;
      }
      if (more.kind === "notifications") {
        var ndata = await liveFetch(
          "/notifications?limit=20&cursor=" + encodeURIComponent(more.cursor),
          { privateCall: true },
        );
        state.liveNotifications = dedupeById(
          (state.liveNotifications || []).concat(ndata.items || []),
        );
        state.liveNotificationsCursor = ndata.nextCursor || null;
        state.liveMore = state.liveNotificationsCursor
          ? { kind: "notifications", cursor: state.liveNotificationsCursor }
          : null;
        return true;
      }
      if (more.kind === "profile") {
        var pdata;
        if (more.tab === "bookmarks") {
          pdata = await liveFetch(
            "/bookmarks?limit=20&cursor=" + encodeURIComponent(more.cursor),
            { privateCall: true },
          );
          var newOps = await Promise.all(
            (pdata.items || []).map(async function (b) {
              try {
                var op = await liveFetch("/opinions/" + b.opinionId);
                return toLiveOpinion(op);
              } catch (e3) {
                return null;
              }
            }),
          );
          state.liveProfileTabItems = dedupeById(
            (state.liveProfileTabItems || []).concat(
              newOps.filter(function (x) {
                return x !== null;
              }),
            ),
          );
        } else {
          var base =
            more.tab === "reposts"
              ? "/profiles/" + more.profileId + "/reposts"
              : "/profiles/" + more.profileId + "/opinions";
          pdata = await liveFetch(
            base + "?limit=20&cursor=" + encodeURIComponent(more.cursor),
          );
          var mapped =
            more.tab === "reposts"
              ? (pdata.items || []).map(toLiveRepost)
              : (pdata.items || []).map(toLiveOpinion);
          state.liveProfileTabItems = dedupeById(
            (state.liveProfileTabItems || []).concat(mapped),
          );
        }
        state.liveProfileTabCursor = pdata.nextCursor || null;
        state.liveMore = state.liveProfileTabCursor
          ? {
              kind: "profile",
              cursor: state.liveProfileTabCursor,
              tab: more.tab,
              profileId: more.profileId,
            }
          : null;
        return true;
      }
    } catch (e) {
      if (e.authRequired) showToast("Sign in required to load more.");
      else showToast("Could not load more.");
      return false;
    }
    return false;
  }

  async function loadLiveNotifications() {
    if (!isLive()) return false;
    if (!state.token) {
      state.liveNotificationsError = "auth";
      return false;
    }
    if (state.skipLiveRefetch && state.liveNotifications !== null) return true;
    state.liveNotificationsError = null;
    try {
      var data = await liveFetch("/notifications?limit=20", { privateCall: true });
      state.liveNotifications = dedupeById(data.items || []);
      state.liveNotificationsCursor = data.nextCursor || null;
      state.liveMore = state.liveNotificationsCursor
        ? { kind: "notifications", cursor: state.liveNotificationsCursor }
        : null;
      return true;
    } catch (e) {
      if (e.authRequired) state.liveNotificationsError = "auth";
      else if (e.previewFallback) state.liveNotificationsError = "preview";
      else state.liveNotificationsError = "error";
      return false;
    }
  }

  async function loadLiveProfile(rawId) {
    if (!isLive()) return false;
    var id = rawId;
    if (rawId === "me") {
      id = await resolveOwnId();
      if (!id) {
        state.liveProfileError = "auth";
        return false;
      }
    }
    if (
      state.skipLiveRefetch &&
      state.liveProfileId === id &&
      state.liveProfileTab === state.profileTab &&
      state.liveProfileTabItems !== null
    )
      return true;
    state.liveProfileError = null;
    state.liveMore = null;
    try {
      var profile = await liveFetch("/profiles/" + id);
      state.liveProfile = profile;
      state.liveProfileId = id;
      state.livePinnedOpinion = null;
      if (profile.pinnedOpinionId) {
        try {
          var pinnedOp = await liveFetch("/opinions/" + profile.pinnedOpinionId);
          state.livePinnedOpinion = toLiveOpinion(pinnedOp);
        } catch (e6) {
          state.livePinnedOpinion = null;
        }
      }
      state.liveProfileTab = state.profileTab;
      var tab = state.profileTab;
      if (tab === "opinions") {
        var odata = await liveFetch("/profiles/" + id + "/opinions?limit=20");
        state.liveProfileTabItems = dedupeById((odata.items || []).map(toLiveOpinion));
        state.liveProfileTabCursor = odata.nextCursor || null;
      } else if (tab === "reposts") {
        var rdata = await liveFetch("/profiles/" + id + "/reposts?limit=20");
        state.liveProfileTabItems = dedupeById((rdata.items || []).map(toLiveRepost));
        state.liveProfileTabCursor = rdata.nextCursor || null;
      } else if (tab === "bookmarks") {
        if (!state.token || id !== (state.user && state.user.id)) {
          state.liveProfileTabItems = null;
          state.liveProfileTabCursor = null;
        } else {
          var bdata = await liveFetch("/bookmarks?limit=20", { privateCall: true });
          var ops = await Promise.all(
            (bdata.items || []).map(async function (b) {
              try {
                var op = await liveFetch("/opinions/" + b.opinionId);
                return toLiveOpinion(op);
              } catch (e4) {
                return null;
              }
            }),
          );
          state.liveProfileTabItems = dedupeById(
            ops.filter(function (x) {
              return x !== null;
            }),
          );
          state.liveProfileTabCursor = bdata.nextCursor || null;
        }
      } else {
        // Replies-by-user and likes-by-user have NO API route
        // (see decision 0012): show an honest state, never sample.
        state.liveProfileTabItems = [];
        state.liveProfileTabCursor = null;
      }
      if (state.liveProfileTabCursor) {
        state.liveMore = {
          kind: "profile",
          cursor: state.liveProfileTabCursor,
          tab: tab,
          profileId: id,
        };
      }
      return true;
    } catch (e) {
      if (e.authRequired) state.liveProfileError = "auth";
      else if (e.previewFallback) state.liveProfileError = "preview";
      else state.liveProfileError = "error";
      return false;
    }
  }

  async function loadLivePost(id) {
    if (!isLive()) return false;
    if (state.skipLiveRefetch && state.livePost && state.livePost.id === id) return true;
    state.livePostError = null;
    try {
      var opinion = await liveFetch("/opinions/" + id);
      var replies = await liveFetch(
        "/opinions/" +
          id +
          "/replies?limit=20&sort=" +
          (state.replySort === "newest" ? "newest" : "best"),
      );
      var poll = null;
      try {
        poll = await liveFetch("/opinions/" + id + "/polls");
      } catch (e5) {
        poll = null;
      }
      var live = toLiveOpinion(opinion);
      live.poll = poll;
      live.replies = replies.items || [];
      state.livePost = live;
      state.livePostReplies = live.replies;
      return true;
    } catch (e) {
      if (e.authRequired) state.livePostError = "auth";
      else if (e.previewFallback) state.livePostError = "preview";
      else state.livePostError = "error";
      return false;
    }
  }

  /* ---------------- API client (same-origin /api only) ---------------- */

  async function api(path, options) {
    var opts = options || {};
    var headers = { "Content-Type": "application/json" };
    if (state.token) headers.Authorization = "Bearer " + state.token;
    var res = await fetch("/api" + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    var text = await res.text();
    var parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (e) {
      parsed = null;
    }
    if (!res.ok) {
      var err = new Error(
        (parsed && parsed.error && parsed.error.message) || "Request failed",
      );
      err.status = res.status;
      err.code = parsed && parsed.error ? parsed.error.code : "INTERNAL_ERROR";
      throw err;
    }
    return parsed ? parsed.data : null;
  }

  function saveSession(session) {
    // sessionStorage only, per the Layer 6 plan. A session is
    // never written to persistent browser storage and never logged.
    if (!session || !session.accessToken) return;
    state.token = session.accessToken;
    state.refreshToken = session.refreshToken || null;
    state.user = session.user || null;
    try {
      window.sessionStorage.setItem(
        "opiinio.session",
        JSON.stringify({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken || null,
          user: session.user || null,
        }),
      );
    } catch (e) {
      /* storage unavailable: session lives in memory for this tab only */
    }
  }

  function loadSession() {
    try {
      var raw = window.sessionStorage.getItem("opiinio.session");
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.accessToken) {
        state.token = parsed.accessToken;
        state.refreshToken = parsed.refreshToken || null;
        state.user = parsed.user || null;
      }
    } catch (e) {
      /* corrupt stored session: ignore it, do not fake one */
    }
  }

  function clearSession() {
    state.token = null;
    state.refreshToken = null;
    state.user = null;
    state.pendingMfa = null;
    try {
      window.sessionStorage.removeItem("opiinio.session");
    } catch (e) {
      /* ignore */
    }
  }

  // Supabase Google flow returns to the Site URL (app origin) with
  // tokens in the URL hash. Pick them up once, store them in
  // sessionStorage, and clear the hash so tokens never linger in
  // the address bar or history.
  function consumeAuthHash() {
    var hash = window.location.hash || "";
    var params = new URLSearchParams(hash.replace(/^#/, ""));
    var accessToken = params.get("access_token");
    if (!accessToken) return;
    saveSession({
      accessToken: accessToken,
      refreshToken: params.get("refresh_token"),
      user: null,
    });
    window.history.replaceState(null, "", window.location.pathname + "#/feed");
  }

  async function detectMode() {
    try {
      var data = await api("/opinions?limit=20");
      if (data && Array.isArray(data.items)) {
        state.mode = "live";
        state.liveOpinions = data.items;
        return;
      }
      state.mode = "preview";
    } catch (e) {
      // 503 (unconfigured), 401, network failure: preview, labelled.
      state.mode = "preview";
    }
    renderModeBanner();
  }

  async function validateStoredSession() {
    if (!state.token) return;
    try {
      var data = await api("/auth/session");
      if (data && data.user) state.user = data.user;
      // If the user has a verified factor and the session is
      // still aal1, the sign-in challenge screen (not the feed)
      // is the honest next step — handled by the sign-in screen
      // when the user opens it; a stored aal1 session is not
      // silently upgraded here.
    } catch (e) {
      if (e.status === 401) clearSession();
      // 503 / network: keep the stored token for this tab; the
      // next API call will surface the real error, not a fake.
    }
  }

  function renderModeBanner() {
    var banner = document.getElementById("mode-banner");
    if (!banner) return;
    if (state.mode === "preview") {
      // Screens that render sample opinions keep the "illustrative only"
      // line; screens with no opinions below (sign-in, onboarding,
      // compose, settings) get the shorter preview line instead.
      var sampleRoutes = [
        "feed",
        "explore",
        "debates",
        "notifications",
        "profile",
        "post",
        "welcome",
      ];
      var hasSamples = sampleRoutes.indexOf(state.route) !== -1;
      banner.innerHTML =
        "<strong>Preview mode — not connected to live accounts.</strong> " +
        (hasSamples
          ? "Sample opinions below are illustrative only, not real posts or users. "
          : "") +
        "Sign-in, posting, and saving are not live yet; preview actions are local only and are not saved to Opiinio.";
    } else if (state.mode === "live") {
      banner.innerHTML =
        "<strong>Connected to the live API.</strong> " +
        "Public posts are real. Writes that need a session will show a sign-in-required message when you are signed out.";
    } else {
      banner.textContent = "";
    }
  }

  /* ---------------- shared render pieces ---------------- */

  function avatarHtml(author, isAnonymous) {
    var view = authorView(author, isAnonymous);
    return '<span class="avatar" aria-hidden="true">' + esc(view.initials) + "</span>";
  }

  function authorLineHtml(author, isAnonymous) {
    var view = authorView(author, isAnonymous);
    if (isAnonymous) {
      return '<span class="author-name">Anonymous</span>';
    }
    return (
      '<a class="author-name" href="#/profile/' +
      esc(view.authorId || "") +
      '">' +
      esc(view.displayName) +
      '</a> <span class="handle">@' +
      esc(view.handle) +
      "</span>"
    );
  }

  function meterHtml(opinion) {
    var p = meterPercents(opinion);
    return (
      '<div class="meter" aria-label="Agree ' +
      p.agree +
      " percent, Neutral " +
      p.neutral +
      " percent, Disagree " +
      p.disagree +
      ' percent">' +
      '<div class="meter-scale" aria-hidden="true"><span>⚖</span></div>' +
      '<div class="meter-bar" role="img" aria-label="Opinion meter">' +
      '<span class="meter-seg meter-seg--agree" style="width:' +
      p.agree +
      '%"></span>' +
      '<span class="meter-seg meter-seg--neutral" style="width:' +
      p.neutral +
      '%"></span>' +
      '<span class="meter-seg meter-seg--disagree" style="width:' +
      p.disagree +
      '%"></span></div>' +
      '<div class="meter-labels"><span>Agree ' +
      p.agree +
      "%</span><span>Neutral " +
      p.neutral +
      "%</span><span>Disagree " +
      p.disagree +
      "%</span></div></div>"
    );
  }

  function pollHtml(opinion) {
    if (!opinion.poll) return "";
    var total = opinion.poll.options.reduce(function (s, o) {
      return s + o.voteCount;
    }, 0);
    var rows = opinion.poll.options
      .map(function (opt) {
        var p = pct(opt.voteCount, total);
        var checked = opinion.poll.ownOptionId === opt.id;
        var locked =
          opinion.poll.ownOptionId !== null && opinion.poll.ownOptionId !== undefined;
        return (
          '<div class="poll-option">' +
          '<button type="button" class="poll-vote" data-action="poll-vote" data-opinion="' +
          esc(opinion.id) +
          '" data-option="' +
          esc(opt.id) +
          '"' +
          (locked ? " disabled" : "") +
          ">" +
          esc(opt.optionText) +
          (checked ? " ✓" : "") +
          "</button>" +
          '<div class="poll-bar"><span style="width:' +
          p +
          '%"></span></div>' +
          '<span class="poll-pct">' +
          p +
          "% · " +
          opt.voteCount +
          " votes</span></div>"
        );
      })
      .join("");
    return (
      '<div class="poll" aria-label="Poll results">' +
      rows +
      '<p class="poll-note">' +
      (opinion.poll.ownOptionId
        ? "Vote locked — one vote only. Undo it from the poll in live mode, or clear it in preview."
        : "One vote only — voting locks your choice.") +
      "</p></div>"
    );
  }

  function opinionCardHtml(opinion, opts) {
    opts = opts || {};
    var view = authorView(opinion.author, opinion.isAnonymous);
    var followed = state.followedAuthors.indexOf(view.authorId) !== -1;
    var bookmarked = state.bookmarkedIds.indexOf(opinion.id) !== -1;
    return (
      '<article class="card opinion-card" data-opinion-id="' +
      esc(opinion.id) +
      '">' +
      '<div class="post-head">' +
      avatarHtml(opinion.author, opinion.isAnonymous) +
      '<div class="post-meta">' +
      authorLineHtml(opinion.author, opinion.isAnonymous) +
      '<span class="topic"> · ' +
      esc(opinion.topic) +
      "</span>" +
      (opinion.dailyQuestionId ? ' <span class="badge">Daily answer</span>' : "") +
      (opinion.isAnonymous ? ' <span class="badge">Anonymous</span>' : "") +
      (isPreview() ? ' <span class="badge badge--preview">Sample</span>' : "") +
      "</div></div>" +
      '<p class="card-text"><a href="#/post/' +
      esc(opinion.id) +
      '">' +
      esc(opinion.body) +
      "</a></p>" +
      meterHtml(opinion) +
      pollHtml(opinion) +
      '<div class="stance-row" role="group" aria-label="Your stance">' +
      ["agree", "neutral", "disagree"]
        .map(function (s) {
          var label = s === "agree" ? "Agree" : s === "neutral" ? "Neutral" : "Disagree";
          var active = opinion.ownStance === s;
          return (
            '<button type="button" class="stance-btn' +
            (active ? " is-active" : "") +
            '" aria-pressed="' +
            (active ? "true" : "false") +
            '" data-action="stance" data-opinion="' +
            esc(opinion.id) +
            '" data-stance="' +
            s +
            '">' +
            label +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="card-actions">' +
      '<button type="button" data-action="like" data-opinion="' +
      esc(opinion.id) +
      '"' +
      (opinion.ownLiked ? ' class="is-active"' : "") +
      ">♥ Like " +
      opinion.likeCount +
      "</button>" +
      '<button type="button" data-action="repost" data-opinion="' +
      esc(opinion.id) +
      '">↻ Repost ' +
      opinion.repostCount +
      "</button>" +
      '<button type="button" data-action="quote" data-opinion="' +
      esc(opinion.id) +
      '">Quote Repost</button>' +
      '<button type="button" data-action="bookmark" data-opinion="' +
      esc(opinion.id) +
      '"' +
      (bookmarked ? ' class="is-active"' : "") +
      ">" +
      (bookmarked ? "Saved ✓" : "Bookmark") +
      "</button>" +
      '<a href="#/post/' +
      esc(opinion.id) +
      '">Replies ' +
      opinion.replyCount +
      "</a>" +
      '<button type="button" data-action="follow" data-author="' +
      esc(view.authorId || "") +
      '"' +
      (opinion.isAnonymous ? " disabled" : "") +
      ">" +
      (followed ? "Following ✓" : "Follow") +
      "</button>" +
      '<button type="button" data-action="post-menu" data-opinion="' +
      esc(opinion.id) +
      '" aria-haspopup="true">⋯ More</button>' +
      "</div>" +
      (opts.showMenu
        ? '<div class="post-menu" role="menu">' +
          '<button type="button" role="menuitem" data-action="report" data-opinion="' +
          esc(opinion.id) +
          '">Report</button>' +
          '<button type="button" role="menuitem" data-action="mute-topic" data-opinion="' +
          esc(opinion.id) +
          '">Mute topic: ' +
          esc(opinion.topic) +
          "</button>" +
          '<button type="button" role="menuitem" data-action="block" data-opinion="' +
          esc(opinion.id) +
          '"' +
          (opinion.isAnonymous ? " disabled" : "") +
          ">Block author</button>" +
          '<button type="button" role="menuitem" data-action="hide" data-opinion="' +
          esc(opinion.id) +
          '">Hide this post</button>' +
          "</div>"
        : "") +
      "</article>"
    );
  }

  function stateHtml(kind, opts) {
    opts = opts || {};
    if (kind === "loading") {
      return '<div class="state state--loading" role="status"><p class="skeleton">Loading…</p><p class="skeleton skeleton--short"></p></div>';
    }
    if (kind === "empty") {
      return (
        '<div class="state state--empty" role="status"><h2>' +
        esc(opts.title || "Nothing here yet") +
        "</h2>" +
        "<p>" +
        esc(opts.text || "") +
        "</p>" +
        (opts.action
          ? '<a class="button" href="' +
            esc(opts.action.href) +
            '">' +
            esc(opts.action.label) +
            "</a>"
          : "") +
        "</div>"
      );
    }
    if (kind === "error") {
      return (
        '<div class="state state--error" role="alert"><h2>Something went wrong</h2>' +
        "<p>" +
        esc(opts.text || "The content could not be loaded. Nothing was changed.") +
        "</p>" +
        '<button type="button" class="button" data-action="retry">Try again</button></div>'
      );
    }
    return "";
  }

  function setMain(html) {
    var app = document.getElementById("app");
    if (app) app.innerHTML = html;
  }

  /* ---------------- actions (API-first, preview-local fallback) ---------------- */

  function previewNotice() {
    if (isPreview())
      showToast("Preview only — this change is local and was not saved to Opiinio.");
  }

  function undoToast(message, undoFn) {
    showToast(message + " (Undo: use Settings → Respect Filter to restore.)");
    if (undoFn) state._lastUndo = undoFn;
  }

  async function handleAction(e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.getAttribute("data-action");
    var opinionId = el.getAttribute("data-opinion");
    var opinion = opinionId
      ? sampleOpinionById(opinionId) || liveOpinionById(opinionId)
      : null;

    if (action === "retry") {
      route();
      return;
    }
    if (action === "load-more") {
      await loadMoreLive();
      state.skipLiveRefetch = true;
      route();
      return;
    }
    if (action === "lang") {
      return;
    }

    if (action === "stance" && opinion) {
      var stance = el.getAttribute("data-stance");
      if (!isPreview()) {
        try {
          await api("/opinions/" + opinionId + "/stance", {
            method: "POST",
            body: { stance: stance },
          });
          showToast("Stance saved.");
        } catch (err) {
          showToast(
            err.status === 401
              ? "Sign in required to vote."
              : "Could not save your stance.",
          );
        }
        route();
        return;
      }
      if (opinion.ownStance === stance) {
        opinion.ownStance = null;
      } else {
        if (opinion.ownStance === "agree") opinion.agreeCount -= 1;
        if (opinion.ownStance === "neutral") opinion.neutralCount -= 1;
        if (opinion.ownStance === "disagree") opinion.disagreeCount -= 1;
        opinion.ownStance = stance;
        if (stance === "agree") opinion.agreeCount += 1;
        if (stance === "neutral") opinion.neutralCount += 1;
        if (stance === "disagree") opinion.disagreeCount += 1;
      }
      previewNotice();
      route();
      return;
    }

    if (action === "like" && opinion) {
      if (!isPreview()) {
        try {
          await api("/opinions/" + opinionId + "/like", {
            method: opinion.ownLiked ? "DELETE" : "POST",
          });
        } catch (err) {
          showToast(
            err.status === 401
              ? "Sign in required to like."
              : "Could not save your like.",
          );
        }
        route();
        return;
      }
      opinion.ownLiked = !opinion.ownLiked;
      opinion.likeCount += opinion.ownLiked ? 1 : -1;
      previewNotice();
      route();
      return;
    }

    if (action === "bookmark" && opinion) {
      if (!isPreview()) {
        try {
          var isBookmarked = state.bookmarkedIds.indexOf(opinionId) !== -1;
          await api("/bookmarks" + (isBookmarked ? "/" + opinionId : ""), {
            method: isBookmarked ? "DELETE" : "POST",
            body: isBookmarked ? undefined : { opinion_id: opinionId },
          });
          showToast(
            isBookmarked ? "Bookmark removed." : "Bookmarked — find it in Read Later.",
          );
        } catch (err) {
          showToast(
            err.status === 401
              ? "Sign in required to bookmark."
              : "Could not save your bookmark.",
          );
        }
        route();
        return;
      }
      var idx = state.bookmarkedIds.indexOf(opinionId);
      if (idx === -1) state.bookmarkedIds.push(opinionId);
      else state.bookmarkedIds.splice(idx, 1);
      previewNotice();
      route();
      return;
    }

    if (action === "repost" && opinion) {
      if (!isPreview()) {
        try {
          await api("/opinions/" + opinionId + "/reposts", { method: "POST", body: {} });
          showToast("Reposted.");
        } catch (err) {
          showToast(
            err.status === 401
              ? "Sign in required to repost."
              : err.status === 409
                ? "You already reposted this."
                : "Could not repost.",
          );
        }
        route();
        return;
      }
      opinion.repostCount += 1;
      previewNotice();
      route();
      return;
    }

    if (action === "quote" && opinion) {
      window.location.hash = "#/compose?quote=" + encodeURIComponent(opinionId);
      return;
    }

    if (action === "follow") {
      var authorId = el.getAttribute("data-author");
      if (!authorId) return;
      if (!isPreview()) {
        try {
          var following = state.followedAuthors.indexOf(authorId) !== -1;
          await api("/follows" + (following ? "/" + authorId : ""), {
            method: following ? "DELETE" : "POST",
            body: following ? undefined : { following_id: authorId },
          });
          showToast(
            following
              ? "Unfollowed."
              : "Following — public instant follow, no request needed.",
          );
        } catch (err) {
          showToast(
            err.status === 401 ? "Sign in required to follow." : "Could not follow.",
          );
        }
        route();
        return;
      }
      var fi = state.followedAuthors.indexOf(authorId);
      if (fi === -1) state.followedAuthors.push(authorId);
      else state.followedAuthors.splice(fi, 1);
      previewNotice();
      route();
      return;
    }

    if (action === "poll-vote" && opinion && opinion.poll) {
      var optionId = el.getAttribute("data-option");
      if (opinion.poll.ownOptionId) {
        showToast("Vote locked — one vote only.");
        return;
      }
      if (!isPreview()) {
        try {
          await api("/polls/" + opinion.poll.id + "/votes", {
            method: "POST",
            body: { option_id: optionId },
          });
          showToast("Vote saved.");
        } catch (err) {
          showToast(
            err.status === 401
              ? "Sign in required to vote."
              : err.status === 409
                ? "You already voted in this poll."
                : "Could not save your vote.",
          );
        }
        route();
        return;
      }
      var opt = opinion.poll.options.find(function (o) {
        return o.id === optionId;
      });
      if (opt) {
        opt.voteCount += 1;
        opinion.poll.ownOptionId = optionId;
      }
      previewNotice();
      route();
      return;
    }

    if (action === "post-menu") {
      state.openMenuFor = state.openMenuFor === opinionId ? null : opinionId;
      route();
      return;
    }

    if (action === "hide" && opinion) {
      state.hiddenIds.push(opinionId);
      undoToast("Post hidden.");
      route();
      return;
    }

    if (action === "mute-topic" && opinion) {
      if (state.mutedTopics.indexOf(opinion.topic) === -1)
        state.mutedTopics.push(opinion.topic);
      if (!isPreview()) {
        try {
          await api("/muted-topics", { method: "POST", body: { topic: opinion.topic } });
        } catch (err) {
          showToast(
            err.status === 401
              ? "Sign in required to mute a topic."
              : "Could not mute this topic.",
          );
          route();
          return;
        }
      }
      undoToast("Topic muted: " + opinion.topic + ".");
      route();
      return;
    }

    if (action === "block" && opinion && !opinion.isAnonymous) {
      var blockedId = opinion.author.authorId;
      if (state.blockedAuthors.indexOf(blockedId) === -1)
        state.blockedAuthors.push(blockedId);
      if (!isPreview()) {
        try {
          await api("/blocks", { method: "POST", body: { blocked_id: blockedId } });
        } catch (err) {
          showToast(
            err.status === 401 ? "Sign in required to block." : "Could not block.",
          );
          route();
          return;
        }
      }
      undoToast(
        "Author blocked. Their posts are hidden, and follows are removed both ways.",
      );
      route();
      return;
    }

    if (action === "report") {
      window.location.hash = "#/compose?report=" + encodeURIComponent(opinionId);
      return;
    }

    if (action === "undo-hide") {
      state.hiddenIds = [];
      state.mutedTopics = [];
      state.mutedWords = [];
      state.blockedAuthors = [];
      showToast(
        "Hidden posts, muted topics and words, and blocks cleared in this preview.",
      );
      route();
      return;
    }

    if (action === "mark-read") {
      var noteId = el.getAttribute("data-notification");
      var note = state.notifications.find(function (n) {
        return n.id === noteId;
      });
      if (!note && state.liveNotifications) {
        note = state.liveNotifications.find(function (n) {
          return n.id === noteId;
        });
      }
      if (note) note.isRead = true;
      if (state.liveNotifications) {
        var liveNote = state.liveNotifications.find(function (n) {
          return n.id === noteId;
        });
        if (liveNote) liveNote.isRead = true;
      }
      if (!isPreview()) {
        try {
          await api("/notifications/" + noteId, {
            method: "PATCH",
            body: { is_read: true },
          });
        } catch (err) {
          /* preview/local state already updated; live error is shown, not hidden */ showToast(
            "Could not mark as read on the server.",
          );
        }
      }
      route();
      return;
    }
  }

  /* ---------------- screens ---------------- */

  function tabsHtml(current, tabs) {
    return (
      '<div class="tabs" role="tablist" aria-label="Feed sections">' +
      tabs
        .map(function (t) {
          var active = t.id === current;
          var href = t.href || "#/feed?tab=" + t.id;
          return (
            '<a role="tab" aria-selected="' +
            (active ? "true" : "false") +
            '" class="tab' +
            (active ? " is-active" : "") +
            '" href="' +
            href +
            '">' +
            esc(t.label) +
            "</a>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function screenWelcome() {
    return (
      '<section class="welcome">' +
      '<p class="eyebrow">Opiinio · Text only · 280 characters</p>' +
      "<h1>Opiinio</h1>" +
      '<p class="tagline-large">EVERY OPINION MATTERS</p>' +
      '<p class="lede">Share your opinion. Hear others. Decide together. No photos, no videos — words only.</p>' +
      '<div class="card card--teal"><p class="card-text">Remote work should be the default, not the exception.</p>' +
      '<p class="meter-line">Agree 62% · <span aria-hidden="true">⚖</span> · Disagree 38%</p></div>' +
      '<a class="button" href="#/onboarding">Get started</a> ' +
      '<a class="button button--secondary" href="#/signin">Sign in</a>' +
      '<p class="note">No account is created in preview mode. In live mode, sign-in goes through the server auth routes; email and Google providers must be enabled in Supabase first (see the setup guide).</p>' +
      "</section>"
    );
  }

  function screenSignIn() {
    if (state.pendingMfa) {
      return (
        '<section class="form-screen"><h1>Two-factor code</h1>' +
        "<p>Your password was accepted. Enter the 6-digit code from your authenticator app to finish sign-in.</p>" +
        '<form id="mfa-challenge-form" novalidate>' +
        '<label for="mfa-challenge-code">6-digit code</label>' +
        '<input id="mfa-challenge-code" name="code" type="text" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required />' +
        '<button class="button" type="submit">Verify and sign in</button>' +
        '<p id="mfa-challenge-error" class="form-error" role="alert"></p></form>' +
        '<p class="note">SMS codes are never used — authenticator app (TOTP) only. There are no backup codes.</p>' +
        "</section>"
      );
    }
    var isSignup = state.authMode === "signup";
    return (
      '<section class="form-screen"><h1>' +
      (isSignup ? "Create account" : "Sign in") +
      "</h1>" +
      (isPreview()
        ? '<div class="state state--error" role="alert"><h2>Preview mode</h2>' +
          "<p>The API is not connected, so no account is created or signed in here. " +
          "In live mode this form calls the server auth routes — nothing is sent directly to Supabase from this page.</p></div>"
        : "") +
      '<form id="signin-form" novalidate>' +
      '<label for="signin-email">Email address</label>' +
      '<input id="signin-email" name="email" type="email" autocomplete="email" required />' +
      '<label for="signin-password">Password (8–128 characters)</label>' +
      '<input id="signin-password" name="password" type="password" autocomplete="current-password" required minlength="8" />' +
      '<button class="button" type="submit">' +
      (isSignup ? "Create account" : "Sign in") +
      "</button>" +
      '<p id="signin-error" class="form-error" role="alert"></p>' +
      '<p id="signin-success" class="form-success" role="status"></p></form>' +
      '<button class="button button--secondary" type="button" data-action="auth-toggle">' +
      (isSignup ? "Already have an account? Sign in" : "New here? Create an account") +
      "</button> " +
      '<button class="button button--secondary" type="button" data-action="google-signin">Continue with Google</button>' +
      '<form id="reset-form" novalidate><h2>Forgot your password?</h2>' +
      '<label for="reset-email">Email address</label>' +
      '<input id="reset-email" name="email" type="email" autocomplete="email" required />' +
      '<button class="button button--small" type="submit">Send reset link</button>' +
      '<p id="reset-success" class="form-success" role="status"></p>' +
      '<p id="reset-error" class="form-error" role="alert"></p></form>' +
      '<p class="note">If an account exists for that email, a reset link is sent. The reply is the same either way, so it cannot be used to check whether an email has an account.</p>' +
      "</section>"
    );
  }

  function screenOnboarding() {
    return (
      '<section class="form-screen"><h1>Welcome to Opiinio</h1>' +
      "<p>Three quick steps. Nothing here creates an account in preview mode.</p>" +
      "<ol><li><strong>Pick topics you care about</strong> — Work, Money, Cities, Education, Everyday life, Technology.</li>" +
      "<li><strong>Write in 280 characters or fewer</strong> — text only, no photos or videos.</li>" +
      "<li><strong>Vote, debate, and repost</strong> — Agree, Neutral, or Disagree on every opinion.</li></ol>" +
      '<form id="onboarding-form"><fieldset><legend>Topics you care about (optional, preview only)</legend>' +
      ["Work", "Money", "Cities", "Education", "Everyday life", "Technology"]
        .map(function (t) {
          return (
            '<label class="check"><input type="checkbox" name="topic" value="' +
            esc(t) +
            '" /> ' +
            esc(t) +
            "</label>"
          );
        })
        .join("") +
      "</fieldset>" +
      '<button class="button" type="submit">Finish and see the feed</button></form>' +
      '<p class="note">In the live app, onboarding choices are stored on your own profile only.</p></section>'
    );
  }

  function dailyCardHtml() {
    if (isLive()) {
      if (!state.liveDaily) return "";
      return (
        '<section class="card card--coral daily-card" aria-label="Daily question">' +
        '<p class="eyebrow">Daily question</p>' +
        '<p class="card-text">' +
        esc(state.liveDaily.question) +
        "</p>" +
        '<a class="button button--small" href="#/compose?daily=' +
        esc(state.liveDaily.id) +
        '">Answer this question</a>' +
        '<p class="note">Answers to the Daily Question get a Daily answer badge on the post.</p></section>'
      );
    }
    return (
      '<section class="card card--coral daily-card" aria-label="Daily question">' +
      '<p class="eyebrow">Daily question</p>' +
      '<p class="card-text">' +
      esc(SAMPLE_DAILY.question) +
      "</p>" +
      '<a class="button button--small" href="#/compose?daily=' +
      esc(SAMPLE_DAILY.id) +
      '">Answer this question</a>' +
      '<p class="note">Answers to the Daily Question get a Daily answer badge on the post.</p></section>'
    );
  }

  function loadMoreHtml() {
    if (!state.liveMore || !state.liveMore.cursor) return "";
    return '<button type="button" class="button button--secondary" data-action="load-more">Load more</button>';
  }

  function screenFeed() {
    var tab = state.tab;
    if (isLive()) {
      if (state.liveFeedError === "auth") {
        return stateHtml("empty", {
          title: "Sign in required",
          text: "Your session expired. Sign in again to see live posts.",
          action: { href: "#/signin", label: "Sign in" },
        });
      }
      if (state.liveFeedError === "error") {
        return stateHtml("error", {
          text: "Live posts could not be loaded. Try again — nothing was changed.",
        });
      }
      if (tab === "following") {
        if (!state.token) {
          return (
            tabsHtml(tab, [
              { id: "for-you", label: "For You" },
              { id: "trending", label: "Trending" },
              { id: "debates", label: "Debates" },
              { id: "following", label: "Following" },
            ]) +
            stateHtml("empty", {
              title: "Sign in to see people you follow",
              text: "Following is private to your account.",
              action: { href: "#/signin", label: "Sign in" },
            })
          );
        }
        return (
          tabsHtml(tab, [
            { id: "for-you", label: "For You" },
            { id: "trending", label: "Trending" },
            { id: "debates", label: "Debates" },
            { id: "following", label: "Following" },
          ]) +
          stateHtml("empty", {
            title: "Following list is not available yet",
            text: "The API has follow and unfollow, but no list of the people you follow, so this tab cannot be filled from live data yet. Follow people from their profiles or posts.",
            action: { href: "#/explore", label: "Explore topics" },
          })
        );
      }
      var liveAll = visibleOpinions(state.liveFeedItems || []);
      var liveList = liveAll;
      if (tab === "trending")
        liveList = liveAll.slice().sort(function (a, b) {
          return b.likeCount + b.repostCount - (a.likeCount + a.repostCount);
        });
      if (liveList.length === 0) {
        return (
          tabsHtml(tab, [
            { id: "for-you", label: "For You" },
            { id: "trending", label: "Trending" },
            { id: "debates", label: "Debates" },
            { id: "following", label: "Following" },
          ]) +
          stateHtml("empty", {
            title: "No opinions here yet",
            text: "Try another tab, or write the first opinion on this topic.",
            action: { href: "#/compose", label: "Write an opinion" },
          })
        );
      }
      return (
        tabsHtml(tab, [
          { id: "for-you", label: "For You" },
          { id: "trending", label: "Trending" },
          { id: "debates", label: "Debates" },
          { id: "following", label: "Following" },
        ]) +
        dailyCardHtml() +
        liveList
          .map(function (o) {
            return opinionCardHtml(o, { showMenu: state.openMenuFor === o.id });
          })
          .join("") +
        loadMoreHtml()
      );
    }
    var all = visibleOpinions(SAMPLE_OPINIONS);
    var list = all;
    if (tab === "trending")
      list = all.slice().sort(function (a, b) {
        return b.likeCount + b.repostCount - (a.likeCount + a.repostCount);
      });
    if (tab === "debates")
      list = all.filter(function (o) {
        return (
          o.replies.some(function (r) {
            return r.side === "for";
          }) &&
          o.replies.some(function (r) {
            return r.side === "against";
          })
        );
      });
    if (tab === "following") {
      return (
        tabsHtml(tab, [
          { id: "for-you", label: "For You" },
          { id: "trending", label: "Trending" },
          { id: "debates", label: "Debates" },
          { id: "following", label: "Following" },
        ]) +
        stateHtml("empty", {
          title: "No posts from people you follow yet",
          text: "Follow people from their profiles or posts, then their opinions appear here. In preview mode, follows are local only and are not saved.",
          action: { href: "#/explore", label: "Explore topics" },
        })
      );
    }
    if (list.length === 0) {
      return (
        tabsHtml(tab, [
          { id: "for-you", label: "For You" },
          { id: "trending", label: "Trending" },
          { id: "debates", label: "Debates" },
          { id: "following", label: "Following" },
        ]) +
        stateHtml("empty", {
          title: "No opinions here yet",
          text: "Try another tab, clear a muted topic, or write the first opinion on this topic.",
          action: { href: "#/compose", label: "Write an opinion" },
        })
      );
    }
    var cards = list
      .map(function (o) {
        return opinionCardHtml(o, { showMenu: state.openMenuFor === o.id });
      })
      .join("");
    return (
      tabsHtml(tab, [
        { id: "for-you", label: "For You" },
        { id: "trending", label: "Trending" },
        { id: "debates", label: "Debates" },
        { id: "following", label: "Following" },
      ]) +
      dailyCardHtml() +
      cards
    );
  }

  function screenCompose() {
    var q = state.query;
    var quoted = q.quote ? sampleOpinionById(q.quote) : null;
    var isReport = Boolean(q.report);
    var title = isReport ? "Report a post" : "Compose";
    var daily = q.daily === SAMPLE_DAILY.id;
    return (
      '<section class="form-screen"><h1>' +
      esc(title) +
      "</h1>" +
      (quoted
        ? '<div class="card"><p class="note">Quoting:</p><p>' +
          esc(quoted.body) +
          "</p></div>"
        : "") +
      (daily
        ? '<p><span class="badge">Daily answer</span> ' +
          esc(SAMPLE_DAILY.question) +
          "</p>"
        : "") +
      '<form id="compose-form" novalidate>' +
      '<label for="compose-body">' +
      (isReport ? "Reason (1–280 characters)" : "Your opinion (1–280 characters)") +
      "</label>" +
      '<textarea id="compose-body" name="body" rows="5" maxlength="280" required aria-describedby="compose-count"></textarea>' +
      '<p id="compose-count" class="counter" aria-live="polite">0/280</p>' +
      (isReport
        ? ""
        : '<label for="compose-topic">Topic</label>' +
          '<select id="compose-topic" name="topic">' +
          ["Work", "Money", "Cities", "Education", "Everyday life", "Technology"]
            .map(function (t) {
              return '<option value="' + esc(t) + '">' + esc(t) + "</option>";
            })
            .join("") +
          "</select>" +
          '<label class="check"><input id="compose-anon" type="checkbox" name="anonymous" /> Post anonymously (shows as Anonymous, not your name)</label>' +
          "<fieldset><legend>Attach a text-only poll (optional, 2–6 options)</legend>" +
          '<label for="poll-1">Poll option 1</label><input id="poll-1" name="poll" type="text" maxlength="80" />' +
          '<label for="poll-2">Poll option 2</label><input id="poll-2" name="poll" type="text" maxlength="80" />' +
          '<label for="poll-3">Poll option 3 (optional)</label><input id="poll-3" name="poll" type="text" maxlength="80" />' +
          '<p class="field-note">Poll votes are locked to one vote, and results show counts only — never who voted.</p></fieldset>') +
      '<button class="button" type="submit">' +
      (isReport ? "Submit report" : "Post opinion") +
      "</button>" +
      '<p id="compose-error" class="form-error" role="alert"></p>' +
      '<p id="compose-success" class="form-success" role="status"></p></form>' +
      '<p class="note">No photo, video, or file upload exists on this screen — by design. Text only.</p></section>'
    );
  }

  function screenPost() {
    if (isLive() && state.livePost) {
      var liveOpinion = state.livePost;
      if (isHidden(liveOpinion)) {
        return stateHtml("empty", {
          title: "This post is hidden",
          text: "You hid, muted, or blocked this content. Restore it from Settings → Respect Filter.",
          action: { href: "#/settings", label: "Open Settings" },
        });
      }
      return screenPostLive(liveOpinion);
    }
    if (isLive() && state.livePostError) {
      return stateHtml("error", {
        text: "That opinion could not be loaded. It may have been deleted, or the link is wrong.",
      });
    }
    var opinion = sampleOpinionById(state.param);
    if (!opinion) {
      return stateHtml("error", {
        text: "That opinion could not be found. It may have been deleted, or the link is wrong.",
      });
    }
    if (isHidden(opinion)) {
      return stateHtml("empty", {
        title: "This post is hidden",
        text: "You hid, muted, or blocked this content. Restore it from Settings → Respect Filter.",
        action: { href: "#/settings", label: "Open Settings" },
      });
    }
    var replies = opinion.replies.slice();
    if (state.replySideFilter !== "all")
      replies = replies.filter(function (r) {
        return r.side === state.replySideFilter;
      });
    if (state.replySort === "best")
      replies.sort(function (a, b) {
        return b.voiceScore - a.voiceScore;
      });
    var topReply = opinion.replies.slice().sort(function (a, b) {
      return b.voiceScore - a.voiceScore;
    })[0];
    var replyCards =
      replies.length === 0
        ? stateHtml("empty", {
            title: "No replies yet",
            text: "Be the first to reply — pick a side: For, Against, or Neutral.",
          })
        : replies
            .map(function (r) {
              var isTop = topReply && r.id === topReply.id;
              return (
                '<article class="card reply-card"><div class="post-head">' +
                avatarHtml(r.author, false) +
                '<div class="post-meta">' +
                authorLineHtml(r.author, false) +
                ' <span class="badge">' +
                esc(r.side) +
                "</span>" +
                (isTop ? ' <span class="badge">Best Argument</span>' : "") +
                "</div></div>" +
                '<p class="card-text">' +
                esc(r.body) +
                "</p>" +
                "<p>Voice Score: " +
                r.voiceScore +
                " · Likes: " +
                r.voiceScore +
                "</p>" +
                '<button type="button" data-action="reply-like" data-reply="' +
                esc(r.id) +
                '">♥ Like reply</button></article>'
              );
            })
            .join("");
    var debateHtml = "";
    if (state.debateMode) {
      var fors = opinion.replies.filter(function (r) {
        return r.side === "for";
      });
      var againsts = opinion.replies.filter(function (r) {
        return r.side === "against";
      });
      var col = function (list, label) {
        return (
          '<section aria-label="' +
          label +
          '"><h2>' +
          label +
          "</h2>" +
          (list.length === 0
            ? "<p>No " + label.toLowerCase() + " replies yet.</p>"
            : list
                .map(function (r) {
                  return (
                    '<article class="card reply-card"><p>' +
                    esc(r.body) +
                    "</p><p>— " +
                    esc(r.author.displayName) +
                    " · Voice Score " +
                    r.voiceScore +
                    "</p></article>"
                  );
                })
                .join("")) +
          "</section>"
        );
      };
      debateHtml =
        '<div class="split">' + col(fors, "For") + col(againsts, "Against") + "</div>";
    }
    return (
      '<section><a href="#/feed">← Back to feed</a>' +
      opinionCardHtml(opinion, { showMenu: state.openMenuFor === opinion.id }) +
      '<div class="controls" role="group" aria-label="Debate controls">' +
      '<button type="button" class="button button--small" data-action="debate-toggle">' +
      (state.debateMode ? "Exit Debate Mode" : "Debate Mode: split For / Against") +
      "</button> " +
      '<label for="reply-sort">Sort replies</label>' +
      '<select id="reply-sort"><option value="best"' +
      (state.replySort === "best" ? " selected" : "") +
      ">Best Argument</option>" +
      '<option value="newest"' +
      (state.replySort === "newest" ? " selected" : "") +
      ">Newest</option></select> " +
      '<label for="reply-side">Side</label>' +
      '<select id="reply-side"><option value="all">All sides</option><option value="for"' +
      (state.replySideFilter === "for" ? " selected" : "") +
      ">For</option>" +
      '<option value="against"' +
      (state.replySideFilter === "against" ? " selected" : "") +
      ">Against</option>" +
      '<option value="neutral"' +
      (state.replySideFilter === "neutral" ? " selected" : "") +
      ">Neutral</option></select></div>" +
      (state.debateMode ? debateHtml : "<h2>Replies</h2>" + replyCards) +
      '<section class="form-screen"><h2>Write a reply</h2>' +
      '<form id="reply-form" novalidate>' +
      '<label for="reply-body">Your reply (1–280 characters)</label>' +
      '<textarea id="reply-body" rows="4" maxlength="280" required aria-describedby="reply-count"></textarea>' +
      '<p id="reply-count" class="counter" aria-live="polite">0/280</p>' +
      '<label for="reply-side-input">Your side</label>' +
      '<select id="reply-side-input"><option value="for">For</option><option value="against">Against</option><option value="neutral">Neutral</option></select>' +
      '<button class="button" type="submit">Post reply</button>' +
      '<p id="reply-error" class="form-error" role="alert"></p>' +
      '<p id="reply-success" class="form-success" role="status"></p></form></section></section>'
    );
  }

  function screenPostLive(opinion) {
    var replies = (state.livePostReplies || []).slice();
    if (state.replySideFilter !== "all")
      replies = replies.filter(function (r) {
        return r.side === state.replySideFilter;
      });
    if (state.replySort === "best")
      replies.sort(function (a, b) {
        return b.voiceScore - a.voiceScore;
      });
    var topReply = (state.livePostReplies || []).slice().sort(function (a, b) {
      return b.voiceScore - a.voiceScore;
    })[0];
    var replyCards =
      replies.length === 0
        ? stateHtml("empty", {
            title: "No replies yet",
            text: "Be the first to reply — pick a side: For, Against, or Neutral.",
          })
        : replies
            .map(function (r) {
              var isTop = topReply && r.id === topReply.id;
              var rAuthor = r.author || {
                displayName: "Unknown",
                handle: "unknown",
                authorId: null,
              };
              return (
                '<article class="card reply-card"><div class="post-head">' +
                avatarHtml(rAuthor, false) +
                '<div class="post-meta">' +
                authorLineHtml(rAuthor, false) +
                ' <span class="badge">' +
                esc(r.side) +
                "</span>" +
                (isTop ? ' <span class="badge">Best Argument</span>' : "") +
                "</div></div>" +
                '<p class="card-text">' +
                esc(r.body) +
                "</p>" +
                "<p>Voice Score: " +
                r.voiceScore +
                "</p>" +
                '<button type="button" data-action="reply-like" data-reply="' +
                esc(r.id) +
                '">♥ Like reply</button></article>'
              );
            })
            .join("");
    var debateHtml = "";
    if (state.debateMode) {
      var fors = (state.livePostReplies || []).filter(function (r) {
        return r.side === "for";
      });
      var againsts = (state.livePostReplies || []).filter(function (r) {
        return r.side === "against";
      });
      var col = function (list, label) {
        return (
          '<section aria-label="' +
          label +
          '"><h2>' +
          label +
          "</h2>" +
          (list.length === 0
            ? "<p>No " + label.toLowerCase() + " replies yet.</p>"
            : list
                .map(function (r) {
                  var ra = r.author || { displayName: "Unknown" };
                  return (
                    '<article class="card reply-card"><p>' +
                    esc(r.body) +
                    "</p><p>— " +
                    esc(ra.displayName) +
                    " · Voice Score " +
                    r.voiceScore +
                    "</p></article>"
                  );
                })
                .join("")) +
          "</section>"
        );
      };
      debateHtml =
        '<div class="split">' + col(fors, "For") + col(againsts, "Against") + "</div>";
    }
    return (
      '<section><a href="#/feed">← Back to feed</a>' +
      opinionCardHtml(opinion, { showMenu: state.openMenuFor === opinion.id }) +
      '<div class="controls" role="group" aria-label="Debate controls">' +
      '<button type="button" class="button button--small" data-action="debate-toggle">' +
      (state.debateMode ? "Exit Debate Mode" : "Debate Mode: split For / Against") +
      "</button> " +
      '<label for="reply-sort">Sort replies</label>' +
      '<select id="reply-sort"><option value="best"' +
      (state.replySort === "best" ? " selected" : "") +
      ">Best Argument</option>" +
      '<option value="newest"' +
      (state.replySort === "newest" ? " selected" : "") +
      ">Newest</option></select> " +
      '<label for="reply-side">Side</label>' +
      '<select id="reply-side"><option value="all">All sides</option><option value="for"' +
      (state.replySideFilter === "for" ? " selected" : "") +
      ">For</option>" +
      '<option value="against"' +
      (state.replySideFilter === "against" ? " selected" : "") +
      ">Against</option>" +
      '<option value="neutral"' +
      (state.replySideFilter === "neutral" ? " selected" : "") +
      ">Neutral</option></select></div>" +
      (state.debateMode ? debateHtml : "<h2>Replies</h2>" + replyCards) +
      '<section class="form-screen"><h2>Write a reply</h2>' +
      '<form id="reply-form" novalidate>' +
      '<label for="reply-body">Your reply (1–280 characters)</label>' +
      '<textarea id="reply-body" rows="4" maxlength="280" required aria-describedby="reply-count"></textarea>' +
      '<p id="reply-count" class="counter" aria-live="polite">0/280</p>' +
      '<label for="reply-side-input">Your side</label>' +
      '<select id="reply-side-input"><option value="for">For</option><option value="against">Against</option><option value="neutral">Neutral</option></select>' +
      '<button class="button" type="submit">Post reply</button>' +
      '<p id="reply-error" class="form-error" role="alert"></p>' +
      '<p id="reply-success" class="form-success" role="status"></p></form></section></section>'
    );
  }

  function screenExplore() {
    if (isLive()) {
      var liveCounts = {};
      (state.liveFeedItems || []).forEach(function (o) {
        liveCounts[o.topic] = (liveCounts[o.topic] || 0) + o.likeCount + o.repostCount;
      });
      var liveTopics = Object.keys(liveCounts)
        .map(function (t) {
          return { topic: t, score: liveCounts[t] };
        })
        .sort(function (a, b) {
          return b.score - a.score;
        })
        .slice(0, 6);
      var liveRows = liveTopics
        .map(function (t, i) {
          return (
            '<li><span class="rank">' +
            (i + 1) +
            "</span> " +
            '<a href="#/feed?topic=' +
            encodeURIComponent(t.topic) +
            '">' +
            esc(t.topic) +
            "</a> · " +
            t.score +
            " signals</li>"
          );
        })
        .join("");
      return (
        "<section><h1>Explore</h1>" +
        '<form id="search-form" role="search"><label for="search-q">Search opinions (up to 100 characters)</label>' +
        '<input id="search-q" type="search" maxlength="100" />' +
        '<button class="button" type="submit">Search</button></form>' +
        '<div id="search-results"></div>' +
        "<h2>Trending Topics · Ranked</h2>" +
        '<ol class="ranked">' +
        liveRows +
        "</ol>" +
        '<p class="note">Ranks are 1–6, computed from recent live posts. There is no rank 0.</p>' +
        "<h2>People to Discover</h2>" +
        '<p class="note">Not available: Layer 5 deliberately has no profile-list or user-search route, pending its own privacy review. ' +
        "This screen does not invent one — people are discovered through their posts, not a directory.</p>" +
        "</section>"
      );
    }
    var counts = {};
    SAMPLE_OPINIONS.forEach(function (o) {
      counts[o.topic] = (counts[o.topic] || 0) + o.likeCount + o.repostCount;
    });
    var topics = Object.keys(counts)
      .map(function (t) {
        return { topic: t, score: counts[t] };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, 6);
    var rows = topics
      .map(function (t, i) {
        return (
          '<li><span class="rank">' +
          (i + 1) +
          "</span> " +
          '<a href="#/feed?topic=' +
          encodeURIComponent(t.topic) +
          '">' +
          esc(t.topic) +
          "</a> · " +
          t.score +
          " signals</li>"
        );
      })
      .join("");
    return (
      "<section><h1>Explore</h1>" +
      '<form id="search-form" role="search"><label for="search-q">Search opinions (up to 100 characters)</label>' +
      '<input id="search-q" type="search" maxlength="100" />' +
      '<button class="button" type="submit">Search</button></form>' +
      '<div id="search-results"></div>' +
      "<h2>Trending Topics · Ranked</h2>" +
      '<ol class="ranked">' +
      rows +
      "</ol>" +
      '<p class="note">Ranks are 1–6, computed from sample engagement in preview mode. There is no rank 0.</p>' +
      "<h2>People to Discover</h2>" +
      '<p class="note">Not available: Layer 5 deliberately has no profile-list or user-search route, pending its own privacy review. ' +
      "This screen does not invent one — people are discovered through their posts, not a directory.</p>" +
      "</section>"
    );
  }

  function screenDebates() {
    if (isLive()) {
      if (state.liveFeedError === "auth") {
        return stateHtml("empty", {
          title: "Sign in required",
          text: "Your session expired. Sign in again to see live debates.",
          action: { href: "#/signin", label: "Sign in" },
        });
      }
      var liveDebates = visibleOpinions(state.liveFeedItems || []);
      if (liveDebates.length === 0)
        return stateHtml("empty", {
          title: "No debates yet",
          text: "A debate needs at least one For reply and one Against reply on the same opinion.",
        });
      return (
        "<h1>Debates</h1>" +
        liveDebates
          .map(function (o) {
            return opinionCardHtml(o, {});
          })
          .join("") +
        loadMoreHtml()
      );
    }
    var list = visibleOpinions(SAMPLE_OPINIONS).filter(function (o) {
      return (
        o.replies.some(function (r) {
          return r.side === "for";
        }) &&
        o.replies.some(function (r) {
          return r.side === "against";
        })
      );
    });
    if (list.length === 0)
      return stateHtml("empty", {
        title: "No debates yet",
        text: "A debate needs at least one For reply and one Against reply on the same opinion.",
      });
    return (
      "<h1>Debates</h1>" +
      list
        .map(function (o) {
          return opinionCardHtml(o, {});
        })
        .join("")
    );
  }

  function screenNotifications() {
    if (isLive()) {
      if (state.liveNotificationsError === "auth" || !state.token) {
        return stateHtml("empty", {
          title: "Sign in to see notifications",
          text: "Notifications are private to your account.",
          action: { href: "#/signin", label: "Sign in" },
        });
      }
      if (state.liveNotificationsError === "error") {
        return stateHtml("error", {
          text: "Notifications could not be loaded. Try again — nothing was changed.",
        });
      }
      var liveNotes = state.liveNotifications || [];
      if (liveNotes.length === 0) {
        return stateHtml("empty", {
          title: "No notifications",
          text: "Likes, replies, and reposts on your opinions will appear here.",
        });
      }
      var liveUnread = liveNotes.filter(function (n) {
        return !n.isRead;
      }).length;
      return (
        "<h1>Notifications" +
        (liveUnread ? " (" + liveUnread + " unread)" : "") +
        "</h1>" +
        liveNotes
          .map(function (n) {
            var actor = n.actor || {
              displayName: "Anonymous",
              handle: "Anonymous",
              authorId: null,
            };
            return (
              '<article class="card notification-card' +
              (n.isRead ? " is-read" : "") +
              '">' +
              "<p><strong>" +
              esc(actor.displayName) +
              "</strong> " +
              esc(n.type) +
              "d your post</p>" +
              '<button type="button" data-action="mark-read" data-notification="' +
              esc(n.id) +
              '"' +
              (n.isRead ? " disabled" : "") +
              ">" +
              (n.isRead ? "Read ✓" : "Mark as read") +
              "</button></article>"
            );
          })
          .join("") +
        loadMoreHtml() +
        '<p class="note">Notifications are created by the server only — users cannot post notifications, and nobody else can see yours.</p>'
      );
    }
    if (!state.token && !isPreview()) {
      return stateHtml("empty", {
        title: "Sign in to see notifications",
        text: "Notifications are private to your account.",
      });
    }
    if (state.notifications.length === 0) {
      return stateHtml("empty", {
        title: "No notifications",
        text: "Likes, replies, and reposts on your opinions will appear here.",
      });
    }
    var unread = state.notifications.filter(function (n) {
      return !n.isRead;
    }).length;
    return (
      "<h1>Notifications" +
      (unread ? " (" + unread + " unread)" : "") +
      "</h1>" +
      state.notifications
        .map(function (n) {
          var actor = authorView(n.actor, n.actorAnonymous);
          var opinion = sampleOpinionById(n.opinionId);
          return (
            '<article class="card notification-card' +
            (n.isRead ? " is-read" : "") +
            '">' +
            "<p><strong>" +
            esc(actor.displayName) +
            "</strong> " +
            esc(n.type) +
            "d " +
            (opinion ? "“" + esc(opinion.body.slice(0, 60)) + "…”" : "your post") +
            "</p>" +
            '<button type="button" data-action="mark-read" data-notification="' +
            esc(n.id) +
            '"' +
            (n.isRead ? " disabled" : "") +
            ">" +
            (n.isRead ? "Read ✓" : "Mark as read") +
            "</button></article>"
          );
        })
        .join("") +
      '<p class="note">Notifications are created by the server only — users cannot post notifications, and nobody else can see yours.</p>'
    );
  }

  function screenProfile() {
    var id = state.param;
    if (isLive()) {
      if (state.liveProfileError === "auth") {
        return stateHtml("empty", {
          title: "Sign in to see your profile",
          text: "Your own profile, likes, and saved posts need a live session.",
          action: { href: "#/signin", label: "Sign in" },
        });
      }
      if (state.liveProfileError === "error" || !state.liveProfile) {
        return stateHtml("error", {
          text: "That profile could not be loaded. It may not exist, or the link is wrong.",
        });
      }
      var lp = state.liveProfile;
      var isOwn = state.user && state.user.id && lp.id === state.user.id;
      var ltab = state.profileTab;
      var lbody = "";
      if (ltab === "opinions") {
        var lops = state.liveProfileTabItems || [];
        lbody =
          lops.length === 0
            ? stateHtml("empty", {
                title: "No opinions yet",
                text: "This person has not posted an opinion yet.",
              })
            : lops
                .map(function (o) {
                  return opinionCardHtml(o, {});
                })
                .join("");
      } else if (ltab === "replies") {
        lbody = stateHtml("empty", {
          title: "Replies by this person are not listed yet",
          text: "The API has replies per opinion, but no replies-by-user route, so this tab cannot be filled from live data yet. Replies are visible on each opinion's page.",
        });
      } else if (ltab === "reposts") {
        var lreps = state.liveProfileTabItems || [];
        lbody =
          lreps.length === 0
            ? stateHtml("empty", {
                title: "0 reposts",
                text: "This person has not reposted anything yet.",
              })
            : "<p>" +
              lreps.length +
              " reposts</p>" +
              lreps
                .map(function (rep) {
                  return (
                    '<article class="card">' +
                    (rep.quoteTake
                      ? '<p class="card-text">' + esc(rep.quoteTake) + "</p>"
                      : "") +
                    (rep.original
                      ? '<div class="quote-block"><p>' +
                        esc(rep.original.body) +
                        "</p><p>— " +
                        esc(
                          rep.original.isAnonymous
                            ? "Anonymous"
                            : rep.original.author.displayName,
                        ) +
                        "</div>"
                      : "") +
                    "<p>" +
                    (rep.quoteTake ? "Quote Repost" : "Repost") +
                    "</p></article>"
                  );
                })
                .join("");
      } else if (ltab === "likes") {
        lbody = stateHtml("empty", {
          title: "Likes are not listed yet",
          text: "The API has like and unlike, but no likes-by-user route, so this tab cannot be filled from live data yet. Your own likes are never shown to other people.",
        });
      } else if (ltab === "bookmarks") {
        if (!isOwn) {
          lbody = stateHtml("empty", {
            title: "Read Later is private",
            text: "Other people's saved posts are never shown to you.",
          });
        } else {
          var lbooks = state.liveProfileTabItems || [];
          lbody =
            lbooks.length === 0
              ? stateHtml("empty", {
                  title: "Nothing saved yet",
                  text: "Bookmark opinions from the feed to find them here later.",
                })
              : lbooks
                  .map(function (o) {
                    return opinionCardHtml(o, {});
                  })
                  .join("");
        }
      }
      var followedLive = state.followedAuthors.indexOf(lp.id) !== -1;
      return (
        '<section class="profile">' +
        '<div class="profile-head"><span class="avatar avatar--large" aria-hidden="true">' +
        esc(lp.initials || initialsFor(lp.displayName)) +
        "</span>" +
        "<div><h1>" +
        esc(lp.displayName) +
        "</h1><p>@ " +
        esc(lp.handle) +
        "</p>" +
        "<p>" +
        lp.followingCount +
        " Following · " +
        lp.followerCount +
        " Followers · " +
        (state.liveProfileTabItems && ltab === "opinions"
          ? state.liveProfileTabItems.length
          : "") +
        "</p>" +
        (lp.bio ? "<p>" + esc(lp.bio) + "</p>" : "") +
        (isOwn
          ? ""
          : '<button type="button" class="button button--small" data-action="follow" data-author="' +
            esc(lp.id) +
            '">' +
            (followedLive ? "Following ✓" : "Follow") +
            "</button>") +
        "</div></div>" +
        '<p class="note">Initials-only avatar. No cover photo and no photo upload — text only, by design.</p>' +
        (state.livePinnedOpinion
          ? '<section aria-label="Pinned post"><h2>Pinned</h2>' +
            opinionCardHtml(state.livePinnedOpinion, {}) +
            "</section>"
          : "") +
        '<div class="tabs" role="tablist" aria-label="Profile sections">' +
        ["opinions", "replies", "reposts", "likes", "bookmarks"]
          .map(function (tt) {
            var label = tt.charAt(0).toUpperCase() + tt.slice(1);
            return (
              '<a role="tab" aria-selected="' +
              (tt === ltab ? "true" : "false") +
              '" class="tab' +
              (tt === ltab ? " is-active" : "") +
              '" href="#/profile/' +
              esc(id) +
              "?tab=" +
              tt +
              '">' +
              label +
              "</a>"
            );
          })
          .join("") +
        "</div>" +
        lbody +
        loadMoreHtml() +
        "</section>"
      );
    }
    if (id === "me") {
      return stateHtml("empty", {
        title: "Sign in to see your profile",
        text: "Your own profile, likes, and saved posts need a live session. Sign-in is not live yet in this layer.",
      });
    }
    var author = null;
    Object.keys(SAMPLE_AUTHORS).forEach(function (k) {
      if (SAMPLE_AUTHORS[k].authorId === id) author = SAMPLE_AUTHORS[k];
    });
    if (!author) {
      return stateHtml("error", { text: "That profile could not be found." });
    }
    var opinions = SAMPLE_OPINIONS.filter(function (o) {
      return o.author.authorId === id;
    });
    var replies = [];
    SAMPLE_OPINIONS.forEach(function (o) {
      o.replies.forEach(function (r) {
        if (r.author.authorId === id) replies.push(r);
      });
    });
    var reposts = SAMPLE_REPOSTS.filter(function (r) {
      return r.repostedBy.authorId === id;
    });
    var followed = state.followedAuthors.indexOf(id) !== -1;
    var tab = state.profileTab;
    var body = "";
    if (tab === "opinions") {
      body =
        opinions.length === 0
          ? stateHtml("empty", {
              title: "No opinions yet",
              text: "This person has not posted an opinion yet.",
            })
          : opinions
              .map(function (o) {
                return opinionCardHtml(o, {});
              })
              .join("");
    } else if (tab === "replies") {
      body =
        replies.length === 0
          ? stateHtml("empty", {
              title: "No replies yet",
              text: "This person has not replied to an opinion yet.",
            })
          : replies
              .map(function (r) {
                return (
                  '<article class="card reply-card"><p>' +
                  esc(r.body) +
                  "</p><p>Voice Score: " +
                  r.voiceScore +
                  "</p></article>"
                );
              })
              .join("");
    } else if (tab === "reposts") {
      body =
        reposts.length === 0
          ? stateHtml("empty", {
              title: "0 reposts",
              text: "This person has not reposted anything yet.",
            })
          : "<p>" +
            reposts.length +
            " reposts</p>" +
            reposts
              .map(function (rep) {
                var original = sampleOpinionById(rep.opinionId);
                return (
                  '<article class="card">' +
                  (rep.quoteTake
                    ? '<p class="card-text">' + esc(rep.quoteTake) + "</p>"
                    : "") +
                  (original
                    ? '<div class="quote-block"><p>' +
                      esc(original.body) +
                      "</p><p>— " +
                      esc(authorView(original.author, original.isAnonymous).displayName) +
                      "</div>"
                    : "") +
                  "<p>" +
                  (rep.quoteTake ? "Quote Repost" : "Repost") +
                  "</p></article>"
                );
              })
              .join("");
    } else if (tab === "likes" || tab === "bookmarks") {
      body = stateHtml("empty", {
        title: tab === "likes" ? "Likes are private" : "Read Later is private",
        text: "Your own likes and bookmarks appear on your own profile after sign-in. Other people's likes and saved posts are never shown to you.",
      });
    }
    var pinned = opinions[0] || null;
    return (
      '<section class="profile">' +
      '<div class="profile-head"><span class="avatar avatar--large" aria-hidden="true">' +
      esc(initialsFor(author.displayName)) +
      "</span>" +
      "<div><h1>" +
      esc(author.displayName) +
      "</h1><p>@ " +
      esc(author.handle) +
      "</p>" +
      "<p>320 Following · 12.4K Followers · " +
      opinions.length +
      " Opinions</p>" +
      '<button type="button" class="button button--small" data-action="follow" data-author="' +
      esc(id) +
      '">' +
      (followed ? "Following ✓" : "Follow") +
      "</button></div></div>" +
      '<p class="note">Initials-only avatar. No cover photo and no photo upload — text only, by design.</p>' +
      (pinned
        ? '<section aria-label="Pinned post"><h2>Pinned</h2>' +
          opinionCardHtml(pinned, {}) +
          "</section>"
        : "") +
      '<div class="tabs" role="tablist" aria-label="Profile sections">' +
      ["opinions", "replies", "reposts", "likes", "bookmarks"]
        .map(function (t) {
          var label = t.charAt(0).toUpperCase() + t.slice(1);
          return (
            '<a role="tab" aria-selected="' +
            (t === tab ? "true" : "false") +
            '" class="tab' +
            (t === tab ? " is-active" : "") +
            '" href="#/profile/' +
            esc(id) +
            "?tab=" +
            t +
            '">' +
            label +
            "</a>"
          );
        })
        .join("") +
      "</div>" +
      body +
      "</section>"
    );
  }

  function screenSettings() {
    var sub = state.query.sub || "account";
    return (
      '<section class="form-screen"><h1>Settings</h1>' +
      '<nav class="tabs" aria-label="Settings sections">' +
      '<a class="tab' +
      (sub === "account" ? " is-active" : "") +
      '" href="#/settings?sub=account">Account</a>' +
      '<a class="tab' +
      (sub === "mfa" ? " is-active" : "") +
      '" href="#/settings?sub=mfa">Two-factor authentication</a>' +
      '<a class="tab' +
      (sub === "respect" ? " is-active" : "") +
      '" href="#/settings?sub=respect">Respect Filter</a></nav>' +
      (sub === "mfa" ? mfaHtml() : sub === "respect" ? respectHtml() : accountHtml()) +
      "</section>"
    );
  }

  function accountHtml() {
    return (
      "<h2>Account</h2>" +
      '<form id="account-form" novalidate>' +
      '<label for="account-name">Display name (1–80 characters)</label>' +
      '<input id="account-name" type="text" maxlength="80" />' +
      '<label for="account-bio">Bio (1–280 characters)</label>' +
      '<textarea id="account-bio" rows="3" maxlength="280"></textarea>' +
      '<p class="field-note">Handles are not editable via the API — they come from sign-up. No photo upload exists here.</p>' +
      '<button class="button" type="submit">Save profile</button>' +
      '<p id="account-error" class="form-error" role="alert"></p>' +
      '<p id="account-success" class="form-success" role="status"></p></form>' +
      '<form id="password-form" novalidate><h2>Change password</h2>' +
      '<label for="new-password">New password (8–128 characters)</label>' +
      '<input id="new-password" type="password" autocomplete="new-password" required minlength="8" />' +
      '<button class="button" type="submit">Change password</button>' +
      '<p id="password-error" class="form-error" role="alert"></p>' +
      '<p id="password-success" class="form-success" role="status"></p></form>' +
      "<h2>Delete account</h2>" +
      '<p class="note">Account deletion is a sensitive action. With two-factor authentication on, it needs a verified second factor. ' +
      "Full deletion of the auth account is a server-only admin step (it needs a key that is never in this app), so this button checks the gate and reports that boundary honestly instead of pretending the account was deleted.</p>" +
      '<button class="button button--danger" type="button" data-action="delete-account">Delete my account</button>'
    );
  }

  function mfaHtml() {
    if (!state.token) {
      return (
        "<h2>Two-factor authentication (authenticator app only)</h2>" +
        stateHtml("empty", {
          title: "Sign in to manage two-factor authentication",
          text: "MFA settings belong to your signed-in account only.",
          action: { href: "#/signin", label: "Sign in" },
        })
      );
    }
    var enrollment = state.mfaEnrollment;
    var qrHtml = "";
    if (enrollment) {
      var qrSvg = safeSvg(enrollment.qrCode);
      if (qrSvg !== null) {
        qrHtml =
          '<div class="qr-code" aria-label="QR code for your authenticator app">' +
          qrSvg +
          "</div>";
      } else if (enrollment.qrCode && enrollment.qrCode.indexOf("data:image") === 0) {
        qrHtml =
          '<img class="qr-code" alt="QR code for your authenticator app" src="' +
          esc(enrollment.qrCode) +
          '" />';
      }
      qrHtml +=
        "<p><strong>Manual secret (shown once — copy it now, it is not shown again):</strong> <code>" +
        esc(enrollment.secret) +
        "</code></p>" +
        '<p class="field-note">After you verify a code below, this secret is discarded from the page. It is never stored in sessionStorage or logged.</p>';
    }
    var factorsHtml = "";
    if (state.mfaFactors) {
      factorsHtml =
        state.mfaFactors.length === 0
          ? "<p>No two-factor factors enrolled.</p>"
          : "<ul>" +
            state.mfaFactors
              .map(function (f) {
                return (
                  "<li>" +
                  esc(f.friendlyName || f.id) +
                  " · " +
                  esc(f.factorType) +
                  " · " +
                  esc(f.status) +
                  ' <button type="button" data-action="mfa-unenroll" data-factor="' +
                  esc(f.id) +
                  '">Turn off</button></li>'
                );
              })
              .join("") +
            "</ul>";
    }
    return (
      "<h2>Two-factor authentication (authenticator app only)</h2>" +
      "<ol><li>Open an authenticator app (for example Google Authenticator or Authy).</li>" +
      "<li>Scan the QR code, or enter the secret manually.</li>" +
      "<li>Enter the 6-digit code from the app to finish setup. SMS codes are never used — TOTP only, so setup stays free.</li></ol>" +
      '<button class="button" type="button" data-action="mfa-enroll">Start two-factor setup</button> ' +
      '<button class="button button--secondary" type="button" data-action="mfa-list">Show my factors</button>' +
      (factorsHtml ? "<h3>Your factors</h3>" + factorsHtml : "") +
      (enrollment ? "<h3>Scan and verify</h3>" + qrHtml : "") +
      '<form id="mfa-verify-form" novalidate>' +
      '<label for="mfa-code">6-digit code from your authenticator app</label>' +
      '<input id="mfa-code" name="code" type="text" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required />' +
      '<button class="button" type="submit">Verify code</button>' +
      '<p id="mfa-error" class="form-error" role="alert"></p>' +
      '<p id="mfa-success" class="form-success" role="status"></p></form>' +
      '<p class="note">Lost your device? Recovery is unenrolling from a signed-in session, or admin unenroll in the Supabase dashboard. ' +
      "There are no backup codes in Supabase MFA, and this app invents none.</p>"
    );
  }

  function respectHtml() {
    var words =
      state.mutedWords.length === 0
        ? "<p>No muted words yet.</p>"
        : "<ul>" +
          state.mutedWords
            .map(function (w) {
              return (
                "<li>" +
                esc(w) +
                ' <button type="button" data-action="unmute-word" data-word="' +
                esc(w) +
                '">Remove</button></li>'
              );
            })
            .join("") +
          "</ul>";
    var topics =
      state.mutedTopics.length === 0
        ? "<p>No muted topics yet.</p>"
        : "<ul>" +
          state.mutedTopics
            .map(function (t) {
              return (
                "<li>" +
                esc(t) +
                ' <button type="button" data-action="unmute-topic" data-topic="' +
                esc(t) +
                '">Remove</button></li>'
              );
            })
            .join("") +
          "</ul>";
    return (
      "<h2>Respect Filter</h2>" +
      '<form id="mute-word-form"><label for="mute-word-input">Mute a word (1–50 characters)</label>' +
      '<input id="mute-word-input" type="text" maxlength="50" required />' +
      '<button class="button" type="submit">Mute word</button></form>' +
      "<h3>Muted words</h3>" +
      words +
      "<h3>Muted topics</h3>" +
      topics +
      "<h3>Blocked authors</h3>" +
      (state.blockedAuthors.length === 0
        ? "<p>No blocked authors.</p>"
        : "<ul>" +
          state.blockedAuthors
            .map(function (b) {
              return (
                '<li>Blocked author <button type="button" data-action="unblock" data-author="' +
                esc(b) +
                '">Unblock</button></li>'
              );
            })
            .join("") +
          "</ul>") +
      '<button class="button button--secondary" type="button" data-action="undo-hide">Restore all hidden, muted, and blocked content</button>' +
      '<p class="note">Report, Mute topic, and Block author are on every post\'s More menu. Everything here can be undone.</p>'
    );
  }

  /* ---------------- router ---------------- */

  function parseHash() {
    var raw = window.location.hash.replace(/^#/, "");
    var parts = raw.split("?");
    var path = (parts[0] || "/welcome").replace(/^\//, "");
    var segments = path.split("/").filter(Boolean);
    var query = {};
    if (parts[1]) {
      new URLSearchParams(parts[1]).forEach(function (v, k) {
        query[k] = v;
      });
    }
    return { segments: segments, query: query };
  }

  async function route() {
    var parsed = parseHash();
    var segments = parsed.segments;
    state.query = parsed.query;
    state.route = segments[0] || "welcome";
    state.param = segments[1] ? decodeURIComponent(segments[1]) : null;
    // The banner copy is route-aware (sample-opinions line only on
    // screens that show sample opinions), so it must re-render on
    // every navigation, not just on boot.
    renderModeBanner();
    if (state.route === "feed") {
      state.tab = parsed.query.tab || "for-you";
      if (parsed.query.topic) {
        var topic = parsed.query.topic;
        if (isLive()) {
          setMain(stateHtml("loading"));
          await loadLiveFeed("topic:" + topic, topic);
          var topicList = visibleOpinions(state.liveFeedItems || []);
          setMain(
            "<h1>Topic: " +
              esc(topic) +
              "</h1>" +
              (state.liveFeedError === "auth"
                ? stateHtml("empty", {
                    title: "Sign in required",
                    text: "Your session expired. Sign in again.",
                    action: { href: "#/signin", label: "Sign in" },
                  })
                : topicList.length === 0
                  ? stateHtml("empty", {
                      title: "No opinions on this topic yet",
                      text: "Try another topic, or write the first opinion.",
                    })
                  : topicList
                      .map(function (o) {
                        return opinionCardHtml(o, {});
                      })
                      .join("") + loadMoreHtml()),
          );
          state.skipLiveRefetch = false;
          bindForms();
          return;
        }
        var list = visibleOpinions(SAMPLE_OPINIONS).filter(function (o) {
          return o.topic === topic;
        });
        setMain(
          "<h1>Topic: " +
            esc(topic) +
            "</h1>" +
            (list.length === 0
              ? stateHtml("empty", {
                  title: "No opinions on this topic yet",
                  text: "Try another topic, or write the first opinion.",
                })
              : list
                  .map(function (o) {
                    return opinionCardHtml(o, {});
                  })
                  .join("")),
        );
        return;
      }
    }
    if (state.route === "profile") state.profileTab = parsed.query.tab || "opinions";
    // Live-list loading: fetch before rendering, so a signed-in
    // user never sees sample data presented as live. The loading
    // state is shown while fetching; on 503 the loader flips the
    // mode to preview and the sample screens below render with
    // the labelled preview banner.
    if (isLive()) {
      var needsLive =
        state.route === "feed" ||
        state.route === "explore" ||
        state.route === "debates" ||
        state.route === "notifications" ||
        state.route === "profile" ||
        state.route === "post";
      if (needsLive) setMain(stateHtml("loading"));
      if (state.route === "feed") {
        await loadLiveDaily();
        await loadLiveFeed("feed:" + state.tab);
      } else if (state.route === "explore") {
        await loadLiveFeed("explore");
      } else if (state.route === "debates") {
        await loadLiveFeed("debates");
      } else if (state.route === "notifications") {
        await loadLiveNotifications();
      } else if (state.route === "profile") {
        await loadLiveProfile(state.param);
      } else if (state.route === "post") {
        await loadLivePost(state.param);
      }
      state.skipLiveRefetch = false;
    }
    var html = "";
    if (state.route === "welcome") html = screenWelcome();
    else if (state.route === "signin") html = screenSignIn();
    else if (state.route === "onboarding") html = screenOnboarding();
    else if (state.route === "feed") html = screenFeed();
    else if (state.route === "compose") html = screenCompose();
    else if (state.route === "post") html = screenPost();
    else if (state.route === "explore") html = screenExplore();
    else if (state.route === "debates") html = screenDebates();
    else if (state.route === "notifications") html = screenNotifications();
    else if (state.route === "profile") html = screenProfile();
    else if (state.route === "settings") html = screenSettings();
    else
      html = stateHtml("error", {
        text: "That page does not exist. Use the navigation above.",
      });
    setMain(html);
    bindForms();
    var main = document.getElementById("main");
    if (main) main.focus({ preventScroll: true });
  }

  function bindCounter(textareaId, counterId) {
    var ta = document.getElementById(textareaId);
    var counter = document.getElementById(counterId);
    if (!ta || !counter) return;
    var update = function () {
      counter.textContent = ta.value.length + "/280";
    };
    ta.addEventListener("input", update);
    update();
  }

  function bindForms() {
    bindCounter("compose-body", "compose-count");
    bindCounter("reply-body", "reply-count");

    var signin = document.getElementById("signin-form");
    if (signin) {
      signin.addEventListener("submit", async function (e) {
        e.preventDefault();
        var email = document.getElementById("signin-email").value.trim();
        var password = document.getElementById("signin-password").value;
        var err = document.getElementById("signin-error");
        var ok = document.getElementById("signin-success");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          err.textContent = "Enter a valid email address.";
          return;
        }
        if (password.length < 8 || password.length > 128) {
          err.textContent = "Password must be 8–128 characters.";
          return;
        }
        err.textContent = "";
        if (ok) ok.textContent = "";
        try {
          var path = state.authMode === "signup" ? "/auth/signup" : "/auth/signin";
          var data = await api(path, {
            method: "POST",
            body: { email: email, password: password },
          });
          if (state.authMode === "signup") {
            if (data && data.session) {
              saveSession(data.session);
              showToast("Account created. Welcome to Opiinio.");
              window.location.hash = "#/feed";
            } else {
              if (ok)
                ok.textContent =
                  "Account created. Check your email for the confirmation link, then sign in.";
            }
            return;
          }
          if (data && data.session) saveSession(data.session);
          // Step-up check: a verified factor + aal1 session needs
          // a code before the session can do sensitive actions.
          try {
            var sessionData = await api("/auth/session");
            var factorsData = await api("/auth/mfa/factors");
            var hasVerified = (factorsData.items || []).some(function (f) {
              return f.factorType === "totp" && f.status === "verified";
            });
            if (hasVerified && sessionData && sessionData.aal !== "aal2") {
              var challengeData = await api("/auth/mfa/challenge", {
                method: "POST",
                body: {
                  factor_id: (factorsData.items || []).find(function (f) {
                    return f.factorType === "totp" && f.status === "verified";
                  }).id,
                },
              });
              state.pendingMfa = {
                factorId: (factorsData.items || []).find(function (f) {
                  return f.factorType === "totp" && f.status === "verified";
                }).id,
                challengeId: challengeData.challengeId,
              };
              route();
              return;
            }
          } catch (stepErr) {
            // A failed step-up check must not turn a valid sign-in
            // into a fake failure: fall through to the feed, where
            // sensitive actions will re-check aal on the server.
          }
          showToast("Signed in. Welcome back.");
          window.location.hash = "#/feed";
        } catch (err2) {
          err.textContent =
            err2.status === 401
              ? "Invalid email or password."
              : err2.status === 503
                ? "Auth service unavailable. Check back shortly — no account was changed."
                : "Could not sign in. Check your details and try again.";
        }
      });
    }

    var resetForm = document.getElementById("reset-form");
    if (resetForm) {
      resetForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var email = document.getElementById("reset-email").value.trim();
        var ok = document.getElementById("reset-success");
        var err = document.getElementById("reset-error");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          err.textContent = "Enter a valid email address.";
          return;
        }
        err.textContent = "";
        try {
          await api("/auth/reset", { method: "POST", body: { email: email } });
        } catch (e2) {
          // Reset is deliberately oracle-free: the message is the
          // same whether or not an account exists for this email.
        }
        if (ok)
          ok.textContent = "If an account exists for that email, a reset link was sent.";
      });
    }

    var mfaChallengeForm = document.getElementById("mfa-challenge-form");
    if (mfaChallengeForm) {
      mfaChallengeForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var code = document.getElementById("mfa-challenge-code").value.trim();
        var err = document.getElementById("mfa-challenge-error");
        if (!/^\d{6}$/.test(code)) {
          err.textContent = "Code must be exactly 6 digits.";
          return;
        }
        try {
          var data = await api("/auth/mfa/verify", {
            method: "POST",
            body: {
              factor_id: state.pendingMfa.factorId,
              challenge_id: state.pendingMfa.challengeId,
              code: code,
            },
          });
          if (data && data.session) saveSession(data.session);
          state.pendingMfa = null;
          showToast("Two-factor verified. Signed in.");
          window.location.hash = "#/feed";
        } catch (err2) {
          err.textContent =
            err2.status === 401
              ? "Sign in required to verify a code."
              : "Invalid code. Try the current code from your authenticator app.";
        }
      });
    }

    var onboarding = document.getElementById("onboarding-form");
    if (onboarding) {
      onboarding.addEventListener("submit", function (e) {
        e.preventDefault();
        window.location.hash = "#/feed";
      });
    }

    var compose = document.getElementById("compose-form");
    if (compose) {
      compose.addEventListener("submit", async function (e) {
        e.preventDefault();
        var body = document.getElementById("compose-body").value.trim();
        var errEl = document.getElementById("compose-error");
        var okEl = document.getElementById("compose-success");
        if (body.length < 1 || body.length > 280) {
          errEl.textContent = "Text must be 1–280 characters.";
          okEl.textContent = "";
          return;
        }
        if (state.query.report) {
          if (!isPreview()) {
            try {
              await api("/reports", {
                method: "POST",
                body: { opinion_id: state.query.report, reason: body },
              });
              okEl.textContent = "Report submitted. Thank you.";
            } catch (err) {
              errEl.textContent =
                err.status === 401
                  ? "Sign in required to report."
                  : "Could not submit your report.";
            }
            return;
          }
          okEl.textContent =
            "Preview only — this report was NOT submitted. Reporting is not live until sign-in is enabled.";
          errEl.textContent = "";
          return;
        }
        var pollOptions = Array.from(document.querySelectorAll('input[name="poll"]'))
          .map(function (i) {
            return i.value.trim();
          })
          .filter(Boolean);
        if (pollOptions.length === 1) {
          errEl.textContent = "A poll needs 2–6 options, or none at all.";
          return;
        }
        if (pollOptions.length > 6) {
          errEl.textContent = "A poll can have at most 6 options.";
          return;
        }
        var topic = document.getElementById("compose-topic")
          ? document.getElementById("compose-topic").value
          : "Work";
        var anon = document.getElementById("compose-anon")
          ? document.getElementById("compose-anon").checked
          : false;
        if (!isPreview()) {
          try {
            var created = await api("/opinions", {
              method: "POST",
              body: { body: body, topic: topic, is_anonymous: anon },
            });
            if (pollOptions.length >= 2 && created && created.id) {
              try {
                await api("/opinions/" + created.id + "/polls", {
                  method: "POST",
                  body: { options: pollOptions },
                });
                okEl.textContent = "Opinion posted with poll.";
              } catch (pollErr) {
                okEl.textContent =
                  "Opinion posted, but the poll could not be created. You can add a poll from the post page in live mode.";
              }
            } else {
              okEl.textContent = "Opinion posted.";
            }
          } catch (err) {
            errEl.textContent =
              err.status === 401
                ? "Sign in required to post."
                : "Could not post your opinion.";
          }
          return;
        }
        okEl.textContent =
          "Preview only — this opinion was NOT posted to Opiinio. It is shown below as a preview, not in the feed.";
        errEl.textContent = "";
        var previewCard = document.createElement("div");
        previewCard.className = "card";
        previewCard.innerHTML =
          '<p class="badge badge--preview">Preview — not posted</p><p class="card-text">' +
          esc(body) +
          "</p>" +
          "<p>Topic: " +
          esc(topic) +
          (anon ? " · Anonymous" : "") +
          (pollOptions.length ? " · Poll: " + esc(pollOptions.join(", ")) : "") +
          "</p>";
        compose.parentNode.insertBefore(previewCard, compose.nextSibling);
      });
    }

    var replyForm = document.getElementById("reply-form");
    if (replyForm) {
      replyForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var body = document.getElementById("reply-body").value.trim();
        var errEl = document.getElementById("reply-error");
        var okEl = document.getElementById("reply-success");
        if (body.length < 1 || body.length > 280) {
          errEl.textContent = "Reply must be 1–280 characters.";
          okEl.textContent = "";
          return;
        }
        if (!isPreview()) {
          try {
            await api("/opinions/" + state.param + "/replies", {
              method: "POST",
              body: {
                body: body,
                side: document.getElementById("reply-side-input").value,
              },
            });
            okEl.textContent = "Reply posted.";
          } catch (err) {
            errEl.textContent =
              err.status === 401
                ? "Sign in required to reply."
                : "Could not post your reply.";
          }
          return;
        }
        okEl.textContent =
          "Preview only — this reply was NOT posted. Replies are not live until sign-in is enabled.";
        errEl.textContent = "";
      });
    }

    var searchForm = document.getElementById("search-form");
    if (searchForm) {
      searchForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var q = document.getElementById("search-q").value.trim();
        var out = document.getElementById("search-results");
        if (!out) return;
        if (q.length === 0 || q.length > 100) {
          out.innerHTML =
            '<p class="form-error" role="alert">Search must be 1–100 characters.</p>';
          return;
        }
        if (isLive()) {
          try {
            var sdata = await liveFetch(
              "/opinions?search=" + encodeURIComponent(q) + "&limit=20",
            );
            var shits = dedupeById((sdata.items || []).map(toLiveOpinion));
            out.innerHTML =
              "<h2>Search results for “" +
              esc(q) +
              "”</h2>" +
              (shits.length === 0
                ? stateHtml("empty", {
                    title: "No opinions matched",
                    text: "Try different words, or browse a topic.",
                  })
                : shits
                    .map(function (o) {
                      return opinionCardHtml(o, {});
                    })
                    .join(""));
          } catch (serr) {
            if (serr.authRequired) {
              clearSession();
              out.innerHTML = stateHtml("empty", {
                title: "Sign in required",
                text: "Your session expired. Sign in again to search live posts.",
                action: { href: "#/signin", label: "Sign in" },
              });
            } else if (serr.previewFallback) {
              out.innerHTML =
                '<p class="note">Live search is unavailable — showing preview results below.</p>';
              var phits = visibleOpinions(SAMPLE_OPINIONS).filter(function (o) {
                return o.body.toLowerCase().indexOf(q.toLowerCase()) !== -1;
              });
              out.innerHTML +=
                "<h2>Search results for “" +
                esc(q) +
                "” (preview)</h2>" +
                (phits.length === 0
                  ? stateHtml("empty", {
                      title: "No opinions matched",
                      text: "Try different words, or browse a topic.",
                    })
                  : phits
                      .map(function (o) {
                        return opinionCardHtml(o, {});
                      })
                      .join(""));
            } else {
              out.innerHTML = stateHtml("error", {
                text: "Search could not be completed. Try again.",
              });
            }
          }
          return;
        }
        var hits = visibleOpinions(SAMPLE_OPINIONS).filter(function (o) {
          return o.body.toLowerCase().indexOf(q.toLowerCase()) !== -1;
        });
        out.innerHTML =
          "<h2>Search results for “" +
          esc(q) +
          "”</h2>" +
          (hits.length === 0
            ? stateHtml("empty", {
                title: "No opinions matched",
                text: "Try different words, or browse a topic.",
              })
            : hits
                .map(function (o) {
                  return opinionCardHtml(o, {});
                })
                .join(""));
      });
    }

    var sortSel = document.getElementById("reply-sort");
    if (sortSel)
      sortSel.addEventListener("change", function () {
        state.replySort = sortSel.value;
        route();
      });
    var sideSel = document.getElementById("reply-side");
    if (sideSel)
      sideSel.addEventListener("change", function () {
        state.replySideFilter = sideSel.value;
        route();
      });

    var muteForm = document.getElementById("mute-word-form");
    if (muteForm) {
      muteForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var word = document.getElementById("mute-word-input").value.trim();
        if (word.length < 1 || word.length > 50) {
          showToast("Muted word must be 1–50 characters.");
          return;
        }
        if (state.mutedWords.indexOf(word) === -1) state.mutedWords.push(word);
        showToast(
          "Word muted. Posts containing it are hidden. Undo it here in Settings.",
        );
        route();
      });
    }

    var accountForm = document.getElementById("account-form");
    if (accountForm) {
      accountForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = document.getElementById("account-name").value.trim();
        var bio = document.getElementById("account-bio").value.trim();
        var errEl = document.getElementById("account-error");
        var okEl = document.getElementById("account-success");
        if (name.length > 80) {
          errEl.textContent = "Display name must be at most 80 characters.";
          return;
        }
        if (bio.length > 280) {
          errEl.textContent = "Bio must be at most 280 characters.";
          return;
        }
        errEl.textContent = "";
        okEl.textContent =
          "Preview only — profile changes are not saved until sign-in is live.";
      });
    }

    var passwordForm = document.getElementById("password-form");
    if (passwordForm) {
      passwordForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var password = document.getElementById("new-password").value;
        var errEl = document.getElementById("password-error");
        var okEl = document.getElementById("password-success");
        if (password.length < 8 || password.length > 128) {
          errEl.textContent = "Password must be 8–128 characters.";
          return;
        }
        errEl.textContent = "";
        if (!state.token) {
          errEl.textContent = "Sign in required to change your password.";
          return;
        }
        try {
          await api("/auth/password", {
            method: "PATCH",
            body: { password: password },
          });
          okEl.textContent = "Password changed.";
        } catch (err2) {
          errEl.textContent =
            err2.status === 401
              ? "Sign in required to change your password."
              : err2.status === 403
                ? "Verify your second factor first, then try again."
                : "Could not change your password.";
        }
      });
    }

    var mfaForm = document.getElementById("mfa-verify-form");
    if (mfaForm) {
      mfaForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var code = document.getElementById("mfa-code").value.trim();
        var errEl = document.getElementById("mfa-error");
        var okEl = document.getElementById("mfa-success");
        if (!/^\d{6}$/.test(code)) {
          errEl.textContent = "Code must be exactly 6 digits.";
          return;
        }
        if (!state.token) {
          errEl.textContent = "Sign in required to verify a code.";
          return;
        }
        if (!state.mfaEnrollment) {
          errEl.textContent =
            "Start two-factor setup first, then enter the code from your authenticator app.";
          return;
        }
        errEl.textContent = "";
        try {
          var data = await api("/auth/mfa/verify", {
            method: "POST",
            body: {
              factor_id: state.mfaEnrollment.factorId,
              challenge_id: state.mfaEnrollment.challengeId,
              code: code,
            },
          });
          // Secret + QR are discarded after verification — never
          // stored, never shown again.
          state.mfaEnrollment = null;
          if (data && data.session) saveSession(data.session);
          if (okEl) okEl.textContent = "Two-factor authentication is on.";
          route();
        } catch (err2) {
          errEl.textContent =
            err2.status === 401
              ? "Sign in required to verify a code."
              : "Invalid code. Try the current code from your authenticator app.";
        }
      });
    }
  }

  /* ---------------- global events + boot ---------------- */

  document.addEventListener("click", function (e) {
    var target = e.target.closest("[data-action]");
    if (!target) return;
    var action = target.getAttribute("data-action");
    if (action === "debate-toggle") {
      state.debateMode = !state.debateMode;
      route();
      return;
    }
    if (action === "auth-toggle") {
      state.authMode = state.authMode === "signup" ? "signin" : "signup";
      route();
      return;
    }
    if (action === "google-signin") {
      (async function () {
        try {
          var data = await api("/auth/google");
          if (data && data.url) {
            window.location.href = data.url;
          } else {
            showToast("Google sign-in could not be started.");
          }
        } catch (err) {
          showToast(
            err.status === 503
              ? "Auth service unavailable. Google sign-in cannot start right now."
              : "Google sign-in could not be started. The Google provider may not be enabled yet.",
          );
        }
      })();
      return;
    }
    if (action === "delete-account") {
      if (!state.token) {
        showToast("Sign in required to delete an account.");
        return;
      }
      if (
        !window.confirm(
          "Delete your account? This step checks the server gate; full auth-account deletion is a server-only admin step and will be reported honestly, not pretended.",
        )
      ) {
        return;
      }
      (async function () {
        try {
          await api("/auth/account", { method: "DELETE" });
          showToast("Account deletion completed.");
          clearSession();
          window.location.hash = "#/welcome";
        } catch (err) {
          if (err.code === "SERVER_ONLY") {
            showToast(
              "Account deletion needs an admin step: the server gate passed, but the auth account itself is not deleted by this route (it needs a key that is never in this app).",
            );
          } else if (err.status === 403) {
            showToast("Verify your second factor first, then try again.");
          } else if (err.status === 401) {
            showToast("Sign in required to delete an account.");
          } else {
            showToast("Could not delete your account.");
          }
        }
      })();
      return;
    }
    if (action === "mfa-enroll") {
      if (!state.token) {
        showToast("Sign in required to set up two-factor authentication.");
        return;
      }
      (async function () {
        try {
          var enrollment = await api("/auth/mfa/enroll", {
            method: "POST",
            body: { friendly_name: "Opiinio authenticator" },
          });
          var challenge = await api("/auth/mfa/challenge", {
            method: "POST",
            body: { factor_id: enrollment.factorId },
          });
          state.mfaEnrollment = {
            factorId: enrollment.factorId,
            qrCode: enrollment.qrCode,
            secret: enrollment.secret,
            uri: enrollment.uri,
            challengeId: challenge.challengeId,
          };
          route();
        } catch (err) {
          showToast(
            err.status === 401
              ? "Sign in required to set up two-factor authentication."
              : "Could not start two-factor setup.",
          );
        }
      })();
      return;
    }
    if (action === "mfa-list") {
      if (!state.token) {
        showToast("Sign in required to list your factors.");
        return;
      }
      (async function () {
        try {
          var data = await api("/auth/mfa/factors");
          state.mfaFactors = data.items || [];
          route();
        } catch (err) {
          showToast("Could not list your factors.");
        }
      })();
      return;
    }
    if (action === "mfa-unenroll") {
      if (!state.token) {
        showToast("Sign in required to turn off two-factor authentication.");
        return;
      }
      (async function () {
        try {
          var factorId = target.getAttribute("data-factor");
          if (!factorId) {
            var data = await api("/auth/mfa/factors");
            var verified = (data.items || []).find(function (f) {
              return f.factorType === "totp" && f.status === "verified";
            });
            factorId = verified ? verified.id : null;
          }
          if (!factorId) {
            showToast("No verified two-factor factor to turn off.");
            return;
          }
          await api("/auth/mfa/factors/" + factorId, { method: "DELETE" });
          state.mfaFactors = null;
          showToast("Two-factor authentication turned off.");
          route();
        } catch (err) {
          showToast(
            err.status === 403
              ? "Verify your second factor first, then try again."
              : "Could not turn off two-factor authentication.",
          );
        }
      })();
      return;
    }
    if (action === "unmute-word") {
      var w = target.getAttribute("data-word");
      state.mutedWords = state.mutedWords.filter(function (x) {
        return x !== w;
      });
      route();
      return;
    }
    if (action === "unmute-topic") {
      var t = target.getAttribute("data-topic");
      state.mutedTopics = state.mutedTopics.filter(function (x) {
        return x !== t;
      });
      route();
      return;
    }
    if (action === "unblock") {
      var a = target.getAttribute("data-author");
      state.blockedAuthors = state.blockedAuthors.filter(function (x) {
        return x !== a;
      });
      route();
      return;
    }
    if (action === "reply-like") {
      if (isPreview()) {
        showToast("Preview only — reply likes are local in preview and are not saved.");
        return;
      }
      // Live mode (Layer 11 fix): call the live like endpoint.
      // The endpoint returns 204 with no body, so the count is
      // refreshed from the server by re-rendering (route()
      // refetches the post) — never adjusted locally from a
      // guessed count. On failure, toast the generic error and
      // still re-render so the displayed state stays server-true.
      var replyId = target.getAttribute("data-reply");
      var liveReply = (state.livePostReplies || []).find(function (r) {
        return r && r.id === replyId;
      });
      (async function () {
        try {
          await api("/replies/" + replyId + "/like", {
            method: liveReply && liveReply.ownLiked ? "DELETE" : "POST",
          });
        } catch (err) {
          showToast(
            err.status === 401
              ? "Sign in required to like."
              : "Could not save your like.",
          );
        }
        route();
      })();
      return;
    }
    handleAction(e);
  });

  var langBtn = document.getElementById("lang-toggle");
  if (langBtn) {
    langBtn.addEventListener("click", function () {
      state.lang = state.lang === "en" ? "hi" : "en";
      applyLang();
      showToast(
        state.lang === "hi"
          ? "Interface language: Hindi. Posts are not translated."
          : "Interface language: English. Posts are not translated.",
      );
    });
  }

  window.addEventListener("hashchange", route);

  (async function boot() {
    loadSession();
    consumeAuthHash();
    await detectMode();
    await validateStoredSession();
    renderModeBanner();
    applyLang();
    route();
  })();
})();
