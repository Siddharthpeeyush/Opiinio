# 0003 — Netlify free hosting

- Context: ₹0 launch requirement.
- Decision: Netlify free for frontend hosting, HTTPS, deploy previews.
- Alternatives considered: VPS (rejected for V1: monthly cost plus
  patching/HTTPS ops); Vercel free (viable alternative, not chosen —
  Netlify matches the developer's existing sites' deploy pattern).
- Consequences: No server to patch at launch. Bandwidth alerts must
  be set in the hosting layer.
