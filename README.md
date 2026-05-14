# Latch

Latch is a private launch surface for self-hosted web services. This repository is the thin Cloudflare deployment template; the application runtime is delivered by the public npm package `@phyzess/latch`.

## Deploy to Cloudflare

Important: clicking the Deploy to Cloudflare button is only the first step. Latch intentionally fails closed in production until Cloudflare Access is enabled and the Access values are configured on the Worker.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/phyzess/latch)

The deploy flow clones this template into your GitHub or GitLab account, installs `@phyzess/latch`, builds the packaged static assets, deploys the Worker, and provisions the `LATCH_CONFIG` Workers KV namespace from `wrangler.jsonc`.

Cloudflare Workers Builds reads `.node-version` for the build runtime. This template pins Node `26.1.0`.

After deployment:

1. Enable Cloudflare Access for the deployed Worker under Workers & Pages > your Worker > Settings > Domains & Routes.
2. Use the one-click Access setup modal to copy `POLICY_AUD` and `TEAM_DOMAIN`. `TEAM_DOMAIN` may be either your Access team URL or the full `.../cdn-cgi/access/certs` URL.
3. In Workers & Pages > your Worker > Settings > Variables and Secrets, set `POLICY_AUD` and `TEAM_DOMAIN` as secrets.
4. Set `LATCH_ADMIN_EMAILS` to a comma-separated list of Cloudflare Access emails that may edit links, for example `you@example.com,ops@example.com`.
5. Visit `/settings`, sign in through Access, and save your service YAML.

Users who pass your Cloudflare Access policy can view the launcher. Only emails listed in `LATCH_ADMIN_EMAILS` can write config in `/settings`.

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

`pnpm dev` builds the packaged Latch assets and starts Wrangler on an available local port. Open the `http://localhost:...` URL printed by Wrangler. Localhost skips Cloudflare Access and treats `dev@localhost` as an admin, so `/settings` can be used immediately. Links saved there use Wrangler's local KV state and do not affect production.

## Security

Production deployments must place Cloudflare Access in front of the whole Latch domain. The Worker also validates the Cloudflare Access JWT in production and fails closed if `POLICY_AUD` or `TEAM_DOMAIN` are missing.

Latch never stores service passwords, tokens, cookies, or credentials.
