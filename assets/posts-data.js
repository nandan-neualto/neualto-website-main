/**
 * NeuAlto blog — post list
 * =====================================================================
 *
 * This is the ONLY file you edit to publish a post. Add an entry, save,
 * reload the page. No build step, no compiling.
 *
 * ─────────────────────────────────────────────────────────────────────
 * TO ADD A POST
 * ─────────────────────────────────────────────────────────────────────
 *   1. On LinkedIn, open the post → "…" menu → "Copy link to post".
 *   2. Paste it straight into `link` below. Any of these forms works —
 *      the site pulls the post id out for you:
 *
 *        https://www.linkedin.com/posts/neualto_x-activity-7486023292294754304-uhN5
 *        https://www.linkedin.com/feed/update/urn:li:activity:7486023292294754304/
 *        7486023292294754304
 *
 *   3. Write a `title` and `summary` in your own words (see WHY below).
 *   4. Add `date` (YYYY-MM-DD) and any `tags`.
 *
 * Order does not matter — posts are sorted newest-first automatically.
 * Filter buttons on the page are generated from whatever tags you use,
 * so a new tag needs no other edit. (Tags are case-sensitive, so keep
 * "AI & ML" spelled the same way each time or you'll get two buttons.)
 *
 * After editing, optionally run:  node scripts/check-posts.js
 * It flags unreadable links, duplicates, bad dates, and missing text
 * before you find out from a broken page.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY TITLE + SUMMARY ARE STILL TYPED BY HAND
 * ─────────────────────────────────────────────────────────────────────
 * The LinkedIn embed is an iframe served by LinkedIn. Its text is NOT
 * part of this page, so Google cannot index a single word of it, and
 * neither can a visitor with the iframe blocked. The title and summary
 * here are the only indexable, readable text the post has on this site.
 * They are worth writing properly — treat the summary as the blog post,
 * not as a caption.
 *
 * They also cannot be fetched automatically: LinkedIn serves a login
 * wall to anything that isn't a signed-in browser. Paste your own words.
 *
 * FIELDS
 *   link     LinkedIn post URL (or bare id). Required.
 *   title    Headline shown on the card. Required.
 *   summary  1–3 sentences in your own words. Required — this is the SEO text.
 *   date     "YYYY-MM-DD". Used for display and sort order.
 *   tags     Array of topic strings; drives the filter buttons.
 */
(function (root, factory) {
  var data = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = data;
  } else {
    root.NEUALTO_POSTS = data;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  return [

    {
      link: "https://www.linkedin.com/feed/update/urn:li:activity:7486023292294754304/",
      title: "The hard part of data quality isn't detection — it's knowing what to ignore",
      date: "2026-07-23",
      tags: ["DeltaMax", "Data Quality"],
      summary: "Building DeltaMax taught us that catching every anomaly doesn't solve the problem — it creates alert fatigue. The breakthrough was context: a Trust Score and an Agent Summary that explain how severe a change actually is, rather than just flagging that something moved. It's also why we shifted from rule-based checks to learned patterns; you can't write a rule for a failure you haven't imagined yet."
    },

    {
      link: "https://www.linkedin.com/feed/update/urn:li:activity:7485310699141820416/",
      title: "Anomaly detection is what makes AI trustworthy",
      date: "2026-07-21",
      tags: ["AI & ML", "Data Quality"],
      summary: "AI is only ever as reliable as the data it learns from. Good anomaly detection does more than spot outliers — it recognizes patterns, surfaces meaningful change, and separates genuine risk from opportunity. We look at where IQR, KNN, Isolation Forest, and ARIMA each earn their place in a production stack."
    }

    // ── Add new posts anywhere in this list ──────────────────────────
    // ,{
    //   link: "PASTE THE LINKEDIN URL HERE",
    //   title: "",
    //   date: "YYYY-MM-DD",
    //   tags: ["Data Quality"],
    //   summary: ""
    // }

  ];
});
