// @ts-check
import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

import rehypeExternalLinks from "rehype-external-links";
import rehypeFigure from "rehype-figure";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  devToolbar: { enabled: false },

  integrations: [
    mermaid({
      theme: "neutral",
      autoTheme: true,
    }),
    react(),
    sitemap(),
  ],

  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      wrap: true,
    },
    remarkPlugins: [],
    rehypePlugins: [
      [rehypeExternalLinks, { target: "_blank", rel: ["nofollow", "noopener", "noreferrer"] }],
      rehypeFigure,
    ],
  },

  vite: {
    plugins: [tailwindcss()],
  },

  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },

  site: "https://ryze.pages.dev",
});
