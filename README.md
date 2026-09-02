# Latch

Latch is a private launch surface for self-hosted web services. This repository is the thin Cloudflare deployment template; the application runtime is delivered by the public npm package `@phyzess/latch`.

## Repository Model

Latch is split across three repository roles:

- `phyzess/latch-core` is the runtime source. UI, Worker behavior, CLI behavior, config validation, and tests belong there.
- `phyzess/latch` is this reusable deployment template. It should contain only generic Cloudflare deployment files and example configuration.
- Deployment instances are repositories created from this template, often named after the deployed Worker. They keep instance configuration such as Worker name, KV namespace bindings, admin emails, secrets in Cloudflare, and the pinned `@phyzess/latch` runtime version.

After Cloudflare imports this template, keep production-specific changes in the generated deployment instance. Application runtime changes belong in `phyzess/latch-core` and are released through `@phyzess/latch`.

## Deploy to Cloudflare

Latch supports two authentication modes:

- **Built-in Latch login (recommended)** — a password-protected, long-lived session cookie handled entirely by this Worker. It does not depend on Cloudflare Access, email OTP, or any external identity provider.
- **Cloudflare Access login** — if you already use Cloudflare Access, keep it in front of the Worker and configure `POLICY_AUD`/`TEAM_DOMAIN`. Latch validates the Access JWT and falls back to the built-in login page when no Access JWT is present.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/phyzess/latch)

The deploy flow clones this template into your GitHub or GitLab account, installs `@phyzess/latch`, builds the packaged static assets, deploys the Worker, and provisions the `LATCH_CONFIG` Workers KV namespace from `wrangler.jsonc`.

Cloudflare Workers Builds reads `.node-version` for the build runtime. This template pins Node `26.1.0`.

### Option A: Built-in login (recommended)

1. In Workers & Pages > your Worker > Settings > Variables and Secrets, set these secrets:
   - `LATCH_AUTH_PASSWORD` — a strong password you want to use to sign in.
   - `LATCH_AUTH_SECRET` — a random value used to sign session cookies. Generate one with `openssl rand -base64 32`.
   - `LATCH_ADMIN_EMAILS` — comma-separated emails allowed to edit `/settings`, for example `you@example.com,ops@example.com`.
   - Optionally set `LATCH_AUTH_EMAIL` to limit login to a single email.
2. Do **not** enable Cloudflare Access for this Worker. The built-in login page will be shown on the first visit.
3. Visit `/settings`, sign in with the configured email/password, and save your service YAML.

The session cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and lasts 90 days by default. Configure `LATCH_AUTH_SESSION_TTL` (in seconds) to change that.

### Option B: Cloudflare Access

1. Enable Cloudflare Access for the deployed Worker under Workers & Pages > your Worker > Settings > Domains & Routes.
2. Use the one-click Access setup modal to copy `POLICY_AUD` and `TEAM_DOMAIN`. `TEAM_DOMAIN` may be either your Access team URL or the full `.../cdn-cgi/access/certs` URL.
3. In Workers & Pages > your Worker > Settings > Variables and Secrets, set `POLICY_AUD` and `TEAM_DOMAIN` as secrets.
4. Set `LATCH_ADMIN_EMAILS` to a comma-separated list of Cloudflare Access emails that may edit links, for example `you@example.com,ops@example.com`.
5. Visit `/settings`, sign in through Access, and save your service YAML.

Users who pass your Cloudflare Access policy can view the launcher. Only emails listed in `LATCH_ADMIN_EMAILS` can write config in `/settings`. If Access is not available, the built-in login page is served as a fallback as long as `LATCH_AUTH_PASSWORD` is configured.

## Configure Links

Production links live in the `LATCH_CONFIG` Workers KV namespace. They are edited from `/settings` and are not committed to this repository.

Example YAML:

```yaml
services:
  - id: photos
    name: Photos
    url: https://photos.example.com
    icon: image
    shortcut: "1"
```

Service URLs must use HTTPS, cannot point at private or local hosts, and should never include credentials or tokens.

## Updates

This template receives Latch runtime updates by updating the `@phyzess/latch` dependency.

- GitHub repositories created from this template include `.github/workflows/update-latch-runtime.yml`.
- That workflow checks npm every day, updates `@phyzess/latch` when a new version is available, runs `pnpm build` and `pnpm doctor`, then commits the version bump back to the repository.
- Cloudflare Workers Builds redeploys automatically when that commit is pushed to the connected production branch.
- Existing deployment instances can run the same workflow manually after a new `@phyzess/latch` version is published, or wait for the scheduled check.
- GitHub Actions must be enabled, and Actions > General > Workflow permissions must allow read and write permissions for the workflow to push the update commit.
- Dependabot remains configured as a weekly fallback PR path from `.github/dependabot.yml`.
- Renovate users can enable `renovate.json` instead if they prefer review-first dependency updates.

Your KV links and Worker secrets are not changed by dependency updates.

## Template Commands

Use these commands to check or deploy this Cloudflare template. Application runtime changes belong in `phyzess/latch-core` and are released through `@phyzess/latch`.

```sh
mise install
pnpm install
pnpm dev
pnpm build
pnpm doctor
pnpm deploy:dry
```

Local installs require `@phyzess/latch` to be available on npm.

`pnpm dev` builds the packaged Latch assets and starts Wrangler on an available local port. Open the `http://localhost:...` URL printed by Wrangler. Localhost skips both authentication modes and treats `dev@localhost` as an admin, so `/settings` can be used immediately. Links saved there use Wrangler's local KV state and do not affect production.

## Security

Production deployments must authenticate users before they reach the launcher. Choose one of:

- Enable the built-in Latch login by setting `LATCH_AUTH_PASSWORD` and `LATCH_AUTH_SECRET`. Sessions are stateless HMAC-signed cookies with a 90-day default lifetime; they are `HttpOnly`, `Secure`, and `SameSite=Lax`.
- Or place Cloudflare Access in front of the whole Latch domain and configure `POLICY_AUD`/`TEAM_DOMAIN`. The Worker validates the Cloudflare Access JWT and falls back to the built-in login page when Access is not available.

Latch never stores service passwords, tokens, cookies, or credentials.
