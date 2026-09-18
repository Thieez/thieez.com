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
or `{ "projects": [...] }`. The API selects repositories using the GitHub App
installation and its configured project topic, including private repositories.
The API response is authoritative, so removing a topic removes the project from
the index. A 404/405 uses both built-in project entries as the fallback; other
API failures remain visible as an error state. Asset download
URLs are resolved against the API origin, including when the API returns a
relative path.

The homepage subscribes to `wss://api.thieez.com/projects/v0/updates` and
refreshes the list after a signed GitHub `Repository` webhook event.

The header also supports Google login through the same OAuth flow as the
Obsidian plugin (`/auth/v0/login`). The returned access and refresh tokens are
kept in browser `localStorage`; the refresh token is exchanged automatically
when the access token expires. Configure the auth service CORS allowlist with
the deployed website origin.

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
