/**
 * The list of pages the checkers validate — discovered, not hand-maintained.
 *
 * This repository has no build step: Netlify publishes the repo root directly,
 * so every .html file at the root IS a served page. Globbing therefore matches
 * reality by definition, and kills two bug classes the old hardcoded array had:
 *
 *   1. Add a page, forget to add it to PAGES, and it is never validated.
 *   2. Generated article pages (blog-<slug>.html, written by
 *      build-content.js) would be invisible to check-seo.js entirely — a
 *      broken link or missing canonical on a published article would sail
 *      through CI.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');

/** Every served page, sorted so output order never depends on the filesystem. */
var PAGES = fs.readdirSync(ROOT)
  .filter(function (f) { return /\.html$/.test(f); })
  .sort();

/** Pages deliberately kept out of search results. */
var NOINDEX = ['404.html', 'privacy.html'];

/**
 * The hand-written pages. check-chrome.js compares every page's header and
 * footer against the majority variant, and must compute that majority from
 * these only: past ten or so articles the generated pages would become the
 * majority and start reporting the real pages as the deviation.
 */
var HAND_PAGES = PAGES.filter(function (f) { return !/^blog-.*\.html$/.test(f); });

/** Generated article pages. */
var ARTICLE_PAGES = PAGES.filter(function (f) { return /^blog-.*\.html$/.test(f); });

module.exports = {
  PAGES: PAGES,
  NOINDEX: NOINDEX,
  HAND_PAGES: HAND_PAGES,
  ARTICLE_PAGES: ARTICLE_PAGES
};
