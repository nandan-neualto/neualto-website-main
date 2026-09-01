/**
 * Search-accuracy harness for assistant-widget.js.
 *
 * Runs under plain Node (no browser, no test framework):
 *
 *   node scripts/assistant-widget.test.js
 *
 * It scores every query below against search(), finds where the top hit's
 * score lands relative to the expected entry, and reports:
 *   - pass/fail per case
 *   - the gap between the weakest true-positive score and the strongest
 *     false-positive score (this is what CONFIG.confidenceThreshold must
 *     sit inside, with headroom on both sides)
 *   - intent-boundary checks (smalltalk regexes must not swallow real questions)
 */
var assistant = require('../assets/assistant-widget.js');
var search = assistant.search;
var suggestions = assistant.suggestions;
var detectIntent = assistant.detectIntent;
var CONFIG = assistant.CONFIG;

/**
 * Each case: [query, expectedEntryId or null, mode]
 *
 *   mode 'confident' (default) — must answer, with the expected entry on top
 *   mode 'suggest'             — must NOT answer confidently, but the expected
 *                                entry must still appear in the "did you mean"
 *                                suggestions. Terse fragments belong here: with
 *                                one strong match and one unmatched word they
 *                                are lexically indistinguishable from genuinely
 *                                off-topic questions, so offering a choice is
 *                                the honest behaviour, not asserting an answer.
 *   expected null              — must not answer confidently at all
 */
