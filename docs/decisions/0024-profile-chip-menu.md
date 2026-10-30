# 0024 — Profile chip dropdown (fix accidental sign-outs)

Date: 2026-10-30. Status: implemented, tests 218/218, push pending.

## Context

The user reported: after Google sign-in, the site kept showing him the
sign-in button — "behaving like demo account". The auth logs proved his
Google OAuth had SUCCEEDED at 08:14:20 (login record created, session
active with repeated 200 GET /user calls) — then a `POST /logout`
fired at 08:15:06, 46 seconds later.

Root cause: the Topbar profile chip rendered an avatar + name + a `▾`
dropdown indicator, but its `onClick` called `onSignOut` directly. It
looked like a profile menu and acted as an instant logout button — no
menu, no confirmation. The user tapped what looked like his account
menu and signed himself out.

## Decision

- The chip now opens a real dropdown menu: **My profile** (goes to
  `#/profile/:id`) and **Sign out** (the only path that calls the
  sign-out API). Tapping outside closes the menu.
- When signed out, the chip still routes to `#/signin` on tap.
- Rule going forward: **no destructive action on a single tap from a
  control that looks like a menu or navigation element.** Sign-out
  always sits behind an explicit menu item or confirmation.

## Consequences

- `Topbar` takes a new `onProfile` prop (wired in `App.tsx`).
- New test: "profile chip opens a menu — never signs out on a single
  tap" (static source assertions).
- The user's original bounce is fully explained: OAuth worked, the
  accidental tap logged him out, and his earlier email+password
  attempts had failed with 401 (wrong credentials — his account was
  created via Google, so no password exists).
