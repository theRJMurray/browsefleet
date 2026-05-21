# Profiles

A profile is a persistent Chrome user-data directory plus the metadata to attach it to a session. Use one any time you need login state, cookies, or cached site data to survive across sessions.

## What persists

Each profile lives at `data/profiles/<id>/`:

```
data/profiles/<id>/
├── meta.json         # { id, name, provider?, createdAt, updatedAt, lastUsedAt }
├── chrome/           # the Chrome user-data directory (--user-data-dir)
├── cookies.json      # legacy seed cookies (advisory)
└── localStorage.json # legacy seed local storage (advisory)
```

Chrome itself manages everything that matters: cookies, localStorage, IndexedDB, service workers, the password manager (if you log in inside the session), and the cache. The `cookies.json` and `localStorage.json` files are advisory seeds left from older versions and not authoritative.

The `meta.json` file is BrowseFleet's lightweight tracking. The `chrome/` directory is the durable state.

## Creating a profile

```bash
curl -X POST localhost:3000/v1/profiles \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-vendor-profile"}'
```

Response:

```json
{
  "id": "76affe61-...",
  "name": "my-vendor-profile",
  "createdAt": "2026-05-21T20:30:00.000Z",
  "updatedAt": "2026-05-21T20:30:00.000Z"
}
```

`name` is required. `provider` is optional free-form metadata (useful for tagging which vendor or service this profile is for; we do not interpret it).

## Attaching a profile to a session

```bash
curl -X POST localhost:3000/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"profileId":"76affe61-..."}'
```

Chrome boots with `--user-data-dir=data/profiles/<id>/chrome`. Every cookie set, every site logged into, every preference change writes back to that directory. The next session that attaches to the same profile sees the same state.

## Listing, fetching, deleting

```bash
curl localhost:3000/v1/profiles                # list -> { profiles: [...] }
curl localhost:3000/v1/profiles/<id>           # one  -> Profile object
curl -X DELETE localhost:3000/v1/profiles/<id> # delete
```

Delete is destructive and irreversible. The Chrome user-data directory is removed; cookies and logins are gone. The server does not currently check whether a live session has the profile attached, so release sessions first to avoid leaving Chrome holding a deleted directory.

## When to use profiles

Use a profile when:

- You log into a site at most a few times per day or week, and you want subsequent sessions to skip the login.
- You scrape an authenticated SaaS console where the login flow is hostile to automation.
- You run an agent that needs to "stay" on a site across multiple sessions (long-running research, account-level operations).

Do not use a profile when:

- The session is one-shot and unauthenticated. Profile bookkeeping is overhead with no benefit.
- You need parallel concurrent sessions on the same account. Two sessions cannot attach to the same profile simultaneously; Chrome enforces this and the second will fail to start. Use multiple profiles or one profile + sequential sessions.

## Security considerations

A profile contains live session cookies. Treat the file path the same way you treat any other secret material:

- Do not share `data/profiles/` between trust domains. If you operate multi-tenant, give each tenant their own BrowseFleet host.
- Back up `data/profiles/` with encryption at rest. Restoring an unencrypted backup grants whoever did the restore the same account access.
- Rotate profiles when the underlying account's password rotates. There is no automatic invalidation; an old profile holds a cookie until the site server-side-expires it.
- Profile auth: the `profileId` field on `POST /v1/sessions` accepts any UUID matching an existing profile. There is no per-profile access control today. If you need that, gate `POST /v1/sessions` at your reverse proxy.

## Profile lifecycle and `lastUsedAt`

Every time a session attaches to a profile, BrowseFleet stamps `lastUsedAt` on the profile's `meta.json`. Use this to find stale profiles to prune:

```bash
curl -s localhost:3000/v1/profiles | jq '.profiles[] | select(.lastUsedAt < "2025-12-01")'
```

There is no automatic GC. Pruning is the operator's responsibility.

## Operator mode + profiles

The intended pattern: an operator-mode session creates a profile and the human logs in. Subsequent agent-only sessions attach the same profile and skip the login. See [operator mode](./operator-mode.md) for the full flow.

## See also

- [API reference: profiles](./api.md), the endpoints.
- [Operator mode](./operator-mode.md), the canonical use case.
- [Architecture](./architecture.md), where profiles fit in the process model.
