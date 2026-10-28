# 0004 — No media storage in V1

- Context: Product rule is text-only, 280 characters, no photo/video/
  media upload anywhere. User confirmed profile photos NOT allowed
  at launch (initials only, ₹0, add later after revenue).
- Decision: No upload, pre-signed-URL, or storage layer in V1. The
  skill's file-storage section is deferred, not silently skipped.
- Alternatives considered: Allow profile photos at launch (rejected
  for V1: needs storage, moderation, and a cost decision the user has
  not made; earlier estimate: Supabase free gives 1 GB file storage,
  so photos would be free at first but paid after the limit).
- Consequences: Zero file-storage cost and zero media moderation
  surface in V1. Adding photos later is a new layer with its own
  decision record.
