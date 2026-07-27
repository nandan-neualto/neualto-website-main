(function () {
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* touch/small screens get no hover payoff from the canvases — skip the per-frame cost.
     Must be assigned up here: the hero globe calls canvasAnim before the engine's own body runs. */
  var lowPower = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
                 window.innerWidth < 720;
  function $$(sel) { return document.querySelectorAll(sel); }

  /* Progress bar, back-to-top, scrollspy — one rAF-throttled scroll handler */
  var progress = document.getElementById('progress');
  var toTop = document.getElementById('toTop');
  var spySections = [];
  $$('#spy a[data-spy]').forEach(function (a) {
    var sec = document.getElementById(a.getAttribute('data-spy'));
    if (sec) spySections.push({ a: a, sec: sec });
  });
  var scrollQueued = false;
  function onScroll() {
    scrollQueued = false;
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    /* scaleX stays on the compositor; animating width would force layout each frame */
    if (progress) progress.style.transform = 'scaleX(' + (max > 0 ? h.scrollTop / max : 0) + ')';
    if (toTop) toTop.classList.toggle('show', h.scrollTop > 600);
    var pos = h.scrollTop + 140, current = null, i;
    for (i = 0; i < spySections.length; i++) if (spySections[i].sec.offsetTop <= pos) current = spySections[i];
    for (i = 0; i < spySections.length; i++) spySections[i].a.classList.toggle('active', spySections[i] === current);
  }
  window.addEventListener('scroll', function () {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();
  if (toTop) toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

  /* Mobile nav drawer */
  var navToggle = document.getElementById('navToggle');
  var mobileNav = document.getElementById('mobileNav');
  function closeNav() {
    if (!mobileNav) return;
    mobileNav.classList.remove('open');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-open');
  }
  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('nav-open', open);
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeNav();
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
  }

  /* ═══════ Blog: render LinkedIn post cards + filters ═══════
     Embeds are injected only when a card nears the viewport — 20 LinkedIn
     iframes loading at once would stall the page. */
  var postGrid = document.getElementById('postGrid');
  if (postGrid && window.NEUALTO_POSTS) {
    var posts = window.NEUALTO_POSTS;
    var postEmpty = document.getElementById('postEmpty');
    var esc = function (s) {
      return String(s).replace(/[&<>"']/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      });
    };
    var fmtDate = function (iso) {
      var d = new Date(iso + 'T00:00:00');
      return isNaN(d) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    postGrid.innerHTML = posts.map(function (p) {
      var tags = (p.tags || []).map(function (t) {
        return '<span class="pill">' + esc(t) + '</span>';
      }).join('');
      var url = 'https://www.linkedin.com/feed/update/urn:li:activity:' + encodeURIComponent(p.urn);
      return '<article class="post-card" data-tags="' + esc((p.tags || []).join('|')) + '">' +
          '<div class="post-body">' +
            '<div class="post-meta">' +
              '<time datetime="' + esc(p.date) + '">' + esc(fmtDate(p.date)) + '</time>' +
              '<span class="post-src">LinkedIn</span>' +
            '</div>' +
            '<h2>' + esc(p.title) + '</h2>' +
            '<p>' + esc(p.summary) + '</p>' +
            '<div class="pill-row">' + tags + '</div>' +
          '</div>' +
          '<div class="post-embed" data-urn="' + esc(p.urn) + '">' +
            '<div class="embed-skeleton"><span></span><span></span><span></span></div>' +
          '</div>' +
          '<a class="svc-link post-link" href="' + esc(url) + '" target="_blank" rel="noopener">' +
            'Discuss on LinkedIn <svg width="15" height="15"><use href="#i-arrow"/></svg>' +
          '</a>' +
        '</article>';
    }).join('');

    /* Native loading="lazy" defers the offscreen iframes for us — more reliable
       than an IntersectionObserver, and the browser picks the fetch moment. */
    postGrid.querySelectorAll('.post-embed').forEach(function (holder) {
      var f = document.createElement('iframe');
      f.src = 'https://www.linkedin.com/embed/feed/update/urn:li:activity:' + holder.dataset.urn;
      f.title = 'LinkedIn post by NeuAlto';
      f.loading = 'lazy';
      f.setAttribute('frameborder', '0');
      f.setAttribute('allowfullscreen', '');
      f.addEventListener('load', function () {
        var sk = holder.querySelector('.embed-skeleton');
        if (sk) sk.remove();
        holder.dataset.loaded = '1';
      });
      holder.appendChild(f);
    });

    $$('.filter-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var f = chip.getAttribute('data-filter');
        $$('.filter-chip').forEach(function (c) { c.classList.toggle('active', c === chip); });
        var shown = 0;
        $$('.post-card').forEach(function (card) {
          var on = f === 'all' || ('|' + card.getAttribute('data-tags') + '|').indexOf('|' + f + '|') > -1;
          card.hidden = !on;
          if (on) shown++;
        });
        if (postEmpty) postEmpty.hidden = shown > 0;
      });
    });
  }

  /* Contact form → composes a pre-filled email (front-end only, no backend) */
  var cForm = document.getElementById('contactForm');
  if (cForm) cForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(cForm);
    var subject = 'Website enquiry — ' + (fd.get('name') || 'New contact');
    var body = 'Name: ' + (fd.get('name') || '') +
      '\nEmail: ' + (fd.get('email') || '') +
      '\nPhone: ' + (fd.get('phone') || '-') +
      '\n\n' + (fd.get('message') || '');
    window.location.href = 'mailto:info@neualto.com?subject=' +
      encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  });

  /* Dark mode toggle (initial theme is set by the inline head script) */
  var themeBtn = document.getElementById('themeToggle');
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  if (themeBtn) {
    themeBtn.setAttribute('aria-pressed', isDark() ? 'true' : 'false');
    themeBtn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      themeBtn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  /* Rotating headline word */
  var rot = document.getElementById('rotWord');
  if (rot && !reduced) {
    var words = ['enterprise technology', 'AI at scale', 'cloud-native systems', 'secure products'];
    var wi = 0, rotStarted = false;
    function startRotator() {
      if (rotStarted) return;
      rotStarted = true;
      setInterval(function () {
        rot.classList.add('out');
        setTimeout(function () {
          wi = (wi + 1) % words.length;
          rot.textContent = words[wi];
          rot.classList.remove('out');
          rot.classList.add('in');
          setTimeout(function () { rot.classList.remove('in'); }, 420);
        }, 400);
      }, 3000);
    }
    /* start only after the visitor interacts, so the initial render always shows the full headline */
    ['scroll', 'pointermove', 'keydown', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, startRotator, { once: true, passive: true });
    });
  }

  /* Number tickers */
  if (!reduced) {
    $$('.tick').forEach(function (el) {
      var to = parseInt(el.getAttribute('data-to'), 10);
      if (isNaN(to)) return;
      var start = null, dur = 1300;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      el.textContent = '0';
      requestAnimationFrame(step);
    });
  }

  /* Magnetic button */
  var mag = document.getElementById('magBtn');
  if (mag && !reduced) {
    mag.addEventListener('mousemove', function (e) {
      var r = mag.getBoundingClientRect();
      var x = e.clientX - r.left - r.width / 2;
      var y = e.clientY - r.top - r.height / 2;
      mag.style.transform = 'translate(' + x * 0.22 + 'px,' + y * 0.3 + 'px)';
    });
    mag.addEventListener('mouseleave', function () { mag.style.transform = ''; });
  }

  /* Spotlight cards */
  $$('.spot-card').forEach(function (card) {
    card.addEventListener('mousemove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* 3D tilt founder cards */
  if (!reduced) {
    $$('.tilt').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = 'rotateY(' + px * 10 + 'deg) rotateX(' + -py * 10 + 'deg)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transition = 'transform .5s ease';
        card.style.transform = '';
        setTimeout(function () { card.style.transition = ''; }, 500);
      });
    });
  }

  /* Tabs — full ARIA tab pattern with roving tabindex + arrow keys */
  var tabBtns = $$('.tab-btn');
  var tabInd = document.getElementById('tabInd');
  function selectTab(btn, focus) {
    var i = parseInt(btn.getAttribute('data-tab'), 10);
    tabBtns.forEach(function (b) {
      var on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $$('.tab-panel').forEach(function (p) {
      var on = parseInt(p.getAttribute('data-panel'), 10) === i;
      p.classList.toggle('active', on);
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
    if (tabInd) tabInd.style.transform = 'translateX(' + (i * 100) + '%)';
    if (focus) btn.focus();
  }
  tabBtns.forEach(function (btn, idx) {
    btn.addEventListener('click', function () { selectTab(btn); });
    btn.addEventListener('keydown', function (e) {
      var n = tabBtns.length, next = null;
      if (e.key === 'ArrowRight') next = tabBtns[(idx + 1) % n];
      else if (e.key === 'ArrowLeft') next = tabBtns[(idx - 1 + n) % n];
      else if (e.key === 'Home') next = tabBtns[0];
      else if (e.key === 'End') next = tabBtns[n - 1];
      if (next) { e.preventDefault(); selectTab(next, true); }
    });
  });

  /* FAQ accordion */
  $$('.faq-q').forEach(function (q) {
    q.addEventListener('click', function () {
      var item = q.parentElement;
      var wasOpen = item.classList.contains('open');
      $$('.faq-item').forEach(function (it) {
        it.classList.remove('open');
        var b = it.querySelector('.faq-q');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) { item.classList.add('open'); q.setAttribute('aria-expanded', 'true'); }
    });
  });

  /* Hero: 3D particle globe (canvasAnim engine, hoisted from below).
     Typed arrays keep the per-frame loop allocation-free. */
  canvasAnim('bg3d', function (ctx) {
    var N = 240, i;
    var px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    var sx = new Float32Array(N), sy = new Float32Array(N), st = new Float32Array(N);
    for (i = 0; i < N; i++) { /* fibonacci sphere distribution */
      var y = 1 - (i / (N - 1)) * 2;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var th = i * 2.39996323;
      px[i] = Math.cos(th) * r; py[i] = y; pz[i] = Math.sin(th) * r;
    }
    /* near-neighbour links precomputed once, stored flat as index pairs */
    var links = [];
    for (var a = 0; a < N; a++)
      for (var b = a + 1; b < N; b++)
        if (px[a] * px[b] + py[a] * py[b] + pz[a] * pz[b] > 0.972) links.push(a, b);
    var ry = 0, rx = -0.35, trx = -0.35, mx = 0;
    window.addEventListener('mousemove', function (e) {
      mx = e.clientX / window.innerWidth - 0.5;
      trx = -0.35 + (e.clientY / window.innerHeight - 0.5) * 0.5;
    }, { passive: true });
    return function (t, W, H) {
      ctx.clearRect(0, 0, W, H);
      var dk = isDark();
      var cRed = dk ? 'rgba(239,68,68,' : 'rgba(166,20,20,';
      var cCoral = dk ? 'rgba(255,122,89,' : 'rgba(200,48,28,';
      ry += 0.0022 + mx * 0.003;
      rx += (trx - rx) * 0.05;
      var cosY = Math.cos(ry), sinY = Math.sin(ry);
      var cosX = Math.cos(rx), sinX = Math.sin(rx);
      var R = Math.min(W, H) * 0.55, cx = W / 2, cy = H * 0.44, fov = 2.6;
      for (i = 0; i < N; i++) {
        var x1 = px[i] * cosY + pz[i] * sinY;
        var z1 = -px[i] * sinY + pz[i] * cosY;
        var y1 = py[i] * cosX - z1 * sinX;
        var z2 = py[i] * sinX + z1 * cosX;
        var s = fov / (fov + z2);
        sx[i] = cx + x1 * R * s;
        sy[i] = cy + y1 * R * s * 0.92;
        st[i] = (1 - z2) / 2;
      }
      ctx.lineWidth = 1;
      for (var l = 0; l < links.length; l += 2) {
        var ia = links[l], ib = links[l + 1];
        var d = Math.min(st[ia], st[ib]);
        if (d < 0.25) continue;
        ctx.strokeStyle = cRed + ((dk ? 0.05 : 0.07) + d * (dk ? 0.2 : 0.22)).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(sx[ia], sy[ia]); ctx.lineTo(sx[ib], sy[ib]); ctx.stroke();
      }
      for (i = 0; i < N; i++) {
        ctx.fillStyle = (i % 6 === 0)
          ? cCoral + ((dk ? 0.14 : 0.22) + st[i] * (dk ? 0.6 : 0.62)).toFixed(3) + ')'
          : cRed + ((dk ? 0.10 : 0.16) + st[i] * (dk ? 0.5 : 0.55)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(sx[i], sy[i], 0.8 + st[i] * 1.8, 0, 6.2832);
        ctx.fill();
      }
    };
  });

  /* ═══════ Shared engine for section background canvases ═══════ */
  function canvasAnim(id, setup) {
    var cv = document.getElementById(id);
    if (!cv || !cv.getContext) return;
    if (lowPower) { cv.style.display = 'none'; return; }
    var ctx = cv.getContext('2d');
    var W, H, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function size() {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    var resizeT;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(size, 150);
    });
    var draw = setup(ctx);
    var running = !reduced, rafId = null, t = 0;
    function frame() {
      if (!W || !H) size(); /* recover if the canvas was laid out after init */
      if (W && H) { draw(t, W, H); t++; }
      if (running) rafId = requestAnimationFrame(frame);
    }
    frame(); /* at least one static frame */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (reduced) return;
        var vis = entries[0].isIntersecting;
        if (vis && !running) { running = true; rafId = requestAnimationFrame(frame); }
        else if (!vis && running) { running = false; if (rafId) cancelAnimationFrame(rafId); }
      }).observe(cv);
    }
  }

  /* Services: rolling 3D wave grid — each row's points computed once,
     then reused for both the line pass and the dot pass */
  canvasAnim('bgWave', function (ctx) {
    var COLS = 46, ROWS = 15;
    var xs = new Float32Array(COLS), ys = new Float32Array(COLS);
    return function (t, W, H) {
      ctx.clearRect(0, 0, W, H);
      var dk = isDark();
      var cW = dk ? 'rgba(239,68,68,' : 'rgba(176,20,20,';
      var time = t * 0.014;
      ctx.lineWidth = 1;
      for (var r = 0; r < ROWS; r++) {
        var z = r / (ROWS - 1);              /* 0 = far, 1 = near */
        var spread = 0.52 * (0.35 + 0.65 * z);
        var baseY = H * (0.16 + z * 0.74), amp = H * 0.032 * (0.3 + z);
        for (var c = 0; c < COLS; c++) {
          var x = (c / (COLS - 1) - 0.5) * 2;
          var wave = Math.sin(x * 3.1 + time + z * 4.2) * Math.cos(x * 1.3 - time * 0.7);
          xs[c] = W * (0.5 + x * spread);
          ys[c] = baseY + wave * amp;
        }
        ctx.strokeStyle = cW + ((dk ? 0.06 : 0.06) + z * (dk ? 0.13 : 0.16)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (c = 1; c < COLS; c++) ctx.lineTo(xs[c], ys[c]);
        ctx.stroke();
        ctx.fillStyle = cW + ((dk ? 0.09 : 0.10) + z * (dk ? 0.28 : 0.30)).toFixed(3) + ')';
        for (c = 0; c < COLS; c += 3) {
          ctx.beginPath();
          ctx.arc(xs[c], ys[c], 0.8 + z * 1.3, 0, 6.2832);
          ctx.fill();
        }
      }
    };
  });

  /* About: drifting constellation network */
  canvasAnim('bgAbout', function (ctx) {
    var N = 70;
    var px = new Float32Array(N), py = new Float32Array(N);
    var vx = new Float32Array(N), vy = new Float32Array(N);
    var pr = new Float32Array(N);
    var seeded = false;
    var LINK = 130;
    return function (t, W, H) {
      var i;
      if (!seeded) { /* seed once real dimensions are known */
        for (i = 0; i < N; i++) {
          px[i] = ((i * 733) % 997) / 997 * W;
          py[i] = ((i * 389) % 991) / 991 * H;
          vx[i] = (((i * 7919) % 100) / 100 - 0.5) * 0.4;
          vy[i] = (((i * 104729) % 100) / 100 - 0.5) * 0.4;
          pr[i] = 1 + ((i * 31) % 18) / 10;
        }
        seeded = true;
      }
      ctx.clearRect(0, 0, W, H);
      var dk = isDark();
      var c = dk ? 'rgba(239,68,68,' : 'rgba(166,20,20,';
      for (i = 0; i < N; i++) {
        px[i] += vx[i]; py[i] += vy[i];
        if (px[i] < -20) px[i] = W + 20; else if (px[i] > W + 20) px[i] = -20;
        if (py[i] < -20) py[i] = H + 20; else if (py[i] > H + 20) py[i] = -20;
      }
      ctx.lineWidth = 1;
      for (var a = 0; a < N; a++) {
        for (var b = a + 1; b < N; b++) {
          var dx = px[a] - px[b], dy = py[a] - py[b];
          var d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            var al = (1 - Math.sqrt(d2) / LINK) * (dk ? 0.16 : 0.12);
            ctx.strokeStyle = c + al.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); ctx.stroke();
          }
        }
      }
      for (i = 0; i < N; i++) {
        var tw = 0.7 + 0.3 * Math.sin(t * 0.03 + i);
        ctx.fillStyle = c + ((dk ? 0.42 : 0.32) * tw).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(px[i], py[i], pr[i], 0, 6.2832);
        ctx.fill();
      }
    };
  });

  /* Founders: orbiting rings with satellites */
  canvasAnim('bgOrbits', function (ctx) {
    var rings = [
      { tilt: 0.95, speed: 0.005, radius: 0.46, n: 5, color: '176,20,20', colorD: '239,68,68' },
      { tilt: 2.25, speed: -0.004, radius: 0.36, n: 4, color: '200,48,28', colorD: '255,122,89' },
      { tilt: -0.5, speed: 0.003, radius: 0.55, n: 6, color: '140,12,12', colorD: '220,38,38' }
    ];
    var SEG = 72, fov = 2.8;
    return function (t, W, H) {
      ctx.clearRect(0, 0, W, H);
      var dk = isDark();
      var cx = W / 2, cy = H * 0.46, S = Math.min(W, H) * 0.75;
      for (var ri = 0; ri < rings.length; ri++) {
        var rg = rings[ri];
        var col = dk ? rg.colorD : rg.color;
        var rot = t * rg.speed;
        var cosT = Math.cos(rg.tilt), sinT = Math.sin(rg.tilt);
        var cosR = Math.cos(rot), sinR = Math.sin(rot);
        function pt(a) {
          var x = Math.cos(a) * rg.radius, z = Math.sin(a) * rg.radius;
          var x1 = x * cosR + z * sinR, z1 = -x * sinR + z * cosR;
          var y1 = -z1 * sinT, z2 = z1 * cosT;
          var s = fov / (fov + z2);
          return { x: cx + x1 * S * s, y: cy + y1 * S * s, t: (1 - z2) / 2 };
        }
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i <= SEG; i++) {
          var p = pt((i / SEG) * 6.2832);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(' + col + (dk ? ',0.18)' : ',0.17)');
        ctx.stroke();
        for (i = 0; i < rg.n; i++) {
          p = pt((i / rg.n) * 6.2832 + rot * 2.4);
          ctx.fillStyle = 'rgba(' + col + ',' + ((dk ? 0.16 : 0.17) + p.t * (dk ? 0.4 : 0.42)).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.4 + p.t * 2.4, 0, 6.2832);
          ctx.fill();
        }
      }
    };
  });

  /* Testimonials: drifting starfield with shooting stars */
  canvasAnim('bgStars', function (ctx) {
    var N = 130, stars = [];
    for (var i = 0; i < N; i++) {
      stars.push({
        x: (i * 0.618034) % 1,
        y: ((i * 0.381966 + 0.17) * 1.61803) % 1,
        z: 0.25 + ((i * 7919) % 100) / 133,
        ph: (i * 997) % 63 / 10,
        coral: i % 4 === 0
      });
    }
    var shoot = null;
    return function (t, W, H) {
      ctx.clearRect(0, 0, W, H);
      var dk = isDark();
      for (var i = 0; i < N; i++) {
        var s = stars[i];
        s.x += 0.00005 * s.z;
        if (s.x > 1.02) s.x = -0.02;
        var a = (0.20 + 0.45 * s.z) * (0.55 + 0.45 * Math.sin(t * 0.025 + s.ph)) * (dk ? 1 : 0.75);
        ctx.fillStyle = s.coral
          ? (dk ? 'rgba(255,105,80,' : 'rgba(200,48,28,') + a.toFixed(3) + ')'
          : (dk ? 'rgba(255,155,145,' : 'rgba(166,20,20,') + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, 0.4 + s.z * 1.2, 0, 6.2832);
        ctx.fill();
      }
      if (!shoot && t > 0 && t % 420 === 0) {
        var sy = 0.05 + ((t / 420) * 0.37) % 0.4;
        shoot = { x: 0.15 + ((t / 420) * 0.23) % 0.5, y: sy, life: 0 };
      }
      if (shoot) {
        shoot.life++;
        shoot.x += 0.008; shoot.y += 0.004;
        var fade = 1 - shoot.life / 34;
        if (fade <= 0) { shoot = null; }
        else {
          var x2 = shoot.x * W, y2 = shoot.y * H;
          var g = ctx.createLinearGradient(x2 - 70, y2 - 35, x2, y2);
          g.addColorStop(0, dk ? 'rgba(255,140,110,0)' : 'rgba(200,48,28,0)');
          g.addColorStop(1, dk
            ? 'rgba(255,220,210,' + (0.7 * fade).toFixed(3) + ')'
            : 'rgba(166,20,20,' + (0.55 * fade).toFixed(3) + ')');
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x2 - 70, y2 - 35);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
    };
  });
})();