var CASES = [
  // -- direct questions (canonical phrasing close to `q`) --
  ['What does NeuAlto do?', 'company-overview'],
  ['Where is NeuAlto located?', 'company-locations'],
  ['Who founded NeuAlto?', 'company-founders'],
  ['What services does NeuAlto offer?', 'services-overview'],
  ['What is Managed AI Services?', 'service-managed-ai'],
  ['What is DevSecOps, Cloud & Kubernetes?', 'service-devsecops'],
  ['What is Data Transformation & EDI?', 'service-edi'],
  ['What is Testing & Automation?', 'service-testing'],
  ['What is Cybersecurity Consulting & vCISO?', 'service-cybersecurity'],
  ['What engagement models do you offer?', 'engagement-models'],
  ['What does a typical engagement look like?', 'engagement-typical'],
  ['How quickly can you scale a team up or down?', 'engagement-scale'],
  ['How do you handle security and compliance?', 'security-compliance'],
  ['What is DeltaMax?', 'deltamax-what'],
  ['What problem does DeltaMax solve?', 'deltamax-problem'],
  ["What are DeltaMax's key features?", 'deltamax-features'],
  ['What is the DeltaMax Trust Score?', 'deltamax-trust-score'],
  ['Is DeltaMax available on Google Cloud?', 'deltamax-gcp'],
  ['Is DeltaMax available on Azure?', 'deltamax-azure'],
  ['How do I get started with DeltaMax?', 'deltamax-getting-started'],
  ['How does DeltaMax compare to competitors?', 'deltamax-competitive'],
  ['How do I buy DeltaMax? What does it cost?', 'deltamax-buy'],
  ['What is OptiMax?', 'optimax-what'],
  ['How does OptiMax work?', 'optimax-two-stage'],
  ['Who is OptiMax for?', 'optimax-who'],
  ['How do I get started with OptiMax?', 'optimax-getting-started'],
  ['Can I see a demo of OptiMax?', 'optimax-demo'],
  ['What jobs are open at NeuAlto?', 'careers-openings'],
  ['Tell me about the EDI Senior Developer role.', 'careers-edi-role'],
  ['Tell me about the Sr. MERN Developer role.', 'careers-mern-role'],
  ['How do I apply for a job?', 'careers-apply'],
  ['How do I contact NeuAlto?', 'contact-general'],
  ['How do I request a demo?', 'contact-form'],
  ['i want to see a demo', 'contact-form'],
  ['schedule a walkthrough', 'contact-form'],
  ['how does the contact form work', 'contact-form'],
  ['Does NeuAlto have a blog?', 'blog-what'],
  ['What is your privacy policy?', 'privacy-policy'],

  // -- realistic alternate phrasings --
  ['what kind of company is this', 'company-overview'],
  ['where are your offices', 'company-locations'],
  ['who is the ceo', 'company-founders'],
  ['what can neualto help with', 'services-overview'],
  ['do you do cloud migration', 'service-devsecops'],
  ['can you help with x12 edi', 'service-edi'],
  ['do you offer vciso services', 'service-cybersecurity'],
  ['do you only work with big companies', 'engagement-startups'],
  ['does deltamax run on gcp', 'deltamax-gcp'],
  ['deltamax vs monte carlo', 'deltamax-competitive'],
  ['deltamax pricing', 'deltamax-buy'],
  ['is there an optimax walkthrough', 'optimax-demo'],
  ['optimax pricing', 'optimax-buy'],
  ['are you hiring', 'careers-openings'],
  ['how do i send my resume', 'careers-apply'],
  ['whats your email', 'contact-general'],
  ['how much does an engagement cost', 'pricing-general'],

  // -- typos / shorthand --
  ['wut does neualto do', 'company-overview'],
  ['wher is neualto located', 'company-locations'],
  ['managd ai service', 'service-managed-ai'],
  ['devsecop services', 'service-devsecops'],
  ['edi migraton help', 'service-edi'],
  ['wat is deltamax', 'deltamax-what'],
  ['deltmax price', 'deltamax-buy'],
  ['wat is optimax', 'optimax-what'],
  ['wat jobs r open', 'careers-openings'],
  ['how 2 apply for job', 'careers-apply'],
  ['how 2 contact neualto', 'contact-general'],
  ['privicy policy', 'privacy-policy'],

  // -- synonym / acronym expansion (terms a visitor types that the copy
  //    never uses verbatim) --
  ['do you know k8s', 'service-devsecops'],
  ['kube experience', 'service-devsecops', 'suggest'],
  ['are you in bengaluru', 'company-locations'],
  ['office in bangalore', 'company-locations'],
  ['x12 mapping help', 'service-edi'],
  ['ml model support', 'service-managed-ai'],
  ['deltamax on gcp', 'deltamax-gcp'],
  ['send my cv', 'careers-apply'],
  ['what are your rates', 'pricing-general'],
  ['mdm capability', 'deltamax-features'],

  // -- newly added entries --
  ['what industries do you work in', 'company-industries'],
  ['which sectors do you serve', 'company-industries'],
  ['what is your tech stack', 'company-tech'],
  ['do you work with react', 'company-tech'],

  // -- genuinely off-topic: must NOT confidently match anything --
  ['what is the weather like today', null],
  ['can you recommend a good pizza recipe', null],
  ['who won the world cup', null],
  ['what time is it in tokyo', null],
  ['tell me a joke about cats', null],
  ['how do i reset my wifi router', null],
  ['whats the capital of france', null],
  ['do you sell shoes', null],
  ['book me a flight to paris', null],
  ['what is the meaning of life', null],
  ['how tall is mount everest', null],
  ['play some music please', null]
];

var results = CASES.map(function (c) {
  var query = c[0], expected = c[1], mode = c[2] || (expected === null ? 'reject' : 'confident');
  var ranked = search(query);
  var top = ranked[0];
  var topId = top ? top.entry.id : null;
  var topScore = top ? top.score : 0;
  var answered = !!(top && topScore >= CONFIG.confidenceThreshold);

  var correct;
  if (mode === 'reject') {
    correct = !answered;
  } else if (mode === 'suggest') {
    var offered = suggestions(ranked, 3).some(function (r) { return r.entry.id === expected; });
    correct = !answered && offered;
  } else {
    correct = answered && topId === expected;
  }
  return { query: query, expected: expected, mode: mode, topId: topId, topScore: topScore, correct: correct };
});

var passed = results.filter(function (r) { return r.correct; });
var failed = results.filter(function (r) { return !r.correct; });

console.log('=== assistant-widget search accuracy ===');
console.log('Total cases: ' + results.length + '   Passed: ' + passed.length + '   Failed: ' + failed.length);
console.log('');

