# NeuAlto Technologies — website

Static marketing site for NeuAlto Technologies. **No build step, no framework, no
dependencies** — the files in this repository are exactly what gets served.

---

## Running it locally

Any static file server works. The repo ships a config for the one used during
development:

```bash
npx http-server -p 4173 -c-1 .
```

Then open <http://localhost:4173>.

> Prefer a server over opening `index.html` directly. Some behaviour (the blog's
> LinkedIn embeds, the D-U-N-S seal) depends on a real HTTP origin.

---

## Layout of the repository

| Path | Purpose |
| --- | --- |
| `index.html` | Home page — the only page with the full section set |
| `services.html` | All six service lines in detail |
| `solutions.html` | Product overview: DeltaMax™ and OptiMax |
| `deltamax.html` / `optimax.html` | Per-product deep dives |
| `blog.html` | LinkedIn post feed (see *Adding a blog post*) |
| `careers.html` | Open roles, with `JobPosting` structured data |
| `privacy.html` | Privacy policy |
| `404.html` | Not-found page |
| `assets/app.js` | All site behaviour (see *JavaScript*) |
| `assets/styles.css` | All styling (see *CSS*) |
| `pics/` | Images: logos, founders, client marks, product screenshots (WebP) |
| `sitemap.xml`, `robots.txt` | Crawler directives — **update the sitemap when adding a page** |
| `llms.txt` | Plain-language facts for AI crawlers — update when contacts or products change |
| `_headers` | Netlify/Cloudflare caching + security headers |
| **Chatbot** | |
| `assets/assistant-widget.js` | The site assistant: search engine + Shadow-DOM UI. No dependencies, no network calls |
| `assets/kb-data.js` | **The chatbot's content.** The only file to edit when changing what it says |
| `docs/kb.json`, `docs/kb-review.md` | Generated from `assets/kb-data.js` by `scripts/build-kb-docs.js` — **do not hand-edit** |
| **Blog** | |
| `assets/posts-data.js` | **Blog post list.** Paste a LinkedIn URL here (see *Adding a blog post*) |
| **Checks** (see *Checks*) | |
| `scripts/check-seo.js` | Structured data, meta, canonicals, links, image alts |
| `scripts/check-chrome.js` | Header/footer parity across all 9 pages |
| `scripts/check-posts.js` | Blog post entries |
| `scripts/assistant-widget.test.js` | Chatbot search accuracy + intent boundaries |
| `scripts/build-kb-docs.js` | Regenerates `docs/kb.json` and `docs/kb-review.md` |
| `tools/png-to-webp.py` | One-time image migration (already run; kept for reference) |
| `docs/WEBSITE-IMPROVEMENTS.md` | Past improvement audit, kept for reference |

---

## JavaScript (`assets/app.js`)

One file, loaded by every page, structured as a **registry of independent
feature modules**. Each module declares the DOM it needs and exits quietly when
that DOM is absent — which is the normal case, since every page loads the same
script.

```js
var myFeature = {
  name: 'myFeature',            // used in error reporting
  init: function () {
    var el = document.getElementById('thing');
    if (!el) return;            // not on this page — do nothing
    // …
  }
};

var MODULES = [ /* …, */ myFeature ];
```

Modules are initialised inside a `try/catch` **individually**, so a failure in
one degrades to "that feature is missing" rather than taking down every feature
declared after it.

### Why one file rather than ES modules

The site is deployed as plain static files. A single classic script keeps that
true: one request, no bundler, and it still works from `file://` — which ES
modules cannot do, because of their CORS rules. The module *structure* provides
the separation of concerns; the single file is only a delivery choice.

### Canvas backgrounds

Decorative canvases share one engine (`mountCanvas`) that handles hi-DPI sizing,
pausing when scrolled out of view, and reduced-motion. A "scene" is a setup
function returning a per-frame draw function, so each scene allocates its
buffers once and keeps the hot loop allocation-free.

To add a background: add a `<canvas id="bgThing" class="bg-canvas">` to the page
and one entry to the `SCENES` map. Nothing else needs to change.

Canvases are skipped entirely on touch devices and viewports under 720px — they
are pointer-reactive, so there is nothing to gain there and battery to lose.

---

## CSS (`assets/styles.css`)

Ordered **broadest to narrowest**, so a rule's position tells you its scope:

```
FOUNDATION          design tokens, reset, base elements, dark theme
LAYOUT              wrappers, section rhythm, sub-page shells
CHROME              header, nav, footer, skip link, progress bar
COMPONENTS          hero, tabs, accordion, marquee, cards, canvases
HOME PAGE           blocks used only by index.html
SUB PAGES           blocks scoped to a single page
RESPONSIVE          cross-cutting breakpoint overrides
MOTION PREFERENCES  the single prefers-reduced-motion block
```

