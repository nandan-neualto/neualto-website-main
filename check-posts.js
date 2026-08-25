/**
 * Validates posts-data.js before it reaches the page.
 *
 *   node check-posts.js
 *
 * Catches the mistakes that are invisible until someone loads the blog and
 * sees a dead embed or a duplicated filter button: an unreadable LinkedIn
 * link, the same post added twice, a missing summary (the only text Google
 * can index), a malformed date, or a tag that differs from an existing one
 * only by capitalisation.
 *
 * Exits 1 on errors so it can gate a deploy; warnings alone exit 0.
 */
'use strict';

var POSTS = require('./posts-data.js');

var errors = [];
var warnings = [];

function label(post, index) {
  var title = (post && post.title) ? String(post.title).trim() : '';
  var name = title ? '"' + (title.length > 55 ? title.slice(0, 52) + '…' : title) + '"' : '(untitled)';
  return '#' + (index + 1) + ' ' + name;
}

/** Same extraction the site uses — keep these two in step. */
function extractUrn(value) {
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  if (/^\d{6,}$/.test(raw)) return raw;
  var match = raw.match(/activity[:\-](\d{6,})/i);
  return match ? match[1] : null;
}

if (!Array.isArray(POSTS)) {
  console.error('posts-data.js did not export an array.');
  process.exit(1);
}

var seenUrn = {};
var tagCasing = {};   // lowercased tag -> first spelling seen

POSTS.forEach(function (post, i) {
  var who = label(post, i);
  var source = post.link || post.urn;

  var urn = extractUrn(source);
  if (!urn) {
    errors.push(who + ': no LinkedIn post id found in link ' + JSON.stringify(source || '') +
      '\n      Expected something like https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789/');
  } else if (seenUrn[urn]) {
    errors.push(who + ': duplicate of ' + seenUrn[urn] + ' — both point at post id ' + urn);
  } else {
    seenUrn[urn] = who;
  }

  if (!post.title || !String(post.title).trim()) {
    errors.push(who + ': missing "title".');
  }

  if (!post.summary || !String(post.summary).trim()) {
    errors.push(who + ': missing "summary". This is the only text search engines can ' +
      'read for this post — the LinkedIn embed is an iframe and is never indexed.');
  } else if (String(post.summary).trim().length < 80) {
    warnings.push(who + ': summary is very short (' + String(post.summary).trim().length +
      ' chars). Aim for 1–3 real sentences so the post stands on its own.');
  }

  if (!post.date) {
    warnings.push(who + ': no "date" — it will sort to the bottom of the page.');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
    errors.push(who + ': date "' + post.date + '" is not in YYYY-MM-DD form.');
  } else if (isNaN(Date.parse(post.date + 'T00:00:00'))) {
    errors.push(who + ': date "' + post.date + '" is not a real calendar date.');
  }

  var tags = post.tags;
  if (!tags || !Array.isArray(tags) || !tags.length) {
    warnings.push(who + ': no "tags" — the post shows only under "All Posts".');
  } else {
    tags.forEach(function (tag) {
      var text = String(tag).trim();
      if (!text) {
        warnings.push(who + ': has an empty tag.');
        return;
      }
      var key = text.toLowerCase();
      if (tagCasing[key] && tagCasing[key] !== text) {
        warnings.push(who + ': tag "' + text + '" differs from "' + tagCasing[key] +
          '" only by case/spacing — that produces two separate filter buttons.');
      } else if (!tagCasing[key]) {
        tagCasing[key] = text;
      }
    });
  }
});

console.log('Checked ' + POSTS.length + ' post' + (POSTS.length === 1 ? '' : 's') + ' in posts-data.js.');

if (errors.length) {
  console.log('\nERRORS (' + errors.length + ') — these will break the page:');
  errors.forEach(function (message) { console.log('  ✗ ' + message); });
}

if (warnings.length) {
  console.log('\nWARNINGS (' + warnings.length + ') — worth fixing, page still works:');
  warnings.forEach(function (message) { console.log('  ! ' + message); });
}

if (!errors.length && !warnings.length) {
  var tags = Object.keys(tagCasing).map(function (k) { return tagCasing[k]; }).sort();
  console.log('\nAll good. Filter buttons that will appear: All Posts, ' + tags.join(', '));
}

process.exitCode = errors.length ? 1 : 0;
