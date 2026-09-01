/**
 * Regenerates kb.json and kb-review.md FROM kb-data.js.
 *
 *   node build-kb-docs.js
 *
 * kb-data.js is the only file you should hand-edit. This script mechanically
 * derives the other two from it, so what a client reviews in kb-review.md is
 * guaranteed to be exactly what the bot answers with — never a manually kept
 * copy that could quietly drift out of sync.
 *
 *   kb.json       — plain JSON export of the knowledge base (for tooling,
 *                   diffing, or handing to something other than a browser).
 *   kb-review.md  — a clean FAQ document grouped by category, with a
 *                   "Reviewed / approved" checkbox per question. Send this to
 *                   a client; check the boxes as each answer is confirmed.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ENTRIES = require('./kb-data.js');

/* ── kb.json ─────────────────────────────────────────────────────────── */

var json = JSON.stringify(ENTRIES, null, 2) + '\n';

fs.writeFileSync(path.join(__dirname, 'kb.json'), json);

/* ── kb-review.md ────────────────────────────────────────────────────── */

function escapeMd(text) {
  // Only neutralise characters that would be misread as Markdown syntax in
  // this specific plain-text context (a details summary); the answer text
  // itself is deliberately left as real markdown further down, since that's
  // exactly what should render for the client.
  return String(text).replace(/([_*`])/g, '\\$1');
}

var byCategory = {};
var order = [];
ENTRIES.forEach(function (entry) {
  if (!byCategory[entry.c]) { byCategory[entry.c] = []; order.push(entry.c); }
  byCategory[entry.c].push(entry);
});

/* Stamped with a hash of the CONTENT, not a date. Regenerating without editing
   kb-data.js must produce byte-identical output, or the CI check asserting these
   files are in sync would fail on the stamp alone. An mtime cannot do this job:
   git does not preserve mtimes, so on a fresh CI clone it resolves to the CHECKOUT
   date and the gate goes red on an untouched repo. The hash is also the better
   stamp for what this file is FOR - "is this the version I approved?" is a
   question about content, not about when the file was written. */
var contentId = crypto.createHash('sha256').update(json).digest('hex').slice(0, 12);
var lines = [];

lines.push('# NeuAlto Assistant — knowledge base review');
lines.push('');
lines.push('Generated from `kb-data.js` — ' + ENTRIES.length + ' entries, content id `' +
  contentId + '`. ' +
  'This is a direct export of what the chatbot actually answers with — nothing here is ' +
  'paraphrased or summarized, so approving an answer below is the same as approving what ' +
  'visitors will see.');
lines.push('');
lines.push('**To regenerate after an edit:** `node build-kb-docs.js`');
lines.push('');
lines.push('---');
lines.push('');

order.forEach(function (category) {
  lines.push('## ' + category);
  lines.push('');

  byCategory[category].forEach(function (entry) {
    lines.push('### ' + entry.q);
    lines.push('');
    lines.push('*ID: `' + entry.id + '`*');
    lines.push('');
    lines.push(entry.a);
    lines.push('');

    if (entry.href) {
      lines.push('**Links to:** `' + entry.href + '`');
      lines.push('');
    }

    if (entry.rel && entry.rel.length) {
      var relQuestions = entry.rel
        .map(function (id) {
          var found = ENTRIES.filter(function (e) { return e.id === id; })[0];
          return found ? found.q : null;
        })
        .filter(Boolean);
      if (relQuestions.length) {
        lines.push('**Related questions offered:** ' + relQuestions.join(' · '));
        lines.push('');
      }
    }

    if ((entry.alts && entry.alts.length) || (entry.k && entry.k.length)) {
      lines.push('<details>');
      lines.push('<summary>Search tuning (alternate phrasings &amp; keywords — not shown to visitors)</summary>');
      lines.push('');
      if (entry.alts && entry.alts.length) {
        lines.push('Also recognizes: ' + entry.alts.map(escapeMd).join(', '));
        lines.push('');
      }
      if (entry.k && entry.k.length) {
        lines.push('Keywords: ' + entry.k.map(escapeMd).join(', '));
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }

    lines.push('- [ ] Reviewed / approved');
    lines.push('');
    lines.push('---');
    lines.push('');
  });
});

fs.writeFileSync(path.join(__dirname, 'kb-review.md'), lines.join('\n'));

console.log('Wrote kb.json (' + ENTRIES.length + ' entries) and kb-review.md.');
