# 0005 — No team invites in V1

- Context: The skill's auth layer includes team invites, roles,
  ownership transfer, and leaving an organisation.
- Decision: Out of scope for V1. Opiinio accounts are personal;
  tenancy is per user_id, not per organisation.
- Alternatives considered: Building team features anyway (rejected:
  no user need stated, adds permission surface and email-invite abuse
  surface for no V1 benefit).
- Consequences: No invite/role/transfer code in V1. If teams are ever
  requested, they must be built behind the same central
  can(user, action, resource) check, with the skill's rules (last
  owner cannot leave, invites expire after 7 days, removed members
  lose access immediately).
