/**
 * Anonymous-author masking — the Layer 5 requirement from
 * migration 04, provided here so no endpoint invents its own.
 *
 * RLS alone does NOT anonymise: opinions have a public SELECT
 * policy, so a direct table reader can see author_id on an
 * anonymous row. Every API response that leaves the server MUST
 * pass through maskAuthor() (or maskOpinion()) when the row is
 * anonymous, and direct table reads must never be the app's read
 * path for anonymous posts.
 *
 * Masking rules:
 * - Anonymous: author_id -> null, handle/display name -> the
 *   literal "Anonymous", initials -> the generic "AN" (never
 *   derived from the real user's name — derived initials would
 *   leak identity to anyone who knows the user).
 * - Not anonymous: the author is returned unchanged.
 * - Inputs are never mutated: a new object is returned.
 * - Email is never included in a masked or unmasked public author
 *   shape; it is not a public field at all.
 */

export interface PublicAuthor {
  authorId: string | null;
  handle: string;
  displayName: string;
  /** Initials for the initials-only avatar. Generic "AN" when anonymous. */
  initials: string;
}

export interface AuthorInput {
  authorId: string | null;
  handle: string;
  displayName: string;
  initials: string;
}

export function maskAuthor(author: AuthorInput, isAnonymous: boolean): PublicAuthor {
  if (!isAnonymous) {
    return {
      authorId: author.authorId,
      handle: author.handle,
      displayName: author.displayName,
      initials: author.initials,
    };
  }
  return {
    authorId: null,
    handle: "Anonymous",
    displayName: "Anonymous",
    initials: "AN",
  };
}

/**
 * Derive initials-only avatar text from a display name, at render
 * time only. Initials are NOT stored in profiles (there is no
 * initials column in migration 01) — storing them would duplicate
 * the name and drift when the name changes.
 *
 * First letter of the first word, plus first letter of the second
 * word when there is one, upper-cased. Empty / non-letter names
 * fall back to "OP" (Opiinio), never to an email prefix.
 */
export function initialsFor(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return "OP";
  }
  const first = words[0]?.charAt(0) ?? "";
  const second = words.length > 1 ? (words[1]?.charAt(0) ?? "") : "";
  const initials = `${first}${second}`.toUpperCase();
  return initials === "" ? "OP" : initials;
}

export interface OpinionWithAuthor {
  id: string;
  body: string;
  topic: string;
  isAnonymous: boolean;
  author: AuthorInput;
}

/**
 * Mask an opinion's author when the opinion is anonymous, leaving
 * every other field untouched. Use this for every opinion returned
 * by Layer 5, without exception.
 */
export function maskOpinion(opinion: OpinionWithAuthor): {
  id: string;
  body: string;
  topic: string;
  isAnonymous: boolean;
  author: PublicAuthor;
} {
  return {
    id: opinion.id,
    body: opinion.body,
    topic: opinion.topic,
    isAnonymous: opinion.isAnonymous,
    author: maskAuthor(opinion.author, opinion.isAnonymous),
  };
}
