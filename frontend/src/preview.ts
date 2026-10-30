/* Labelled preview data — shown ONLY under the preview banner, never
 * presented as real posts, users, or counts. Mirrors the sample set of
 * the previous vanilla client so behaviour stays comparable.
 */

import type { Opinion } from "./api";

function sampleOpinion(
  id: string,
  name: string,
  handle: string,
  hoursAgo: number,
  body: string,
  topics: string[],
  agree: number,
  neutral: number,
  disagree: number,
  replies: number,
  reposts: number,
  likes: number,
): Opinion {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return {
    id,
    body,
    topic: topics[0] ?? "General",
    isAnonymous: false,
    dailyQuestionId: null,
    author: { authorId: `sample-${handle}`, handle, displayName: name, initials },
    agreeCount: agree,
    neutralCount: neutral,
    disagreeCount: disagree,
    likeCount: likes,
    repostCount: reposts,
    replyCount: replies,
    ownStance: null,
    ownLiked: false,
    createdAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  };
}

export const PREVIEW_OPINIONS: Opinion[] = [
  sampleOpinion(
    "sample-1",
    "Aryan",
    "aryan",
    2,
    "I think remote work is far more productive than office work. It gives freedom, better focus and a healthier lifestyle.",
    ["Work"],
    2400,
    620,
    1100,
    320,
    186,
    412,
  ),
  sampleOpinion(
    "sample-2",
    "Meera",
    "meera",
    4,
    "College degrees are overrated now. Skills and real experience matter more.",
    ["Education"],
    1800,
    430,
    640,
    204,
    98,
    310,
  ),
  sampleOpinion(
    "sample-3",
    "Rohan",
    "rohan",
    5,
    "Social media platforms should be legally required to remove misinformation within 24 hours.",
    ["Current Affairs"],
    3100,
    900,
    2200,
    410,
    230,
    520,
  ),
];

export const PREVIEW_QUESTION = {
  id: "sample-q",
  body: "Should AI be regulated more strictly by governments?",
  date: "Oct 30, 2026",
};

export const PREVIEW_METER = { agree: 58, neutral: 14, disagree: 28 };

export function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function formatCount(n: number): string {
  if (n >= 1000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(n);
}