Conventions:

- **Use the tokens.** Colour, shadow and radius come from the custom properties
  in `FOUNDATION`. Add a token rather than hard-coding a hex value.
- **Dark theme is token-driven.** Only add a `[data-theme="dark"]` override when
  a component needs more than a different token value, and keep that override
  beside the component it belongs to.
- **Component media queries stay with their component.** Only cross-cutting
  breakpoint changes belong in `RESPONSIVE`.
- **Every animation needs a counterpart** in `MOTION PREFERENCES`.

---

## Adding a blog post

Posts are official LinkedIn embeds, curated by hand. They live in
**`assets/posts-data.js`** — that is the only file you edit.

1. On LinkedIn, open the post → **⋯ → Copy link to post**.
2. Paste the whole URL into a new entry. Any of these shapes works — the site
   extracts the post id for you:

```js
{
  link: "https://www.linkedin.com/posts/neualto_x-activity-7486023292294754304-uhN5",
  title: "Your headline",
  date: "2026-07-23",                  // YYYY-MM-DD
  tags: ["DeltaMax", "Data Quality"],
  summary: "Two or three sentences in your own words."
}
```

3. Run `node scripts/check-posts.js` — it catches unreadable links, duplicates, bad
   dates, missing summaries, and tags that differ only by capitalisation.

Order does not matter (posts sort newest-first automatically) and the filter
buttons are generated from whatever tags you use, so a new tag needs no other
edit.

The `summary` is not optional decoration — embedded post text lives in an iframe
on LinkedIn's domain and is **not indexed as your content**. The summary is the
only part search engines attribute to this site.

Post data is a plain script rather than a JSON file so the page keeps working
from `file://`, where fetching a local path is blocked.

---

## Checks

Four dependency-free Node scripts. They run in CI on every push, and each exits
non-zero on failure so they can gate a deploy:

```bash
npm test
```

| Command | Checks |
| --- | --- |
| `node scripts/check-seo.js` | JSON-LD parses; FAQ schema matches visible text; titles/descriptions within display length; canonicals absolute and in the sitemap; in-page anchors resolve; robots.txt and sitemap.xml do not contradict each other; every `<img>` has alt and exists on disk; `assets/kb-data.js` links resolve |
| `node scripts/check-chrome.js` | The header and footer are identical across all 9 pages |
| `node scripts/check-posts.js` | Blog entries in `assets/posts-data.js` |
| `node scripts/assistant-widget.test.js` | Chatbot answers the right entry, refuses off-topic questions, and small talk does not swallow real questions |

After editing `assets/kb-data.js`, run `node scripts/build-kb-docs.js` to
regenerate `docs/kb.json` and `docs/kb-review.md`. CI fails if you forget. `kb-review.md` is the client-facing
review document — send it to have answers signed off.

---

## The D-U-N-S Registered Seal

The footer of `index.html` carries D&B's official seal, installed per their DRS
instructions as a **plain synchronous script** in the body:

```html
<script src="https://dunsregistered.dnb.com"></script>
```

Things that will break it, all learned the hard way:

- **Do not add `defer` or `async`.** The seal is written out at the script's
  position; deferring detaches it from its container.
- **Do not set `width`/`height` on the injected iframe.** D&B ships it at
  114×97 with explicit attributes; forcing `width:100%` stretches it out of
  proportion.
- **It renders only on the registered production domain.** Everywhere else the
  container stays empty and the static `pics/Certificate.png` is shown instead;
  `assets/app.js` hides that fallback as soon as the real seal appears.
- The injected iframe uses `http://`, which is mixed content on an https site.
  The `upgrade-insecure-requests` meta tag in `index.html` fixes that — remove
  it and the seal disappears in production.

---

## Conventions worth keeping

- **Accessibility.** Every page has a skip link and a `<main id="main">`. The
  tabs implement the full ARIA pattern (roving tabindex, arrow keys); the FAQ
  keeps `aria-expanded` in sync. Colour choices target WCAG AA.
- **Theme flash.** Each page sets `data-theme` from an inline `<head>` script
  *before* first paint. Keep it inline — moving it to `assets/app.js` reintroduces a
  flash of the wrong theme.
- **Adding a page:** copy the header/footer from an existing page, then update
  the nav on the other pages, `sitemap.xml`, and the footer link lists.

### Known trade-off: duplicated header and footer

The header, nav and footer are copied into all nine pages. That is deliberate —
it keeps the site buildless and the nav server-rendered for crawlers — but it
means **a nav change is a nine-file change**. If that becomes painful, the fix
is a small build step assembling pages from partials, which would trade the
"no build" property for single-source navigation.
