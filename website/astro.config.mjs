// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";

// Served from GitHub Pages at https://hellohelen-ai.github.io/goliath. If the
// site moves to a custom domain, set `site` to it and drop `base`.
export default defineConfig({
  site: "https://hellohelen-ai.github.io",
  base: "/goliath",
  integrations: [
    starlight({
      title: "Goliath",
      description:
        "An agent harness for on-device language models. Built for Apple Foundation Models and a 4,096-token context window.",
      logo: { src: "./src/assets/logo.svg", alt: "" },
      favicon: "/favicon.svg",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/hellohelen-ai/goliath" },
        { icon: "npm", label: "npm", href: "https://www.npmjs.com/package/@hellohelen-ai/goliath" },
      ],
      editLink: { baseUrl: "https://github.com/hellohelen-ai/goliath/edit/main/website/" },
      lastUpdated: true,
      customCss: [
        "@fontsource-variable/inter",
        "@fontsource-variable/jetbrains-mono",
        "./src/styles/custom.css",
      ],
      expressiveCode: {
        themes: ["github-dark-default", "github-light-default"],
        styleOverrides: { borderRadius: "0.75rem" },
      },
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Introduction", slug: "start/introduction" },
            { label: "Installation", slug: "start/installation" },
            { label: "Your first turn", slug: "start/first-turn" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "How a turn runs", slug: "guides/how-a-turn-runs" },
            { label: "Tools", slug: "guides/tools" },
            { label: "Confirming writes", slug: "guides/confirm" },
            { label: "Memory", slug: "guides/memory" },
            { label: "Fallback to the cloud", slug: "guides/fallback" },
            { label: "Facts and examples", slug: "guides/facts-and-examples" },
            { label: "Lifecycle extensions", slug: "guides/extensions" },
            { label: "Tracing", slug: "guides/tracing" },
            { label: "Testing without a phone", slug: "guides/testing" },
            { label: "Evals", slug: "guides/evals" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "createAgent", slug: "reference/create-agent" },
            { label: "defineTool", slug: "reference/define-tool" },
            { label: "Memory adapters", slug: "reference/memory" },
            { label: "httpFallback", slug: "reference/http-fallback" },
            { label: "Results and events", slug: "reference/results" },
            { label: "Escalation reasons", slug: "reference/escalation" },
            { label: "Testing utilities", slug: "reference/testing" },
          ],
        },
        {
          label: "Design",
          items: [
            { label: "Why not a plain loop", slug: "design/why" },
            { label: "Rules Goliath follows", slug: "design/rules" },
            { label: "Research", slug: "design/research" },
          ],
        },
        {
          label: "Project",
          items: [
            { label: "Example app", slug: "project/example" },
            { label: "Contributing", slug: "project/contributing" },
            {
              label: "Changelog",
              link: "https://github.com/hellohelen-ai/goliath/blob/main/CHANGELOG.md",
              attrs: { target: "_blank" },
            },
          ],
        },
      ],
      plugins: [starlightLlmsTxt()],
    }),
  ],
});
