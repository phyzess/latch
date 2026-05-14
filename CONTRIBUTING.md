# Contributing

This repository is the thin deployment template for Latch.

Most application changes belong in the core package repository, `phyzess/latch-core`, and are released through the public npm package `@phyzess/latch`.

Template changes should stay focused on:

- Cloudflare Deploy Button compatibility
- `wrangler.jsonc` bindings
- the Worker wrapper
- dependency update configuration
- self-hosting documentation

Before opening a template pull request:

```sh
pnpm install
pnpm build
pnpm doctor
pnpm deploy:dry
```
