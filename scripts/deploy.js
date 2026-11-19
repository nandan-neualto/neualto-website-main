/**
 * Production deploy to Vercel (neualto.com).
 *
 *   npm run deploy
 *
 * The Vercel project is not connected to GitHub (see README, "Deploying"),
 * so a push does not deploy. This wraps the manual `vercel deploy --prod`
 * with the checks that keep the live site and GitHub in step:
 *
 *   1. refuses to deploy uncommitted changes to tracked files, so what is
 *      live is always a commit you can find on GitHub (`--allow-dirty` skips);
 *   2. runs `npm test`, the same checks CI runs;
 *   3. confirms this folder is linked to the neualto-website-main project;
 *   4. deploys to production;
 *   5. fetches www.neualto.com and confirms it serves this commit's assets.
 *
 * Needs a one-time `npx vercel login` and `npx vercel link` on a new machine.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var https = require('https');
var spawnSync = require('child_process').spawnSync;

var ROOT = path.join(__dirname, '..');
var PROJECT = 'neualto-website-main';
var SITE = 'https://www.neualto.com/';
var allowDirty = process.argv.indexOf('--allow-dirty') !== -1;

function run(cmd, opts) {
  return spawnSync(cmd, Object.assign({ cwd: ROOT, shell: true, encoding: 'utf8' }, opts || {}));
}
function fail(msg) {
  console.error('\n✖ ' + msg + '\n');
  process.exit(1);
}
function step(msg) { console.log('\n▸ ' + msg); }

// 1. Working tree
step('Checking for uncommitted changes');
var status = run('git status --porcelain').stdout || '';
var changed = status.split('\n').filter(function (l) { return l && l.slice(0, 2) !== '??'; });
var untracked = status.split('\n').filter(function (l) { return l.slice(0, 2) === '??'; });
if (changed.length && !allowDirty) {
  fail('These tracked files have uncommitted changes:\n  ' + changed.join('\n  ') +
       '\nCommit and push them first, so the live site matches GitHub.\n' +
       '(Or run `npm run deploy -- --allow-dirty` to deploy anyway.)');
}
if (untracked.length) {
  console.log('  Note: untracked files in this folder are uploaded too:\n    ' +
    untracked.map(function (l) { return l.slice(3); }).join('\n    '));
}
var commit = (run('git rev-parse --short HEAD').stdout || '').trim();
console.log('  Deploying commit ' + commit);

// 2. Checks
step('Running the site checks (npm test)');
var test = run('npm test', { stdio: 'inherit' });
if (test.status !== 0) fail('Checks failed - fix them before deploying.');

// 3. Vercel link
step('Checking the Vercel project link');
var linkFile = path.join(ROOT, '.vercel', 'project.json');
if (!fs.existsSync(linkFile)) {
  fail('This folder is not linked to Vercel. Run once:\n' +
       '  npx vercel login\n  npx vercel link --project ' + PROJECT + ' --scope neualtotechinjects-projects');
}
var linked = JSON.parse(fs.readFileSync(linkFile, 'utf8')).projectName;
if (linked !== PROJECT) fail('This folder is linked to Vercel project "' + linked + '", expected "' + PROJECT + '".');
console.log('  Linked to ' + linked);

// 4. Deploy
step('Deploying to production');
var deploy = run('npx --yes vercel@latest deploy --prod --yes', { stdio: 'inherit' });
if (deploy.status !== 0) fail('vercel deploy failed (see output above).');

// 5. Verify the live site serves this commit's CSS/JS (the ?v= hash scheme).
step('Verifying ' + SITE);
function version(rel) {
  var lf = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(lf, 'utf8').digest('hex').slice(0, 10);
}
var expected = ['assets/app.js?v=' + version('assets/app.js'), 'assets/styles.css?v=' + version('assets/styles.css')];
https.get(SITE + '?deploy-check=' + Date.now(), function (res) {
  var body = '';
  res.on('data', function (c) { body += c; });
  res.on('end', function () {
    var missing = expected.filter(function (v) { return body.indexOf(v) === -1; });
    if (res.statusCode !== 200 || missing.length) {
      fail('Deployed, but ' + SITE + ' does not serve this commit yet (HTTP ' + res.statusCode +
           (missing.length ? ', missing ' + missing.join(', ') : '') + '). Check again in a minute.');
    }
    console.log('\n✔ Live: ' + SITE + ' is serving commit ' + commit + '.\n');
  });
}).on('error', function (e) { fail('Deployed, but could not reach ' + SITE + ': ' + e.message); });
