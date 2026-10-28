# 0001 — Modular monolith, not microservices

- Context: Solo build, ₹0 launch, one developer. The skill prefers a
  modular monolith for a solo/small team.
- Decision: One deployable Node + TypeScript app; modules separated by
  folder (`routes/` thin handlers, `services/` business logic).
- Alternatives considered: Microservices (rejected: more deploys, more
  inter-service auth, more ops for no V1 benefit); serverless functions
  only (rejected: harder to reason about a single request end-to-end
  at this stage).
- Consequences: Easier debugging, one log stream, one deploy. Split
  only later, with a new decision record, if a module demonstrably
  needs independent scaling.
