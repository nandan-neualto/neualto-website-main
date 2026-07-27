# Gap Analysis — Redesign vs. Original neualto.com

**Date:** July 22, 2026
**Compared:** this redesign against every reachable page of https://www.neualto.com/

> **Status note (July 25, 2026):** the contact form, both map embeds, the live D-U-N-S seal, marketplace paths, the DeltaMax GCP/Azure deep page, the OptiMax deep page, and the About narrative have all since been built. The main remaining gap is the **Blogs** section. Kept for the original record.

**Bottom line:** The redesign now covers roughly 80% of the original site's *content* with a far stronger visual presentation. The remaining gaps fall into three buckets: **(1) functional features** the original has (contact form, maps, live D-U-N-S seal), **(2) whole content areas** not yet ported (Blogs, the deep DeltaMax/OptiMax sub-sites, parts of About Us), and **(3) polish items** neither site has but ours should.

---

## 1. Missing functionality (original has it, we don't)

### 1.1 Contact form 🔴 biggest gap
The original `/contact` page has a working **"Get in Touch" form** (Name, Email, Phone → SEND). Our site funnels everything through `mailto:` links, which fail silently for users without a configured mail client. This is the single most valuable thing to add — a services company's website exists to capture leads.
*Note: a static form needs a backend — Formspree, Basin, Netlify Forms, or a small serverless endpoint.*

### 1.2 Google Maps embeds
The original contact page embeds **two Google Maps iframes** (Bengaluru office + Johns Creek office). We list the addresses in the footer but have no map.

### 1.3 Live D-U-N-S verification seal
The original embeds the **authenticated D&B seal** (`dunsregistered.dnb.com/SealAuthentication.aspx` iframe) — clicking it proves the registration is real. We show a **static screenshot** (`Certificate.png`).

### 1.4 "Buy" / marketplace paths for products
The original DeltaMax sub-site has **"Buy DeltaMax"** pages (GCP and Azure) and OptiMax has **"Buy Optimax"** and **"Schedule a Demo"**. If DeltaMax is listed on the Azure/GCP marketplaces, those buy links are revenue paths and should be surfaced prominently.

---

## 2. Missing content areas

### 2.1 Blogs section 🔴 entirely absent
The original has a **/blogs** section with 7 posts, category filters (EDI, DevOps, Automation, Security, Kubernetes, Cloud), and a "Trending" feature:
- 5 Effective Git Workflows to Streamline Your Development Process
- CI/CD, DevOps and Containers: A Winning Trio
- The $58.98 Billion EDI Market by 2030
- Top 5 Cloud Computing Trends in 2024
- Demystifying Cloud Computing: Trends and Technologies in 2024
- 10 Test Automation Trends Shaping Software Testing in 2024
- The Real Cost of AI: Managing Cybersecurity Risks

We have nothing equivalent. A simple `blog.html` index + one static page per post would achieve parity (and the posts also feed SEO).

### 2.2 DeltaMax cloud-specific sub-sites 🟠 largest untapped asset
Our solutions page covers only the **"General Overview"** tab of DeltaMax. The original also has full **GCP Version** and **Azure Version** sub-sites, each with:
Home · Insights · Why DeltaMax · **Architecture** · Recovery Events · Competitive Intel · **How to get started** · V2 How to get started · **Results** · FAQs · Technical Documentation · Buy DeltaMax

**You already have nearly all the assets for this** sitting unused in `pics/solutions/`:
- `gcp/architecture.png`, `azure/architecture.png` — architecture diagrams
- `gcp/how-to-get-started/` — **27 walkthrough screenshots**
- `gcp/insights/In1–In7.png` — 7 insight visuals
- `gcp/results/` — 3 charts + 2 tables
- `gcp/v2/` (29 imgs), `azure/v2/` (18 imgs) — V2 walkthroughs
- `common/why-deltamax1–4.png`, `common/Home1.png`, `common/Home2.png`
- `Deltamax-page3/4/5/7.png`, `Optimax-page2/3/4/5.png`

### 2.3 OptiMax sub-pages
We ported OptiMax's **Home** content only. The original also has: **Insights · Conceptual Demo · How to get started · Outputs · Buy Optimax · Schedule a Demo**.

### 2.4 About Us content
Our homepage covers founders, Why NeuAlto, and engagement models, but the original **/about-us** page has content we haven't ported anywhere:
- The **company narrative** ("Headquartered in Bangalore and USA… proven track record…")
- **"How Are We Different?"** — Unique Value Proposition, Core Offerings, and **Differentiators**

### 2.5 Careers-page intro copy
The original careers page has motivational copy we partially trimmed. Minor, but easy to fold into our careers hero.

---

## 3. Content-parity scorecard

| Original page/section | Our coverage |
|---|---|
| Home (hero, services, clients, why, testimonials) | ✅ Full — better presented |
| Services ×6 detail pages | ✅ Full (consolidated on one page) |
| Solutions landing | ✅ (merged into solutions.html) |
| DeltaMax — General Overview | ✅ Full |
| DeltaMax — GCP / Azure sub-sites (12 tabs each) | ❌ Missing |
| OptiMax — Home | ✅ Full |
| OptiMax — Insights/Demo/Get-started/Outputs/Buy | ❌ Missing |
| Partners | ✅ Full |
| About Us — leadership | ✅ (on homepage) |
| About Us — narrative + differentiators | ⚠️ Partial |
| Contact — form + maps | ❌ Missing (addresses ✅) |
| Careers + job listings | ✅ Full — richer than original |
| Blogs (7 posts + categories) | ❌ Missing |
| Privacy Policy | ✅ Full |
| D-U-N-S seal | ⚠️ Static image vs. live verified seal |

---

## 4. Improvement suggestions (beyond parity)

1. **Contact form with backend** (covers gap 1.1 and beats the original's phone-only form by adding a message field).
2. **og:image / twitter:image** — missing from all our pages; links shared on LinkedIn/Slack render text-only.
3. **sitemap.xml + robots.txt** — now that we have 5+ pages, worth generating for crawlability.
4. **404 page** — branded `404.html`.
5. **JobPosting schema touch-up** — add `validThrough` and `baseSalary`.
6. **Complete the tab/accordion ARIA** — `aria-selected`, `role="tabpanel"`, `aria-expanded`, arrow-key tab navigation.
7. **Canonical URLs** — confirm the deployment shape (the original uses extensionless routes).
8. **Square favicon** — `logo.png` is 229×202; a padded 1:1 version renders crisper.
9. **Analytics** — Plausible/Fathom/GA4, already disclosed in the privacy policy's cookies section.
10. **Performance diet** — trim Google Fonts weights, skip canvas animations on `pointer: coarse` devices, progress bar via `transform`.
11. **Blog as SEO engine** — if porting the blog, add per-post meta descriptions and Article schema.
12. **Testimonial photos/logos** — small company logos next to names would add credibility the original also lacks.

---

## 5. Suggested priority order

1. Contact form + maps section (functional gap, direct lead impact)
2. DeltaMax deep page with GCP/Azure tabs (assets already on disk, high sales value)
3. OptiMax sub-content (same reason)
4. About narrative + differentiators section
5. Blog index + port the 7 posts
6. Live D-U-N-S seal, og:image, sitemap/robots, 404
7. ARIA + performance polish
