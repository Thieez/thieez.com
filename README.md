# Thieez site

Minimal SvelteKit site for the Thieez project index and Lisnnto download page.

## Development

```bash
npm install
npm run dev
```

Set `VITE_API_BASE` to point at a local API during development; production defaults to
`https://api.thieez.com`. The page detects `lisnnto.thieez.com` and `note.thieez.com` via
`window.location.hostname`. For local testing, use `/?project=lisnnto`.

The project index requests `GET /projects/v0`, accepting either a project array
or `{ "projects": [...] }`. The API is the only source of project visibility;
there are no built-in projects or topic-based fallback entries. A 404/405
returns an empty project list; other API failures remain visible as an error
state. Asset download
URLs are resolved against the API origin, including when the API returns a
relative path.

The homepage subscribes to `wss://api.thieez.com/projects/v0/updates` and
refreshes the list after a signed GitHub `Repository` webhook event.
It also displays live Supabase database usage from the public
`/lisnnto/v0/storage` endpoint.

The API heartbeat is a direct browser WebSocket connection to
`/uptime/v0/heartbeat`; it does not use UptimeRobot. The API sends a heartbeat
once per second, and the page reconnects if the connection is lost. While
disconnected, the graph shows an animated red flatline and reports that there
is no heartbeat.

Public page data is loaded during server rendering and kept in a per-process
cache for 60 seconds; the browser uses that result instead of immediately
requesting the same data again. The account and dashboard pages skip unrelated
public data requests, and project-update events refresh only the project list.
The rendered page is also cached at the
Vercel edge for 60 seconds, with stale responses allowed during revalidation
for up to 24 hours. The process cache itself is lost on server restart.

The header also supports Google login through the same OAuth flow as the
Obsidian plugin (`/auth/v0/login`). The website receives the OAuth callback on
its own server and stores access and refresh tokens in `HttpOnly`, `Secure`
cookies instead of browser storage. Its server refreshes the access token with
the API's rotating refresh-token endpoint and touches the API session while
the user is active; both the browser cookie and API session expire after 30
days of inactivity. The access-token cookie remains available for that
inactivity window, while its actual API expiry is tracked separately and
triggers a server-side refresh. Authenticated limits are proxied through the site server,
so tokens are never exposed to page JavaScript. The Account view also lists
access to each published project using the same server-side session. Configure
the auth service CORS allowlist with the deployed website origin.

`/alpha` starts the same Google sign-in flow and submits an access request for
the signed-in user. Pending requests are denied authenticated API access until
an administrator approves them from the access panel. Approval grants access
to all published projects and sends an email using the API's configured Resend
sender; administrators can later grant or revoke all-project access.

## Build and deploy

```bash
npm run check
npm run build
npm run preview
```

Point the apex/site host, `lisnnto.thieez.com`, and `note.thieez.com` at the
deployed SvelteKit application. After deploying this change, opening
`https://note.thieez.com` renders the Obsidian build download screen. The API must allow the site origins in its CORS policy, including the
production domains and any local development origin.
