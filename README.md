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
| `app.js` | All site behaviour (see *JavaScript*) |
| `styles.css` | All styling (see *CSS*) |
| `pics/` | Images: logos, founders, client marks, product screenshots |
| `sitemap.xml`, `robots.txt` | Crawler directives — **update the sitemap when adding a page** |

---

## JavaScript (`app.js`)

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

## CSS (`styles.css`)

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

Posts are official LinkedIn embeds, curated by hand.

1. On LinkedIn, open the post → **⋯ → Copy link to post**.
2. From the URL, take the long number after `activity-`.
3. Add an entry to the `NEUALTO_POSTS` array near the bottom of `blog.html`:

```js
{
  urn: "7486023292294754304",
  title: "Your headline",
  date: "2026-07-23",                  // YYYY-MM-DD
  tags: ["DeltaMax", "Data Quality"],  // must match the filter buttons
  summary: "Two or three sentences in your own words."
}
```

The `summary` is not optional decoration — embedded post text lives in an iframe
on LinkedIn's domain and is **not indexed as your content**. The summary is the
only part search engines attribute to this site.

Post data lives in the HTML rather than a JSON file so the page keeps working
from `file://`, where fetching a local path is blocked.

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
  `app.js` hides that fallback as soon as the real seal appears.
- The injected iframe uses `http://`, which is mixed content on an https site.
  The `upgrade-insecure-requests` meta tag in `index.html` fixes that — remove
  it and the seal disappears in production.

---

## Conventions worth keeping

- **Accessibility.** Every page has a skip link and a `<main id="main">`. The
  tabs implement the full ARIA pattern (roving tabindex, arrow keys); the FAQ
  keeps `aria-expanded` in sync. Colour choices target WCAG AA.
- **Theme flash.** Each page sets `data-theme` from an inline `<head>` script
  *before* first paint. Keep it inline — moving it to `app.js` reintroduces a
  flash of the wrong theme.
- **Adding a page:** copy the header/footer from an existing page, then update
  the nav on the other pages, `sitemap.xml`, and the footer link lists.

### Known trade-off: duplicated header and footer

The header, nav and footer are copied into all nine pages. That is deliberate —
it keeps the site buildless and the nav server-rendered for crawlers — but it
means **a nav change is a nine-file change**. If that becomes painful, the fix
is a small build step assembling pages from partials, which would trade the
"no build" property for single-source navigation.
