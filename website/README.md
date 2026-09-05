# Goliath docs

The documentation site for `@hellohelen-ai/goliath`, built with
[Starlight](https://starlight.astro.build). It is a separate app with its own lockfile: nothing
here is in the published package (`files` in the root `package.json` lists only `dist`) or in the
example's Expo bundle (the example never imports it).

```sh
bun install
bun run dev      # http://localhost:4321/goliath/
bun run build    # static site in dist/
```

Pages are Markdown under `src/content/docs/`. The sidebar is in `astro.config.mjs`.

It deploys to GitHub Pages from `.github/workflows/docs.yml` on every push to `main`. The site
is served under `/goliath`, so internal links use that prefix. If it moves to a custom domain,
set `site` to the domain and remove `base` in `astro.config.mjs`.
