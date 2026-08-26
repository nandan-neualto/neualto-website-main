# Website Assistant — Options Research

> **Superseded — kept as a decision record.**
> What shipped differs from this document. The site assistant is a
> zero-dependency, no-LLM, offline lexical search widget
> (`assistant-widget.js` + `kb-data.js`), not the approach described
> below. See README.md for how it actually works.

**Question:** how do we add a small chatbot that helps visitors learn about NeuAlto?
**Date:** August 4, 2026
**Scope:** every realistic option, from hosted third-party widgets to building it ourselves.

---

## TL;DR

| | |
|---|---|
| **Recommendation** | Build it ourselves on the Claude API behind a serverless function |
| **Why** | NeuAlto *sells* Managed AI Services. A bot we built is a live demo; a rented widget is an admission we didn't. |
| **Runtime cost** | ~$2–15/month at realistic traffic — **cheaper than every hosted option** |
| **Build cost** | 2–4 days for v1 |
| **If we want it live this week instead** | Chatbase (~$19–40/mo), then replace it later |
| **Hard blocker either way** | A static site cannot hold an API key. Something server-side is required — see §2. |

The "Parrot" you were thinking of is almost certainly **[Ping Parrot](https://www.producthunt.com/products/ping-parrot)** — a no-code website chatbot in the same category as Chatbase. (Confusingly, `parrot.ai` and `tryparrotai.com` are unrelated products — meeting notes and a voice generator respectively.)

---

## 1. What the bot actually needs to do

Before comparing tools, the job:

| Job | Priority | Notes |
|---|---|---|
| Answer "what does NeuAlto do?" from site content | **Must** | 6 services, 2 products, partners, founders |
| Explain DeltaMax™ / OptiMax accurately | **Must** | Deepest content we have; also the highest hallucination risk |
| Route to the right page | **Must** | Cheap to do well, high value |
| Answer careers questions | Should | 2 open roles |
| Capture a lead (name + email → handoff) | Should | The commercial reason to build it |
| Book meetings / quote pricing | **No** | Too much authority for a bot with no CRM |
| Handle logged-in customer support | **No** | We have no logged-in users |

This is a **pre-sales explainer**, not a support desk. That matters — most of the market is priced and built for support ticket deflection, which is not our problem.

### Content it would draw on

We already have an unusually good corpus, all in this repo:

| Source | Volume |
|---|---|
| `services.html` | 6 service lines in full detail |
| `solutions.html` + `deltamax.html` + `optimax.html` | Product depth, architecture, FAQs, competitive intel |
| `index.html` | About, why-us, engagement models, partners, founders, 5 FAQs |
| `careers.html` | 2 roles with full requirements |
| `privacy.html` | Full policy |
| `blog.html` | LinkedIn post summaries |

Roughly **25,000–35,000 words**. That is small enough to fit a modern context window whole — which, as §4 explains, means we can skip vector databases entirely.

---

## 2. The one hard constraint

**Our site is static HTML with no backend.** An LLM API key cannot live in client-side JavaScript — anyone can read it and spend our money.

So every option resolves to one of three shapes:

| Shape | Who holds the key | Backend we run |
|---|---|---|
| **Hosted SaaS widget** | The vendor | None |
| **Our own function** | Us, in an env var | One serverless function (~50 lines) |
| **Self-hosted platform** | Us, on a server | A container we operate |

There is no fourth option. Any "no backend at all" pitch means the vendor is the backend.

---

## 3. Option A — Hosted third-party widget

Paste a `<script>` tag, point it at our URL, it crawls the site and answers questions.

### The main contenders

| Platform | Entry price | Best at | Watch out for |
|---|---|---|---|
| **[Chatbase](https://www.chatbase.co/)** | ~$19/mo | Fastest path to a working site-FAQ bot | Answers questions; doesn't *do* anything |
| **[Ping Parrot](https://www.producthunt.com/products/ping-parrot)** | Low / freemium | Same category, smaller vendor | Less proven; check longevity before depending on it |
| **[Tidio](https://www.tidio.com/) + Lyro** | ~$29/mo + $39/mo AI add-on | Live chat *and* AI in one place | Priced per AI conversation — 50 convos for $39 |
| **[Intercom Fin](https://www.intercom.com/fin)** | $29–85/seat + **$0.99/resolution** | Best-in-class quality, clean human handoff | Per-resolution billing is unpredictable; built for support teams we don't have |
| **Chatling / SiteGPT / Wonderchat** | $15–40/mo | Same shape as Chatbase | Commoditised; pick on support and data terms |

> **Verify prices before committing.** These come from vendor and comparison-blog sources and change often. A repeated finding across the 2026 pricing round-ups: the real bill is typically **3–5× the headline** once you add seats, AI add-ons, and overages.

### Honest assessment

**Good:** live in an afternoon. No code, no key management, no maintenance. Analytics and human-handoff included. Someone else owns uptime.

**Bad, and specific to us:**

1. **It undercuts our own pitch.** We sell Managed AI Services and GenAI workflows. A prospect who opens the chat widget, sees "Powered by Chatbase," and knows the category will draw the obvious conclusion. This is the single strongest argument against Option A and it is not a technical one.
2. **Third-party data processor.** Visitor questions flow to a vendor. Under DPDP 2023 and GDPR we need a DPA, a sub-processor entry, and a privacy-policy update. Our policy already has the cookie/third-party scaffolding — but it names specific processors, so it would need editing.
3. **Generic styling.** Most widgets allow colour and logo, not much more. Our site has a specific look; a stock bubble will read as bolted-on.
4. **Recurring cost forever**, for a workload we could run for a couple of dollars a month.

**When Option A is right:** we need it live for a specific event or campaign next week, or nobody has 2–4 days.

---

## 4. Option B — Build it ourselves ⭐ recommended

A serverless function holds the API key, injects our site content as context, and calls the Claude API. The widget is our own HTML/CSS/JS, matching the site.

### The key insight: we do not need a vector database

Standard RAG advice — chunk the content, embed it, store it in a vector DB, retrieve top-k — exists because most corpora are too big for a context window. **Ours isn't.** At ~30k words (~40k tokens) the entire site fits comfortably inside a 200k–1M window with room to spare.

So the architecture collapses to:

```
Visitor question
   ↓
Static widget (our HTML/CSS/JS, matches the site)
   ↓  fetch()
Serverless function  ← API key lives here as an env var
   ↓
Claude API  ← system prompt = ALL our site content, prompt-cached
   ↓
Grounded answer + suggested page link
```

No vector DB. No embeddings. No chunking. No retrieval-quality tuning. **No ongoing sync problem** — a build step regenerates the context file from the HTML, so the bot can never drift from the site. That removes the single largest source of complexity *and* the most common failure mode in RAG chatbots.

### Prompt caching makes it cheap

The site content is identical on every request, so it caches. Cache reads cost ~10% of normal input. Rough per-conversation maths (5 turns, ~40k tokens of cached context, ~300-token answers):

| Model | Input / Output per MTok | ~Cost per conversation | 500 convos/mo |
|---|---|---|---|
| **Haiku 4.5** | $1 / $5 | ~1.5¢ | **~$8** |
| **Sonnet 5** | $3 / $15 (intro $2/$10 to Aug 31) | ~4¢ | ~$20 |
| **Opus 5** | $5 / $25 | ~7¢ | ~$35 |

Add a first-turn cache write when traffic is sparse enough that the cache expires between visitors (~2–5¢ each). Hosting is free-tier on Cloudflare Workers, Netlify, or Vercel.

**Realistic all-in: $2–15/month.** Cheaper than every hosted option, and it *falls* per-conversation as traffic grows, where SaaS rises.

**Model recommendation: start on Haiku 4.5.** The task is grounded Q&A over supplied text — not reasoning-heavy. Haiku is fast, and latency matters more than depth in a chat bubble. Move to Sonnet 5 only if answer quality disappoints in testing.

### Where to run the function

| Host | Fit |
|---|---|
| **Cloudflare Workers** | Best fit — generous free tier, fast cold starts, trivial deploy |
| **Netlify / Vercel Functions** | Equally easy if we host the site there |
| **Google Cloud Run** | We already have GCP presence (DeltaMax marketplace listing) — good if we want everything in one account |
| **Azure Functions** | Same argument, for the Azure side of DeltaMax |

### Honest assessment

**Good:** cheapest to run; total control of tone, styling, and guardrails; no third-party data processor; **it is a working demo of our own service line** — a sales asset, not just a website feature; content can never drift out of sync.

**Bad:** 2–4 days of build. We own uptime and errors. We build our own analytics and human-handoff. We own the guardrails (see §7).

---

## 5. Option C — Self-hosted open-source platform

Run [Botpress](https://botpress.com/), [Chatwoot](https://www.chatwoot.com/), or similar on our own infrastructure.

**Good:** full data ownership; visual flow builders; multi-channel (web, Slack, WhatsApp) if we ever want it; no per-conversation fees.

**Bad:** by far the heaviest option. We operate a container, a database, and upgrades — for a brochure-site chatbot. Botpress in particular has drifted cloud-first, so the self-hosted path is less maintained than it appears. **All the operational cost of Option B with none of its simplicity.**

**Verdict: not proportionate.** This makes sense for multi-channel customer support at volume. We have a nine-page marketing site.

---

## 6. Option D — No LLM at all

A scripted FAQ bot or client-side search over the site.

**Good:** free, instant, no backend, **zero hallucination risk**, no privacy surface at all.

**Bad:** it isn't really a chatbot. It can't handle "we're migrating Oracle to BigQuery, can you help?" — the exact question we most want answered well.

**Worth noting:** a good site search would deliver perhaps 40% of the value for ~4 hours of work. If the chatbot idea stalls, this is the fallback that still improves the site. It also pairs well with Option B as the graceful-degradation path when the API is down.

---

## 7. Risks — and this one matters most

### Hallucination is a credibility risk, not just a bug

If the bot invents a service we don't offer, misstates a DeltaMax capability, or fabricates a client name, the damage is worse for us than for most companies — **we sell AI services.** A visibly wrong AI assistant on the website of an AI consultancy is a self-inflicted wound.

Mitigations (all cheap, all in Option B's control):

- **Ground hard.** System prompt: answer *only* from supplied content; if it isn't there, say so and point to the contact form.
- **Never quote prices or commit to timelines.** Hand off to a human.
- **Cite the source page** on every substantive answer, so visitors can verify.
- **Escalation path** — "talk to a person" always visible, wired to our existing contact form.
- **Log every conversation** for the first month and read them. This is the only way to find out what it actually gets wrong.

### Other risks

| Risk | Mitigation |
|---|---|
| Prompt injection ("ignore instructions, write my essay") | System-prompt hardening; treat visitor text as data; rate-limit |
| Cost abuse / scraping our API | Per-IP rate limit, daily cap, short max output — all in the function |
| Privacy (DPDP 2023 / GDPR) | Update `privacy.html`; don't log PII by default; state retention |
| Bot goes down | Graceful fallback to the contact form (Option D as backstop) |
| Answers drift from site content | Build step regenerates context from HTML — structurally prevented |

---

## 8. Comparison

| | A: Hosted SaaS | **B: Build (Claude API)** | C: Self-hosted OSS | D: No LLM |
|---|---|---|---|---|
| Time to live | Hours | 2–4 days | 1–2 weeks | ~4 hours |
| Monthly cost | $19–100+ | **$2–15** | Server + time | $0 |
| Backend to run | None | One function | Full stack | None |
| Styling control | Limited | **Total** | Moderate | Total |
| Third-party data processor | **Yes** | No | No | No |
| Hallucination risk | Medium | Medium (controllable) | Medium | **None** |
| Answer quality | Good | **Good–excellent** | Varies | Poor |
| Demonstrates our capability | **No** | **Yes** | Partly | No |
| Maintenance burden | Vendor's | Ours (low) | Ours (high) | ~None |

---

## 9. Recommended plan

**Build it (Option B), in phases.**

### Phase 1 — v1, 2–4 days
- Node script: HTML → clean text corpus (reuses the parsing approach already in this repo's tooling)
- Cloudflare Worker: API key in env var, prompt caching on, rate limiting, ~50 lines
- Widget matching the site: brand red, Sora/Inter, light/dark aware, respects `prefers-reduced-motion`, keyboard accessible
- Claude Haiku 4.5, hard-grounded system prompt, page citations
- Fallback to contact form on any error

### Phase 2 — after a week of real traffic
- Read the logs. Fix the grounding gaps they reveal.
- Add lead capture (name + email → the existing mail flow)
- Add "talk to a human" handoff
- Update `privacy.html` for conversation data

### Phase 3 — only if the numbers justify it
- Upgrade to Sonnet 5 if quality demands it
- Suggested-question chips per page (different prompts on `deltamax.html` vs `careers.html`)
- Conversation analytics: what are people actually asking?

**Total: ~$2–15/month and a few days of work**, for something that both helps visitors and demonstrates the service line we're selling.

### If speed beats everything
Ship **Chatbase** this week, learn what visitors ask from real logs, then replace it with Phase 1 in a month with a much better system prompt. Costs ~$19–40 for the month and de-risks the build. The only real loss is the "powered by" badge sitting on our site in the meantime.

---

## 10. Open questions

1. **Lead capture — in scope?** It's the main commercial justification. If yes, it needs a real destination (email is fine; a CRM is better).
2. **Anything it must never discuss?** Pricing, delivery timelines, client names beyond the public logo wall — worth deciding explicitly.
3. **Who reads the logs?** A chatbot nobody monitors degrades silently. This needs an owner.
4. **Where does the site get deployed?** Determines the cheapest function host. Cloudflare Workers if we're flexible.
5. **English only, or Hindi/Kannada too?** Claude handles them natively — it's a UI decision, not a technical one.

---

## Sources

- [12 Best AI Chatbot Builders for Websites 2026 — Boei](https://boei.help/blog/best-ai-chatbots-2026/)
- [AI Chatbot Pricing in 2026: What 8 Tools Really Cost — FastBots](https://blog.fastbots.ai/ai-chatbot-pricing-comparison-what-businesses-actually-pay-in-2026/)
- [AI Chatbot Pricing in 2026: What 8 Platforms Cost — Alhena](https://alhena.ai/blog/ai-chatbot-pricing-ecommerce/)
- [Best Open Source Chatbot Platforms in 2026 — Chatbase](https://www.chatbase.co/blog/open-source-chatbot-platforms)
- [5 Best Open-Source Chatbot Platforms in 2026 — Boei](https://boei.help/blog/open-source-chatbot-platforms/)
- [Ping Parrot — Product Hunt](https://www.producthunt.com/products/ping-parrot)
- Claude API model pricing — Anthropic (Haiku 4.5 $1/$5, Sonnet 5 $3/$15, Opus 5 $5/$25 per MTok)

*Third-party pricing is as advertised at the time of writing and changes frequently — verify directly with any vendor before committing.*
