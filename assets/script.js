/* ============================================================
   STARFIELD — optimized canvas implementation
   Strategy:
   - Single <canvas>, no DOM nodes per star.
   - Star count scales with viewport area (capped) for perf.
   - Each star has its own twinkle phase + speed for shimmer.
   - Stars drift slowly along a vector (parallax-style).
   - DPR capped at 1.5 to keep mobile fillrate sane.
   - Pauses when tab hidden / when reduced-motion preferred.
   ============================================================ */
(function () {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d', { alpha: true });

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  let stars = [];
  let shootingStars = [];
  let nextShootingAt = 0; // ms timestamp when next one can spawn
  let w = 0, h = 0;
  let rafId = null;
  let running = true;

  // Color palette — mostly white with hints of warm/cool
  const palette = [
    [255, 255, 255],
    [255, 245, 220],
    [220, 230, 255],
    [255, 210, 170],
    [200, 215, 255],
  ];

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function makeStar() {
    const color = palette[(Math.random() * palette.length) | 0];
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      // Visual radius in CSS pixels
      r: rand(0.3, 1.8),
      // Twinkle: each star has its own speed and phase — wider range now,
      // so some stars pulse fast and others breathe slowly
      twinkleSpeed: rand(0.0015, 0.006),
      phase: Math.random() * Math.PI * 2,
      // Base brightness — most dim, a few bright
      baseAlpha: Math.random() < 0.2 ? rand(0.75, 1) : rand(0.3, 0.7),
      // Drift — bumped up so motion is actually perceptible
      vx: rand(-0.04, 0.04),
      vy: rand(-0.03, 0.03),
      color,
      // More stars get a glow halo than before
      glow: Math.random() < 0.14,
    };
  }

  // Shooting star: a bright head with a fading tail, sweeping diagonally
  // across the canvas. Short lifespan (~700ms), rare (every 4–10s).
  function makeShootingStar() {
    // Spawn from top edge with a downward-right or downward-left trajectory
    const fromLeft = Math.random() < 0.5;
    const angle = fromLeft
      ? rand(Math.PI * 0.15, Math.PI * 0.35)   // down-right
      : rand(Math.PI * 0.65, Math.PI * 0.85);  // down-left
    const speed = rand(0.9, 1.6); // CSS px per ms — fast
    const life = rand(600, 900);
    return {
      x: fromLeft ? rand(-50, w * 0.5) : rand(w * 0.5, w + 50),
      y: rand(-20, h * 0.35),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life,
      tail: rand(120, 200), // tail length in px
    };
  }

  function resize() {
    w = window.innerWidth;
    h = canvas.parentElement.offsetHeight;
    canvas.width = w * DPR;
    canvas.height = h * DPR;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Star density: ~1 star per 1800px², capped for low-end devices
    const target = Math.min(Math.floor((w * h) / 1800), 320);
    stars = [];
    for (let i = 0; i < target; i++) stars.push(makeStar());
  }

  let lastTime = 0;
  function draw(time) {
    const dt = lastTime ? Math.min(time - lastTime, 50) : 16; // clamp on tab refocus
    lastTime = time;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0, len = stars.length; i < len; i++) {
      const s = stars[i];

      // Twinkle: sinusoidal alpha modulation — wider amplitude so the
      // shimmer is actually visible (was 0.4..1.0, now 0.15..1.0)
      const tw = Math.sin(time * s.twinkleSpeed + s.phase) * 0.5 + 0.5; // 0..1
      const alpha = s.baseAlpha * (0.15 + tw * 0.85);

      // Slow drift
      s.x += s.vx;
      s.y += s.vy;
      if (s.x < -2) s.x = w + 2;
      else if (s.x > w + 2) s.x = -2;
      if (s.y < -2) s.y = h + 2;
      else if (s.y > h + 2) s.y = -2;

      const [r, g, b] = s.color;

      // Glow halo for brightest stars only (cheap radial)
      if (s.glow && alpha > 0.5) {
        const glowR = s.r * 6;
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
        grad.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.35})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Core star
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shooting stars — spawn occasionally
    if (time >= nextShootingAt) {
      shootingStars.push(makeShootingStar());
      nextShootingAt = time + rand(4000, 10000);
    }

    // Update + render shooting stars
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const ss = shootingStars[i];
      ss.age += dt;
      ss.x += ss.vx * dt;
      ss.y += ss.vy * dt;

      if (ss.age >= ss.life || ss.x < -ss.tail || ss.x > w + ss.tail || ss.y > h + ss.tail) {
        shootingStars.splice(i, 1);
        continue;
      }

      // Fade in/out envelope: ramp up quickly, hold, fade out
      const t = ss.age / ss.life;
      const env = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1;
      const alpha = env * 0.95;

      // Tail: linear gradient from head back along reversed velocity
      const len = ss.tail;
      const tx = ss.x - ss.vx * (len / Math.hypot(ss.vx, ss.vy));
      const ty = ss.y - ss.vy * (len / Math.hypot(ss.vx, ss.vy));
      const grad = ctx.createLinearGradient(ss.x, ss.y, tx, ty);
      grad.addColorStop(0, `rgba(255, 245, 220, ${alpha})`);
      grad.addColorStop(0.4, `rgba(255, 210, 122, ${alpha * 0.5})`);
      grad.addColorStop(1, `rgba(255, 210, 122, 0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      // Bright head with a small glow
      const headGrad = ctx.createRadialGradient(ss.x, ss.y, 0, ss.x, ss.y, 6);
      headGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      headGrad.addColorStop(1, `rgba(255, 245, 220, 0)`);
      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.arc(ss.x, ss.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (running) rafId = requestAnimationFrame(draw);
  }

  function start() {
    if (rafId) cancelAnimationFrame(rafId);
    running = true;
    lastTime = 0; // reset so dt is sane on the first frame after a pause
    rafId = requestAnimationFrame(draw);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Init
  resize();
  nextShootingAt = performance.now() + rand(1500, 3500);

  if (prefersReduced) {
    // Render one static frame, no animation
    draw(0);
    running = false;
  } else {
    start();
  }

  // Resize handling (debounced)
  // Mobile browsers fire 'resize' when the URL bar hides/shows on scroll —
  // that changes height but not width. We only regenerate the starfield
  // when the *width* meaningfully changes; otherwise we just resize the
  // canvas and keep the existing stars in place.
  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const newWidth = window.innerWidth;
      const widthChanged = Math.abs(newWidth - lastWidth) > 2;

      if (widthChanged) {
        // Real layout change (orientation, window resize) — full rebuild
        lastWidth = newWidth;
        resize();
        if (prefersReduced) draw(0);
      } else {
        // Height-only change (mobile URL bar) — just resize the canvas,
        // keep the stars where they are
        const newH = canvas.parentElement.offsetHeight;
        if (newH !== h) {
          h = newH;
          canvas.width = w * DPR;
          canvas.height = h * DPR;
          canvas.style.width = w + 'px';
          canvas.style.height = h + 'px';
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          if (prefersReduced) draw(0);
        }
      }
    }, 150);
  });

  // Pause when tab not visible — saves battery
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (!prefersReduced) start();
  });
})();

/* Footer year — keep copyright current automatically */
(function () {
  const yearEl = document.getElementById('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();

/* Mobile nav — custom open/close (replaces Bootstrap collapse so we can
   do a fullscreen overlay with a clean fade rather than a height anim). */
(function () {
  const toggler = document.getElementById('navToggler');
  const menu = document.getElementById('navMenu');
  if (!toggler || !menu) return;

  const setOpen = (open) => {
    menu.classList.toggle('is-open', open);
    toggler.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.documentElement.classList.toggle('menu-open', open);
    document.body.classList.toggle('menu-open', open);
  };

  toggler.addEventListener('click', () => {
    const isOpen = menu.classList.contains('is-open');
    setOpen(!isOpen);
  });

  // Close when a nav link is tapped (so anchor scrolling isn't behind the overlay)
  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => setOpen(false));
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) setOpen(false);
  });

  // If the viewport grows past the mobile breakpoint while open, reset state
  const mq = window.matchMedia('(min-width: 992px)');
  mq.addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
})();

/* Nav background on scroll */
(function () {
  const nav = document.getElementById('mainNav');
  const onScroll = () => {
    if (window.scrollY > 30) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* Apply form — client-side validation + success state
   No backend wired up yet; this just demonstrates UX flow. */
(function () {
  const form = document.getElementById('applyForm');
  const success = document.getElementById('applySuccess');
  const submitBtn = document.getElementById('applySubmit');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = form.artistName.value.trim();
    const email = form.email.value.trim();
    const links = form.links.value.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!name || !emailOk || !links) {
      // Highlight the first invalid field
      if (!name) form.artistName.focus();
      else if (!emailOk) form.email.focus();
      else form.links.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    // TODO: replace with real submission (fetch to your backend or form service)
    setTimeout(() => {
      form.classList.add('form-hidden');
      success.classList.remove('form-hidden');
    }, 600);
  });
})();