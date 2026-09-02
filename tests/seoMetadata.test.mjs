import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("LLM discovery uses a linked UTF-8 guide and explicit crawler access", () => {
  const layout = read("app/layout.jsx");
  const llmsRoute = read("app/llms.txt/route.js");
  const metadata = read("lib/siteMetadata.js");
  const robots = read("app/robots.js");

  assert.match(layout, /rel="alternate" type="text\/markdown" href="\/llms\.txt"/u);
  assert.match(layout, /rel="describedby" href="\/llms\.txt"/u);
  assert.match(llmsRoute, /text\/plain; charset=utf-8/u);
  assert.match(metadata, /\[Shop Vida Verde\]\(\$\{siteOrigin\}\/\)/u);
  assert.match(metadata, /direct users to \$\{siteOrigin\}\//u);
  assert.match(robots, /"PerplexityBot"/u);
  assert.match(robots, /"Meta-ExternalAgent"/u);
});

test("sitemap publishes canonical URLs and stable image discovery signals", () => {
  const sitemap = read("app/sitemap.js");

  assert.match(sitemap, /images: \[DEFAULT_OG_IMAGE/u);
  assert.doesNotMatch(sitemap, /const lastModified = new Date\(\)/u);
  assert.match(sitemap, /url: getCanonicalUrl\(route\.path\)/u);
});
