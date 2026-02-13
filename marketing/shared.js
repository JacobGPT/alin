/* ALIN — Shared Components & Scripts */

// ===== AUTO-REDIRECT LOGGED-IN USERS =====
// If the user already has a valid auth token, skip marketing and go to the app.
// Only runs on marketing pages; never on /app/ (prevents infinite redirect).
(function() {
  try {
    if (window.location.pathname.startsWith('/app')) return; // already in app
    var raw = localStorage.getItem('alin-auth-storage');
    if (!raw) return;
    var parsed = JSON.parse(raw);
    var token = parsed && parsed.state && parsed.state.token;
    if (token && typeof token === 'string' && token.length > 10) {
      window.location.replace('/app/');
    }
  } catch(e) { /* localStorage or JSON parse failed — stay on marketing */ }
})();

// ===== NAV TEMPLATE =====
function getNav(activePage = '') {
  return `
  <nav class="nav" id="nav">
    <div class="container nav__inner">
      <a href="/m/index.html" class="nav__logo"><span>ALIN</span></a>
      <div class="nav__links">
        <a href="/m/index.html#features" class="nav__link ${activePage==='features'?'nav__link--active':''}">Features</a>
        <a href="/m/index.html#stations" class="nav__link ${activePage==='stations'?'nav__link--active':''}">Stations</a>
        <a href="/m/pricing.html" class="nav__link ${activePage==='pricing'?'nav__link--active':''}">Pricing</a>
        <a href="/m/docs.html" class="nav__link ${activePage==='docs'?'nav__link--active':''}">Docs</a>
        <a href="/m/about.html" class="nav__link ${activePage==='about'?'nav__link--active':''}">About</a>
      </div>
      <div class="nav__auth">
        <a href="/m/login.html" class="nav__signin">Sign in</a>
        <a href="/m/signup.html" class="nav__cta">Get Started</a>
      </div>
      <button class="nav__toggle" id="navToggle" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </div>
    <div class="nav__mobile" id="mobileMenu">
      <div class="nav__mobile-inner">
        <a href="/m/index.html#features" class="nav__mobile-link">Features</a>
        <a href="/m/index.html#stations" class="nav__mobile-link">Stations</a>
        <a href="/m/pricing.html" class="nav__mobile-link">Pricing</a>
        <a href="/m/docs.html" class="nav__mobile-link">Docs</a>
        <a href="/m/about.html" class="nav__mobile-link">About</a>
        <a href="/m/login.html" class="nav__mobile-link">Sign In</a>
        <a href="/m/signup.html" class="nav__mobile-link" style="color:var(--color-primary-400);font-weight:600;">Get Started →</a>
      </div>
    </div>
  </nav>`;
}

// ===== FOOTER TEMPLATE =====
function getFooter() {
  return `
  <footer class="footer">
    <div class="container">
      <div class="footer__grid">
        <div>
          <div class="footer__brand-name">ALIN</div>
          <p class="footer__brand-desc">Advanced Linguistic Intelligence Network — six specialized AI stations working as one unified intelligence.</p>
          <div class="footer__social">
            <a href="#" class="footer__social-link" aria-label="GitHub">GH</a>
            <a href="#" class="footer__social-link" aria-label="Twitter">X</a>
            <a href="#" class="footer__social-link" aria-label="Discord">DC</a>
          </div>
        </div>
        <div>
          <h4 class="footer__col-title">Product</h4>
          <a href="/m/index.html#features" class="footer__link">Features</a>
          <a href="/m/index.html#stations" class="footer__link">Stations</a>
          <a href="/m/pricing.html" class="footer__link">Pricing</a>
          <a href="/m/changelog.html" class="footer__link">Changelog</a>
        </div>
        <div>
          <h4 class="footer__col-title">Resources</h4>
          <a href="/m/docs.html" class="footer__link">Documentation</a>
          <a href="/m/api.html" class="footer__link">API Reference</a>
          <a href="/m/guides.html" class="footer__link">Guides</a>
          <a href="/m/blog.html" class="footer__link">Blog</a>
        </div>
        <div>
          <h4 class="footer__col-title">Company</h4>
          <a href="/m/about.html" class="footer__link">About</a>
          <a href="/m/careers.html" class="footer__link">Careers</a>
          <a href="/m/contact.html" class="footer__link">Contact</a>
          <a href="/m/support.html" class="footer__link">Support</a>
        </div>
      </div>
      <div class="footer__bottom">
        <span>&copy; 2026 ALIN. All rights reserved.</span>
        <div class="footer__bottom-links">
          <a href="/m/privacy.html" class="footer__bottom-link">Privacy</a>
          <a href="/m/terms.html" class="footer__bottom-link">Terms</a>
          <a href="/m/cookies.html" class="footer__bottom-link">Cookies</a>
        </div>
      </div>
    </div>
  </footer>`;
}

// ===== SHARED SCRIPTS =====
function initPage() {
  // Scroll-based nav styling
  const nav = document.getElementById('nav');
  if (nav) window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 16));

  // Mobile toggle
  const toggle = document.getElementById('navToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  if (toggle && mobileMenu) {
    toggle.addEventListener('click', () => { toggle.classList.toggle('active'); mobileMenu.classList.toggle('open'); });
    mobileMenu.querySelectorAll('.nav__mobile-link').forEach(l => l.addEventListener('click', () => { toggle.classList.remove('active'); mobileMenu.classList.remove('open'); }));
  }

  // Scroll animations
  const obs = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }), { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });
  document.querySelectorAll('.animate-on-scroll').forEach(el => obs.observe(el));

  // Smooth anchor scrolling
  document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => { const t = document.querySelector(a.getAttribute('href')); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));

  // FAQ toggles
  document.querySelectorAll('.faq__q').forEach(btn => btn.addEventListener('click', () => btn.closest('.faq__item').classList.toggle('open')));
}