if (failed.length) {
  console.log('--- FAILURES ---');
  failed.forEach(function (r) {
    console.log('  "' + r.query + '"  [' + r.mode + ']');
    console.log('    expected: ' + (r.expected === null ? '(no confident match)' : r.expected));
    console.log('    got:      ' + (r.topId || '(none)') + '  score=' + r.topScore.toFixed(2));
  });
  console.log('');
}

// The gap that decides the threshold: the weakest question that SHOULD be
// answered outright, against the strongest question that must NOT be. Cases
// marked 'suggest' are deliberately excluded — they are meant to land between
// the two, so folding them in would collapse the very gap being measured.
var mustAnswer = results
  .filter(function (r) { return r.mode === 'confident' && r.topId === r.expected; })
  .map(function (r) { return r.topScore; });
var mustReject = results
  .filter(function (r) { return r.mode === 'reject'; })
  .map(function (r) { return r.topScore; });

var weakestTruePositive = Math.min.apply(null, mustAnswer);
var strongestFalsePositive = mustReject.length ? Math.max.apply(null, mustReject) : 0;
var gap = weakestTruePositive - strongestFalsePositive;

console.log('--- THRESHOLD GAP ---');
console.log('Weakest must-answer score:          ' + weakestTruePositive.toFixed(2));
console.log('Strongest must-reject score:        ' + strongestFalsePositive.toFixed(2));
console.log('Gap available for the threshold:    ' + gap.toFixed(2));
console.log('Current CONFIG.confidenceThreshold: ' + CONFIG.confidenceThreshold);
if (gap > 0) {
  var mid = (weakestTruePositive + strongestFalsePositive) / 2;
  console.log('Midpoint of the gap:                ' + mid.toFixed(2)
    + '   (headroom +-' + (gap / 2).toFixed(2) + ')');
  var ok = CONFIG.confidenceThreshold > strongestFalsePositive && CONFIG.confidenceThreshold < weakestTruePositive;
  console.log('Threshold sits inside the gap:      ' + (ok ? 'yes' : 'NO — retune to the midpoint above'));
} else {
  console.log('!! No positive gap — true and false positives overlap.');
}
console.log('');

// --- Intent boundary checks: loose smalltalk patterns must not swallow real questions ---
var INTENT_CASES = [
  ['hi', 'greeting'],
  ['hello', 'greeting'],
  ['hey there', 'greeting'],
  ['good morning', 'greeting'],
  ['thanks', 'thanks'],
  ['thank you!', 'thanks'],
  ['bye', 'goodbye'],
  ['see you later', 'goodbye'],
  ['what can you do', 'capability'],
  ['what can you help with?', 'capability'],
  ['who are you', 'capability'],
  ['talk to a human', 'human'],
  ['i want to speak to someone', 'human'],
  ['connect me with sales', 'human'],
  // boundary cases: share a word with a smalltalk pattern but are real questions
  ['who are your partners', null],
  ['who are your founders', null],
  ['hi there, tell me about deltamax', null],
  ['hire me, what roles are open', null],
  ['how do i buy deltamax', null],
  ['what can you tell me about optimax pricing', null],
  ['good morning, what services do you offer', null],
  ['bye week hiring plans', null],
  ['thanks for the demo, how much is optimax', null],
  ['later stage startups, do you work with them', null]
];

var intentResults = INTENT_CASES.map(function (c) {
  var query = c[0], expected = c[1];
  var got = detectIntent(query);
  var gotName = got ? got.name : null;
  return { query: query, expected: expected, got: gotName, correct: gotName === expected };
});
var intentFailed = intentResults.filter(function (r) { return !r.correct; });

console.log('=== intent boundary checks ===');
console.log('Total: ' + intentResults.length + '   Passed: ' + (intentResults.length - intentFailed.length) + '   Failed: ' + intentFailed.length);
if (intentFailed.length) {
  intentFailed.forEach(function (r) {
    console.log('  "' + r.query + '" expected=' + r.expected + ' got=' + r.got);
  });
}

var exitCode = (failed.length || intentFailed.length) ? 1 : 0;
if (exitCode) console.log('\nFAIL');
else console.log('\nALL PASS');
process.exitCode = exitCode;
