/**
 * Motion Engine — Runtime JS and CSS generator for standalone HTML sites.
 *
 * NOT a React component. Pure string generation that outputs vanilla JavaScript
 * and CSS to be injected into generated websites (via <style> / <script> tags).
 *
 * All output is self-contained: zero external dependencies, var-based JS for
 * broad compatibility, and stays under 10KB unminified target.
 */

import type {
  MotionSpec,
  MicroInteractionConfig,
  HeroMotionConfig,
  ParallaxConfig,
  AdvancedMotionConfig,
  GlobalMotionConfig,
} from '../../../types/tbwo';

// ============================================================================
// CSS GENERATION
// ============================================================================

export function generateMotionCSS(spec: MotionSpec): string {
  const parts: string[] = [];

  // ---- 1. Initial states for [data-motion] elements ----
  parts.push(`/* Motion Engine — scroll-reveal initial states */
[data-motion] {
  opacity: 0;
  transition-property: opacity, transform, filter;
  transition-duration: var(--motion-duration-normal);
  transition-timing-function: var(--motion-ease-enter);
}`);

  // ---- 2. Per-animation initial transforms ----
  parts.push(`
[data-motion="fade-up"] { transform: translateY(var(--motion-distance-md)); }
[data-motion="fade-down"] { transform: translateY(calc(var(--motion-distance-md) * -1)); }
[data-motion="fade-left"] { transform: translateX(var(--motion-distance-md)); }
[data-motion="fade-right"] { transform: translateX(calc(var(--motion-distance-md) * -1)); }
[data-motion="zoom-in"] { transform: scale(var(--motion-scale-normal)); }
[data-motion="zoom-out"] { transform: scale(1.1); }
[data-motion="slide-up"] { transform: translateY(var(--motion-distance-lg)); }
[data-motion="slide-down"] { transform: translateY(calc(var(--motion-distance-lg) * -1)); }
[data-motion="slide-left"] { transform: translateX(var(--motion-distance-lg)); }
[data-motion="slide-right"] { transform: translateX(calc(var(--motion-distance-lg) * -1)); }
[data-motion="blur-in"] { transform: translateY(var(--motion-distance-sm)); filter: blur(var(--motion-blur-md)); }
[data-motion="clip-reveal"] { clip-path: inset(0 0 100% 0); transform: none; }
[data-motion="rotate-in"] { transform: rotate(-10deg) scale(0.95); }
[data-motion="flip-up"] { transform: perspective(800px) rotateX(30deg); transform-origin: bottom; }`);

  // ---- 3. Visible state ----
  parts.push(`
[data-motion].motion-visible {
  opacity: 1;
  transform: none;
  filter: none;
  clip-path: none;
}`);

  // ---- 4. Custom duration/delay via data attributes ----
  parts.push(buildDurationDelayCSS());

  // ---- 5. Micro-interaction CSS ----
  parts.push(buildMicroInteractionCSS(spec.microInteractions));

  // ---- 6. Hero animation keyframes ----
  parts.push(buildHeroCSS(spec.heroMotion));

  // ---- 7. Scroll progress bar ----
  if (spec.advanced.scrollProgressBar) {
    const pos = spec.advanced.scrollProgressPosition === 'bottom' ? 'bottom' : 'top';
    const color = spec.advanced.scrollProgressColor || 'var(--color-primary, #3b82f6)';
    parts.push(`
/* Scroll progress bar */
.scroll-progress {
  position: fixed;
  ${pos}: 0;
  left: 0;
  width: 0%;
  height: 3px;
  background: ${color};
  z-index: 9999;
  transition: width 0.1s linear;
  pointer-events: none;
}`);
  }

  // ---- 8. Reduced motion override ----
  parts.push(`
@media (prefers-reduced-motion: reduce) {
  [data-motion] {
    opacity: 1;
    transform: none;
    filter: none;
    clip-path: none;
    transition: none !important;
    animation: none !important;
  }
  .scroll-progress { display: none; }
  .ripple { display: none; }
}`);

  return parts.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// CSS Helpers
// ---------------------------------------------------------------------------

function buildDurationDelayCSS(): string {
  const durations = [200, 300, 400, 500, 600, 800];
  const delays = [100, 200, 300, 400, 500, 600, 800];

  const dLines = durations.map(
    (d) => `[data-motion-duration="${d}"] { transition-duration: ${d}ms; }`
  );
  const delayLines = delays.map(
    (d) => `[data-motion-delay="${d}"] { transition-delay: ${d}ms; }`
  );

  return '\n/* Duration / delay overrides */\n' + dLines.join('\n') + '\n' + delayLines.join('\n');
}

function buildMicroInteractionCSS(mi: MicroInteractionConfig): string {
  const parts: string[] = [];

  // Button hover
  if (mi.buttonHover === 'lift') {
    parts.push(`
.btn:hover, button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}`);
  }
  if (mi.buttonHover === 'glow') {
    parts.push(`
.btn:hover, button:hover {
  box-shadow: 0 0 16px rgba(var(--color-primary-rgb, 59,130,246), 0.5);
  transition: box-shadow 0.25s ease;
}`);
  }
  if (mi.buttonHover === 'fill-slide') {
    parts.push(`
.btn, button {
  background-size: 200% 100%;
  background-position: right center;
  transition: background-position 0.35s ease;
}
.btn:hover, button:hover {
  background-position: left center;
}`);
  }
  if (mi.buttonHover === 'scale') {
    parts.push(`
.btn:hover, button:hover {
  transform: scale(1.05);
  transition: transform 0.2s ease;
}`);
  }

  // Button click — ripple
  if (mi.buttonClick === 'ripple') {
    parts.push(`
.btn, button { position: relative; overflow: hidden; }
.ripple {
  position: absolute;
  border-radius: 50%;
  background: rgba(255,255,255,0.3);
  transform: scale(0);
  animation: ripple-effect 0.6s ease-out;
  pointer-events: none;
}
@keyframes ripple-effect {
  to { transform: scale(4); opacity: 0; }
}`);
  }
  if (mi.buttonClick === 'shrink') {
    parts.push(`
.btn:active, button:active {
  transform: scale(0.95);
  transition: transform 0.1s ease;
}`);
  }

  // Card hover
  if (mi.cardHover === 'lift-shadow') {
    parts.push(`
.card:hover, [data-card]:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.12);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}`);
  }
  if (mi.cardHover === 'tilt-3d') {
    parts.push(`
[data-motion-tilt] {
  transition: transform 0.15s ease;
  will-change: transform;
}`);
  }
  if (mi.cardHover === 'border-glow') {
    parts.push(`
.card:hover, [data-card]:hover {
  box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb, 59,130,246), 0.5), 0 0 20px rgba(var(--color-primary-rgb, 59,130,246), 0.15);
  transition: box-shadow 0.3s ease;
}`);
  }
  if (mi.cardHover === 'scale') {
    parts.push(`
.card:hover, [data-card]:hover {
  transform: scale(1.03);
  transition: transform 0.25s ease;
}`);
  }

  // Nav hover
  if (mi.navHover === 'underline-slide') {
    parts.push(`
nav a {
  position: relative;
}
nav a::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 0;
  height: 2px;
  background: currentColor;
  transition: width 0.3s ease;
}
nav a:hover::after {
  width: 100%;
}`);
  }
  if (mi.navHover === 'background-fill') {
    parts.push(`
nav a {
  transition: background-color 0.25s ease, color 0.25s ease;
  padding: 0.25em 0.5em;
  border-radius: 4px;
}
nav a:hover {
  background-color: rgba(var(--color-primary-rgb, 59,130,246), 0.1);
}`);
  }
  if (mi.navHover === 'scale') {
    parts.push(`
nav a { transition: transform 0.2s ease; display: inline-block; }
nav a:hover { transform: scale(1.08); }`);
  }

  // Link hover
  if (mi.linkHover === 'underline-grow') {
    parts.push(`
a:not(nav a) {
  border-bottom: 0 solid currentColor;
  transition: border-bottom-width 0.2s ease;
  text-decoration: none;
}
a:not(nav a):hover {
  border-bottom-width: 2px;
}`);
  }
  if (mi.linkHover === 'color-shift') {
    parts.push(`
a:not(nav a) {
  transition: color 0.2s ease;
}
a:not(nav a):hover {
  color: var(--color-primary, #3b82f6);
}`);
  }
  if (mi.linkHover === 'highlight') {
    parts.push(`
a:not(nav a) {
  transition: background-color 0.2s ease;
}
a:not(nav a):hover {
  background-color: rgba(var(--color-primary-rgb, 59,130,246), 0.12);
}`);
  }

  // Input focus
  if (mi.inputFocus === 'border-glow') {
    parts.push(`
input:focus, textarea:focus, select:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb, 59,130,246), 0.25);
  border-color: var(--color-primary, #3b82f6);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}`);
  }
  if (mi.inputFocus === 'label-float') {
    parts.push(`
.form-group { position: relative; }
.form-group label {
  position: absolute;
  top: 50%;
  left: 0.75em;
  transform: translateY(-50%);
  transition: all 0.2s ease;
  pointer-events: none;
  color: #999;
}
.form-group input:focus ~ label,
.form-group input:not(:placeholder-shown) ~ label {
  top: -0.5em;
  font-size: 0.75em;
  color: var(--color-primary, #3b82f6);
}`);
  }
  if (mi.inputFocus === 'underline-expand') {
    parts.push(`
input, textarea {
  border: none;
  border-bottom: 2px solid #ccc;
  transition: border-color 0.3s ease;
}
input:focus, textarea:focus {
  outline: none;
  border-bottom-color: var(--color-primary, #3b82f6);
}`);
  }

  // Scroll to top button
  if (mi.scrollToTop === 'fade') {
    parts.push(`
.scroll-to-top {
  position: fixed; bottom: 2rem; right: 2rem;
  opacity: 0; pointer-events: none;
  transition: opacity 0.3s ease;
  z-index: 999;
}
.scroll-to-top.visible { opacity: 1; pointer-events: auto; }`);
  }
  if (mi.scrollToTop === 'slide-up') {
    parts.push(`
.scroll-to-top {
  position: fixed; bottom: 2rem; right: 2rem;
  transform: translateY(100px); opacity: 0; pointer-events: none;
  transition: transform 0.3s ease, opacity 0.3s ease;
  z-index: 999;
}
.scroll-to-top.visible { transform: translateY(0); opacity: 1; pointer-events: auto; }`);
  }

  if (parts.length === 0) return '';
  return '\n/* Micro-interactions */\n' + parts.join('\n');
}

function buildHeroCSS(hero: HeroMotionConfig): string {
  const parts: string[] = [];

  if (hero.backgroundMotion === 'gradient-shift') {
    parts.push(`
@keyframes gradientShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
[data-hero-bg] {
  background-size: 200% 200%;
  animation: gradientShift 8s ease infinite;
}`);
  }

  if (hero.ctaAnimation === 'pulse-glow') {
    parts.push(`
@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 5px rgba(var(--color-primary-rgb, 59,130,246), 0.3); }
  50%      { box-shadow: 0 0 20px rgba(var(--color-primary-rgb, 59,130,246), 0.6); }
}
[data-hero-cta] {
  animation: pulseGlow 2s ease-in-out infinite;
}`);
  }

  if (hero.ctaAnimation === 'bounce-in') {
    parts.push(`
@keyframes bounceIn {
  0%   { transform: scale(0.3); opacity: 0; }
  50%  { transform: scale(1.05); }
  70%  { transform: scale(0.95); }
  100% { transform: scale(1); opacity: 1; }
}`);
  }

  if (hero.headlineAnimation === 'typewriter') {
    parts.push(`
[data-hero-headline] .char {
  display: inline-block;
  opacity: 0;
}
[data-hero-headline] .char.visible {
  opacity: 1;
}`);
  }

  if (hero.headlineAnimation === 'word-reveal') {
    parts.push(`
[data-hero-headline] .word-wrap {
  display: inline-block;
  overflow: hidden;
  vertical-align: bottom;
}
[data-hero-headline] .word {
  display: inline-block;
  transform: translateY(100%);
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
[data-hero-headline] .word.visible {
  transform: translateY(0);
}`);
  }

  if (hero.headlineAnimation === 'char-reveal') {
    parts.push(`
[data-hero-headline] .char {
  display: inline-block;
  opacity: 0;
  transform: translateY(20px) scale(0.8);
  transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
[data-hero-headline] .char.visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}`);
  }

  if (hero.headlineAnimation === 'clip-reveal') {
    parts.push(`
[data-hero-headline] {
  clip-path: inset(0 0 100% 0);
  transition: clip-path 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}
[data-hero-headline].visible {
  clip-path: inset(0);
}`);
  }

  if (parts.length === 0) return '';
  return '\n/* Hero animations */\n' + parts.join('\n');
}

// ============================================================================
// JS GENERATION
// ============================================================================

export function generateMotionJS(spec: MotionSpec): string {
  const modules: string[] = [];

  // ---- Reduced motion guard ----
  modules.push(`  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function(e) { reducedMotion = e.matches; });
  if (reducedMotion) return;`);

  // ---- ScrollReveal module ----
  if (spec.global.scrollRevealEnabled) {
    modules.push(buildScrollRevealJS(spec.global));
  }

  // ---- MicroInteractions module ----
  modules.push(buildMicroInteractionsJS(spec.microInteractions));

  // ---- HeroMotion module ----
  modules.push(buildHeroMotionJS(spec.heroMotion));

  // ---- Parallax module ----
  if (spec.parallax.enabled && spec.parallax.layers.length > 0) {
    modules.push(buildParallaxJS(spec.parallax));
  }

  // ---- Advanced features ----
  modules.push(buildAdvancedJS(spec.advanced, spec.microInteractions));

  const body = modules.filter(Boolean).join('\n\n');
  return `(function(){\n${body}\n})();`;
}

// ---------------------------------------------------------------------------
// JS Module Builders
// ---------------------------------------------------------------------------

function buildScrollRevealJS(global: GlobalMotionConfig): string {
  const threshold = global.viewportThreshold ?? 0.15;
  const triggerOnce = global.triggerOnce !== false;

  return `  // ScrollReveal
  (function() {
    var threshold = ${threshold};
    var triggerOnce = ${triggerOnce};
    var staggerDelay = ${global.staggerDelay || 100};

    function reveal(entries, observer) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) continue;

        var el = entry.target;
        var delay = parseInt(el.getAttribute('data-motion-delay') || '0', 10);

        // Stagger support: parent with data-motion-stagger
        var parent = el.parentElement;
        if (parent && parent.hasAttribute('data-motion-stagger')) {
          var siblings = parent.querySelectorAll('[data-motion]');
          for (var j = 0; j < siblings.length; j++) {
            if (siblings[j] === el) {
              delay += j * staggerDelay;
              break;
            }
          }
        }

        if (delay > 0) {
          (function(target, d) {
            setTimeout(function() { target.classList.add('motion-visible'); }, d);
          })(el, delay);
        } else {
          el.classList.add('motion-visible');
        }

        if (triggerOnce) {
          observer.unobserve(el);
        }
      }
    }

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(reveal, { threshold: threshold });
      var elements = document.querySelectorAll('[data-motion]');
      for (var k = 0; k < elements.length; k++) {
        observer.observe(elements[k]);
      }
    } else {
      // Fallback: show everything immediately
      var all = document.querySelectorAll('[data-motion]');
      for (var f = 0; f < all.length; f++) {
        all[f].classList.add('motion-visible');
      }
    }
  })();`;
}

function buildMicroInteractionsJS(mi: MicroInteractionConfig): string {
  const parts: string[] = [];

  // Ripple on button click
  if (mi.buttonClick === 'ripple') {
    parts.push(`    // Ripple effect
    document.body.addEventListener('click', function(e) {
      var btn = e.target.closest('button, .btn, [class*="btn"]');
      if (!btn) return;
      var rect = btn.getBoundingClientRect();
      var ripple = document.createElement('span');
      ripple.className = 'ripple';
      var size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(ripple);
      setTimeout(function() { ripple.remove(); }, 700);
    });`);
  }

  // 3D tilt on cards
  if (mi.cardHover === 'tilt-3d') {
    parts.push(`    // 3D tilt effect
    document.body.addEventListener('mousemove', function(e) {
      var el = e.target.closest('[data-motion-tilt]');
      if (!el) return;
      var rect = el.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var midX = rect.width / 2;
      var midY = rect.height / 2;
      var rotateY = ((x - midX) / midX) * 12;
      var rotateX = ((midY - y) / midY) * 12;
      el.style.transform = 'perspective(1000px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg)';
    });
    document.body.addEventListener('mouseleave', function(e) {
      var el = e.target.closest('[data-motion-tilt]');
      if (!el) return;
      el.style.transform = '';
    }, true);`);
  }

  if (parts.length === 0) return '';
  return `  // MicroInteractions
  (function() {
${parts.join('\n\n')}
  })();`;
}

function buildHeroMotionJS(hero: HeroMotionConfig): string {
  const parts: string[] = [];

  // Headline animations that require JS (splitting text)
  if (hero.headlineAnimation === 'typewriter') {
    parts.push(`    // Typewriter headline
    var headline = document.querySelector('[data-hero-headline]');
    if (headline) {
      var text = headline.textContent || '';
      headline.textContent = '';
      var chars = [];
      for (var i = 0; i < text.length; i++) {
        var span = document.createElement('span');
        span.className = 'char';
        span.textContent = text[i] === ' ' ? '\\u00A0' : text[i];
        headline.appendChild(span);
        chars.push(span);
      }
      var charDelay = Math.max(30, Math.min(80, ${hero.headlineDuration || 1500} / text.length));
      for (var c = 0; c < chars.length; c++) {
        (function(el, d) {
          setTimeout(function() { el.classList.add('visible'); }, d);
        })(chars[c], c * charDelay);
      }
    }`);
  }

  if (hero.headlineAnimation === 'word-reveal') {
    parts.push(`    // Word-reveal headline
    var headline = document.querySelector('[data-hero-headline]');
    if (headline) {
      var words = (headline.textContent || '').split(/\\s+/);
      headline.textContent = '';
      for (var w = 0; w < words.length; w++) {
        var wrap = document.createElement('span');
        wrap.className = 'word-wrap';
        var inner = document.createElement('span');
        inner.className = 'word';
        inner.textContent = words[w];
        wrap.appendChild(inner);
        headline.appendChild(wrap);
        if (w < words.length - 1) headline.appendChild(document.createTextNode(' '));
        (function(el, d) {
          setTimeout(function() { el.classList.add('visible'); }, d);
        })(inner, 200 + w * 120);
      }
    }`);
  }

  if (hero.headlineAnimation === 'char-reveal') {
    parts.push(`    // Char-reveal headline (spring-like)
    var headline = document.querySelector('[data-hero-headline]');
    if (headline) {
      var text = headline.textContent || '';
      headline.textContent = '';
      for (var i = 0; i < text.length; i++) {
        var span = document.createElement('span');
        span.className = 'char';
        span.textContent = text[i] === ' ' ? '\\u00A0' : text[i];
        headline.appendChild(span);
        (function(el, d) {
          setTimeout(function() { el.classList.add('visible'); }, d);
        })(span, 100 + i * 40);
      }
    }`);
  }

  if (hero.headlineAnimation === 'clip-reveal') {
    parts.push(`    // Clip-reveal headline
    var headline = document.querySelector('[data-hero-headline]');
    if (headline) {
      setTimeout(function() { headline.classList.add('visible'); }, 200);
    }`);
  }

  if (hero.headlineAnimation === 'fade-up') {
    parts.push(`    // Fade-up headline
    var headline = document.querySelector('[data-hero-headline]');
    if (headline) {
      headline.style.opacity = '0';
      headline.style.transform = 'translateY(20px)';
      headline.style.transition = 'opacity ${hero.headlineDuration || 600}ms ease, transform ${hero.headlineDuration || 600}ms ease';
      setTimeout(function() {
        headline.style.opacity = '1';
        headline.style.transform = 'translateY(0)';
      }, 100);
    }`);
  }

  // Sub-headline animation
  if (hero.headlineAnimation !== 'none') {
    parts.push(`    // Sub-headline delay
    var subheadline = document.querySelector('[data-hero-subheadline]');
    if (subheadline) {
      subheadline.style.opacity = '0';
      subheadline.style.transform = 'translateY(12px)';
      subheadline.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      setTimeout(function() {
        subheadline.style.opacity = '1';
        subheadline.style.transform = 'translateY(0)';
      }, ${hero.subheadlineDelay || 600});
    }`);
  }

  // CTA animation
  if (hero.ctaAnimation !== 'none') {
    const ctaDelay = hero.ctaDelay || 1000;
    if (hero.ctaAnimation === 'slide-up' || hero.ctaAnimation === 'fade-in') {
      parts.push(`    // CTA entrance
    var cta = document.querySelector('[data-hero-cta]');
    if (cta) {
      cta.style.opacity = '0';
      cta.style.transform = '${hero.ctaAnimation === 'slide-up' ? 'translateY(20px)' : 'none'}';
      cta.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      setTimeout(function() {
        cta.style.opacity = '1';
        cta.style.transform = 'none';
      }, ${ctaDelay});
    }`);
    }
    if (hero.ctaAnimation === 'bounce-in') {
      parts.push(`    // CTA bounce-in
    var cta = document.querySelector('[data-hero-cta]');
    if (cta) {
      cta.style.opacity = '0';
      cta.style.transform = 'scale(0.3)';
      setTimeout(function() {
        cta.style.animation = 'bounceIn 0.6s forwards';
      }, ${ctaDelay});
    }`);
    }
    // pulse-glow is CSS-only (keyframe animation applied via CSS)
  }

  if (parts.length === 0) return '';
  return `  // HeroMotion
  document.addEventListener('DOMContentLoaded', function() {
${parts.join('\n\n')}
  });`;
}

function buildParallaxJS(parallax: ParallaxConfig): string {
  const layersJSON = JSON.stringify(
    parallax.layers.map((l) => ({
      selector: l.selector,
      speed: l.speed,
      direction: l.direction,
      clamp: l.clamp,
    }))
  );
  const maxSpeed = parallax.maxSpeed || 1;

  return `  // Parallax
  (function() {
    var layers = ${layersJSON};
    var maxSpeed = ${maxSpeed};
    var running = true;
    var ticking = false;

    document.addEventListener('visibilitychange', function() {
      running = !document.hidden;
    });

    function update() {
      if (!running) { ticking = false; return; }
      var scrollY = window.pageYOffset || document.documentElement.scrollTop;
      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var els = document.querySelectorAll(layer.selector);
        if (!els.length) continue;
        var speed = Math.min(layer.speed, maxSpeed);
        var offset = scrollY * speed;
        if (layer.clamp) {
          offset = Math.max(-200, Math.min(200, offset));
        }
        var transform = layer.direction === 'horizontal'
          ? 'translate3d(' + offset + 'px, 0, 0)'
          : 'translate3d(0, ' + offset + 'px, 0)';
        for (var j = 0; j < els.length; j++) {
          els[j].style.transform = transform;
        }
      }
      ticking = false;
    }

    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
  })();`;
}

function buildAdvancedJS(
  advanced: AdvancedMotionConfig,
  mi: MicroInteractionConfig
): string {
  const parts: string[] = [];

  // Scroll progress bar
  if (advanced.scrollProgressBar) {
    parts.push(`    // Scroll progress bar
    (function() {
      var bar = document.createElement('div');
      bar.className = 'scroll-progress';
      document.body.appendChild(bar);
      var ticking = false;
      function updateProgress() {
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        var docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        bar.style.width = pct + '%';
        ticking = false;
      }
      window.addEventListener('scroll', function() {
        if (!ticking) {
          requestAnimationFrame(updateProgress);
          ticking = true;
        }
      }, { passive: true });
    })();`);
  }

  // Animated counters
  if (advanced.animatedCounters) {
    const duration = advanced.counterDuration || 2000;
    const easing = advanced.counterEasing || 'ease-out';
    parts.push(`    // Animated counters
    (function() {
      var duration = ${duration};
      var easingFn = ${easing === 'linear'
        ? 'function(t) { return t; }'
        : easing === 'spring'
          ? 'function(t) { return 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 1.5); }'
          : 'function(t) { return 1 - Math.pow(1 - t, 3); }'};

      function animateCounter(el) {
        var target = parseFloat(el.getAttribute('data-counter') || '0');
        var prefix = el.getAttribute('data-counter-prefix') || '';
        var suffix = el.getAttribute('data-counter-suffix') || '';
        var decimals = (String(target).split('.')[1] || '').length;
        var start = performance.now();
        function tick(now) {
          var elapsed = now - start;
          var progress = Math.min(elapsed / duration, 1);
          var value = easingFn(progress) * target;
          el.textContent = prefix + value.toFixed(decimals) + suffix;
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }

      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function(entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
              animateCounter(entries[i].target);
              observer.unobserve(entries[i].target);
            }
          }
        }, { threshold: 0.3 });
        var counters = document.querySelectorAll('[data-counter]');
        for (var c = 0; c < counters.length; c++) {
          observer.observe(counters[c]);
        }
      }
    })();`);
  }

  // Smooth anchor scroll
  if (advanced.smoothAnchorScroll) {
    parts.push(`    // Smooth anchor scroll
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      var hash = link.getAttribute('href');
      if (!hash || hash === '#') return;
      var target = document.querySelector(hash);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (history.pushState) history.pushState(null, '', hash);
    });`);
  }

  // Scroll to top button logic
  if (mi.scrollToTop === 'fade' || mi.scrollToTop === 'slide-up') {
    parts.push(`    // Scroll to top visibility
    (function() {
      var btn = document.querySelector('.scroll-to-top');
      if (!btn) return;
      var ticking = false;
      function checkScroll() {
        if (window.pageYOffset > 400) {
          btn.classList.add('visible');
        } else {
          btn.classList.remove('visible');
        }
        ticking = false;
      }
      window.addEventListener('scroll', function() {
        if (!ticking) {
          requestAnimationFrame(checkScroll);
          ticking = true;
        }
      }, { passive: true });
      btn.addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    })();`);
  }

  if (parts.length === 0) return '';
  return `  // Advanced features
  (function() {
${parts.join('\n\n')}
  })();`;
}
