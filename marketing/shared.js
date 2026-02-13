/* ALIN SHARED.JS v5 — Production-Grade Interactive Systems
   40+ functions · text scramble · gradient borders · back-to-top
   slider fills · eased counters · light tilt · keyboard nav
   ============================================================ */

// Auto-redirect logged-in users
(function(){try{const d=JSON.parse(localStorage.getItem('alin-auth-storage')||'{}');if(d.state&&d.state.token&&!location.pathname.startsWith('/app'))location.href='/app/'}catch(e){}})();

// ===== 1. NAV TEMPLATE =====
function getNav(activePage){
  const links=[['features','Features','features.html'],['stations','Stations','stations.html'],['pricing','Pricing','pricing.html'],['docs','Docs','docs.html'],['about','About','about.html']];
  const nl=links.map(([id,l,h])=>`<a href="${h}" class="nav__link${activePage===id?' active':''}" data-page="${h}">${l}</a>`).join('');
  return `<nav class="nav" id="nav"><div class="wrap nav__inner"><a href="index.html" class="nav__logo" data-page="index.html"><span>ALIN</span></a><div class="nav__links">${nl}</div><div class="nav__auth"><a href="login.html" class="nav__signin" data-page="login.html">Sign in</a><a href="signup.html" class="nav__cta" data-page="signup.html">Get Started</a></div><button class="nav__toggle" id="navToggle" aria-label="Toggle menu"><span></span><span></span><span></span></button></div></nav><div class="nav__mobile" id="navMobile">${links.map(([id,l,h])=>`<a href="${h}" class="nav__link${activePage===id?' active':''}" data-page="${h}">${l}</a>`).join('')}<div class="nav__auth"><a href="login.html" class="btn btn--secondary btn--full" data-page="login.html">Sign in</a><a href="signup.html" class="btn btn--primary btn--full" data-page="signup.html">Get Started</a></div></div>`;
}

// ===== 2. FOOTER TEMPLATE =====
function getFooter(){
  return `<footer class="footer"><div class="wrap"><div class="footer__grid"><div><div class="footer__brand-name">ALIN</div><p class="footer__brand-desc">Your AI command center. Chat, build, research, deploy — one platform that remembers, learns, and delivers.</p><div class="footer__social"><a href="#" class="footer__social-link" aria-label="GitHub">GH</a><a href="#" class="footer__social-link" aria-label="Twitter">X</a><a href="#" class="footer__social-link" aria-label="Discord">DC</a></div></div><div><h4 class="footer__col-title">Product</h4><a href="features.html" class="footer__link" data-page="features.html">Features</a><a href="stations.html" class="footer__link" data-page="stations.html">Stations</a><a href="pricing.html" class="footer__link" data-page="pricing.html">Pricing</a><a href="changelog.html" class="footer__link" data-page="changelog.html">Changelog</a></div><div><h4 class="footer__col-title">Resources</h4><a href="docs.html" class="footer__link" data-page="docs.html">Documentation</a><a href="api.html" class="footer__link" data-page="api.html">API Reference</a><a href="guides.html" class="footer__link" data-page="guides.html">Guides</a><a href="blog.html" class="footer__link" data-page="blog.html">Blog</a></div><div><h4 class="footer__col-title">Company</h4><a href="about.html" class="footer__link" data-page="about.html">About</a><a href="careers.html" class="footer__link" data-page="careers.html">Careers</a><a href="contact.html" class="footer__link" data-page="contact.html">Contact</a><a href="support.html" class="footer__link" data-page="support.html">Support</a></div></div><div class="footer__bottom"><span>&copy; 2026 ALIN. All rights reserved.</span><div class="footer__bottom-links"><a href="privacy.html" class="footer__bottom-link" data-page="privacy.html">Privacy</a><a href="terms.html" class="footer__bottom-link" data-page="terms.html">Terms</a><a href="cookies.html" class="footer__bottom-link" data-page="cookies.html">Cookies</a></div></div></div></footer>`;
}

// ===== 3. INIT PAGE (master orchestrator) =====
let transOverlay;
function initPage(){
  // Inject infrastructure elements
  if(!document.getElementById('cursor')){
    const c=document.createElement('div');c.id='cursor';document.body.appendChild(c);
    const d=document.createElement('div');d.id='cursorDot';document.body.appendChild(d);
  }
  if(!document.getElementById('scrollProgress')){const s=document.createElement('div');s.id='scrollProgress';document.body.appendChild(s)}
  if(!document.getElementById('particles')){const cv=document.createElement('canvas');cv.id='particles';document.body.prepend(cv)}
  if(!document.querySelector('.page-transition-overlay')){transOverlay=document.createElement('div');transOverlay.className='page-transition-overlay';document.body.appendChild(transOverlay)}
  else{transOverlay=document.querySelector('.page-transition-overlay')}

  // Inject favicon
  if(!document.querySelector('link[rel="icon"]')){
    const f=document.createElement('link');f.rel='icon';
    f.href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%2310b981"/><stop offset="100%" stop-color="%2334d399"/></linearGradient></defs><text x="4" y="26" font-family="system-ui" font-weight="900" font-size="28" fill="url(%23g)">A</text></svg>';
    document.head.appendChild(f);
  }

  // Core systems
  initCursor();initScrollProgress();initParticles();initScrollReveals();
  initNavScroll();initNavMobile();initSmoothScroll();initTilt();
  initSpotlight();initMagnetic();initRipples();initParallax();
  initCounters();initDeploySteps();initFAQ();
  initPageTransitions();initFeedback();initPlayground();
  // v5 additions
  initSliderFill();initEasedCounters();initSmoothParallax();initLightTilt();
  initBackToTop();initTextScrambleHover();initGradBorderScroll();

  // FOUC prevention
  requestAnimationFrame(()=>document.body.classList.add('loaded'));
}

// ===== 4. CUSTOM CURSOR =====
function initCursor(){
  const cursor=document.getElementById('cursor'),dot=document.getElementById('cursorDot');
  if(!cursor||!dot||window.matchMedia('(pointer:coarse)').matches)return;
  let cx=0,cy=0,dx=0,dy=0;
  document.addEventListener('mousemove',e=>{dx=e.clientX;dy=e.clientY});
  (function anim(){cx+=(dx-cx)*.15;cy+=(dy-cy)*.15;cursor.style.left=cx+'px';cursor.style.top=cy+'px';dot.style.left=dx+'px';dot.style.top=dy+'px';requestAnimationFrame(anim)})();
  // Comprehensive hover selector — covers all interactive card types across pages
  const sel='a,button,[onclick],[data-tilt],[data-tilt-light],.f-card,.m-card,.ability,.pg-chip,.pg-send,.s-card,.p-card,.t-card,.blog-card,.faq__q,.nav__link,.footer__link,.sw-tab,.mock-img,.mock-source,.host-card,.calc__slider,.vs__dot,.show-card,.value-card,.stack-badge,.cmd-item,.cmd-trigger,.docs-card,.docs-nav__link,.sc-card,.back-to-top,input[type="range"]';
  document.addEventListener('mouseover',e=>{if(e.target.closest(sel))cursor.classList.add('hover')});
  document.addEventListener('mouseout',e=>{if(e.target.closest(sel))cursor.classList.remove('hover')});
  document.addEventListener('mousedown',()=>cursor.classList.add('click'));
  document.addEventListener('mouseup',()=>cursor.classList.remove('click'));
}

// ===== 5. SCROLL PROGRESS =====
function initScrollProgress(){
  const bar=document.getElementById('scrollProgress');if(!bar)return;
  window.addEventListener('scroll',()=>{const h=document.documentElement.scrollHeight-window.innerHeight;bar.style.width=h>0?(scrollY/h*100)+'%':'0'},{passive:true});
}

// ===== 6. PARTICLE SYSTEM =====
function initParticles(){
  const c=document.getElementById('particles');if(!c)return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const ctx=c.getContext('2d');let w,h,ps=[],mx=0,my=0;
  function resize(){w=c.width=innerWidth;h=c.height=innerHeight}resize();
  addEventListener('resize',resize);addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY});
  class P{constructor(){this.x=Math.random()*w;this.y=Math.random()*h;this.vx=(Math.random()-.5)*.25;this.vy=(Math.random()-.5)*.25;this.r=Math.random()*1.5+.5;this.a=Math.random()*.25+.08}
  update(){this.x+=this.vx;this.y+=this.vy;if(this.x<0)this.x=w;if(this.x>w)this.x=0;if(this.y<0)this.y=h;if(this.y>h)this.y=0;const dx=this.x-mx,dy=this.y-my,d=Math.sqrt(dx*dx+dy*dy);if(d<160&&d>0){const f=(160-d)/160*.012;this.vx+=dx/d*f;this.vy+=dy/d*f}this.vx*=.999;this.vy*=.999}
  draw(){ctx.beginPath();ctx.arc(this.x,this.y,this.r,0,Math.PI*2);ctx.fillStyle=`rgba(16,185,129,${this.a})`;ctx.fill()}}
  for(let i=0;i<40;i++)ps.push(new P());
  (function anim(){ctx.clearRect(0,0,w,h);ps.forEach(p=>{p.update();p.draw()});
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const dx=ps[i].x-ps[j].x,dy=ps[i].y-ps[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<130){ctx.beginPath();ctx.moveTo(ps[i].x,ps[i].y);ctx.lineTo(ps[j].x,ps[j].y);ctx.strokeStyle=`rgba(16,185,129,${(1-d/130)*.05})`;ctx.lineWidth=.5;ctx.stroke()}}
  requestAnimationFrame(anim)})();
}

// ===== 7. SCROLL REVEALS =====
function initScrollReveals(){
  const obs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.05,rootMargin:'0px 0px -50px 0px'});
  document.querySelectorAll('.reveal,.reveal-left,.reveal-right,.reveal-scale,.animate-on-scroll,.depth-card').forEach(el=>obs.observe(el));
}

// ===== 8. NAV SCROLL =====
function initNavScroll(){const n=document.getElementById('nav');if(!n)return;addEventListener('scroll',()=>n.classList.toggle('scrolled',scrollY>16),{passive:true})}

// ===== 9. MOBILE NAV =====
function initNavMobile(){
  const t=document.getElementById('navToggle'),m=document.getElementById('navMobile');if(!t||!m)return;
  t.addEventListener('click',()=>{t.classList.toggle('open');m.classList.toggle('open')});
  m.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{t.classList.remove('open');m.classList.remove('open')}));
}

// ===== 10. SMOOTH SCROLL =====
function initSmoothScroll(){
  document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{const h=a.getAttribute('href');if(h==='#')return;const t=document.querySelector(h);if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'})}}));
}

// ===== 11. 3D TILT =====
function initTilt(){
  if(window.matchMedia('(pointer:coarse)').matches||window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  document.querySelectorAll('[data-tilt]').forEach(card=>{
    const origTransition=getComputedStyle(card).transition;
    card.addEventListener('mouseenter',()=>{
      // Kill transform transition so tilt tracks mouse instantly
      card.style.transition='border-color .35s, box-shadow .35s, background .35s, opacity .35s';
    });
    card.addEventListener('mousemove',e=>{
      const r=card.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      const cx=r.width/2,cy=r.height/2;
      const rotY=((x-cx)/cx)*6,rotX=((cy-y)/cy)*6;
      card.style.transform=`perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-2px)`;
      card.style.setProperty('--mx',x+'px');card.style.setProperty('--my',y+'px');
    });
    card.addEventListener('mouseleave',()=>{
      // Restore transition so it eases back smoothly
      card.style.transition='';
      card.style.transform='';
      card.style.setProperty('--mx','50%');card.style.setProperty('--my','50%');
    });
  });
}

// ===== 12. SPOTLIGHT (mouse radial gradient) =====
function initSpotlight(){
  if(window.matchMedia('(pointer:coarse)').matches)return;
  const sel='.signal,.ability,.split__visual,.compare-table,.playground,.p-card,.s-card,.t-card,.blog-card,.m-card:not([data-tilt]),.host-card,.calc,.vs__bar,.cmp,.value-card:not([data-tilt]),.show-card:not([data-tilt]),.docs-card:not([data-tilt]),.f-card:not([data-tilt])';
  document.querySelectorAll(sel).forEach(el=>{
    el.addEventListener('mousemove',e=>{const r=el.getBoundingClientRect();el.style.setProperty('--mx',(e.clientX-r.left)+'px');el.style.setProperty('--my',(e.clientY-r.top)+'px')});
  });
}

// ===== 13. MAGNETIC BUTTONS =====
function initMagnetic(){
  if(window.matchMedia('(pointer:coarse)').matches)return;
  document.querySelectorAll('[data-magnetic]').forEach(btn=>{
    btn.addEventListener('mousemove',e=>{
      const r=btn.getBoundingClientRect();
      const x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;
      btn.style.transform=`translate(${x*.2}px,${y*.2}px) scale(1.03)`;
    });
    btn.addEventListener('mouseleave',()=>{btn.style.transform=''});
  });
}

// ===== 14. CLICK RIPPLES =====
function initRipples(){
  document.querySelectorAll('.btn').forEach(btn=>{
    btn.addEventListener('click',function(e){
      const rip=document.createElement('span');rip.classList.add('ripple');
      const r=this.getBoundingClientRect(),sz=Math.max(r.width,r.height);
      rip.style.width=rip.style.height=sz+'px';
      rip.style.left=(e.clientX-r.left-sz/2)+'px';
      rip.style.top=(e.clientY-r.top-sz/2)+'px';
      this.appendChild(rip);setTimeout(()=>rip.remove(),600);
    });
  });
}

// ===== 15. PARALLAX =====
function initParallax(){
  const els=document.querySelectorAll('[data-parallax]');if(!els.length)return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  addEventListener('scroll',()=>{const sy=scrollY;els.forEach(el=>{el.style.transform=`translateY(${sy*parseFloat(el.dataset.parallax)}px)`})},{passive:true});
}

// ===== 16. ANIMATED COUNTERS (basic) =====
function initCounters(){
  const obs=new IntersectionObserver(es=>{es.forEach(e=>{
    if(!e.isIntersecting)return;
    const el=e.target,target=parseInt(el.dataset.target),suffix=el.dataset.suffix||'';
    let cur=0;const step=Math.ceil(target/40);
    const timer=setInterval(()=>{cur+=step;if(cur>=target){cur=target;clearInterval(timer)}el.textContent=cur.toLocaleString()+suffix},30);
    obs.unobserve(el);
  })},{threshold:.5});
  document.querySelectorAll('.counter').forEach(c=>obs.observe(c));
}

// ===== 17. DEPLOY STEP ANIMATION =====
function initDeploySteps(){
  const dv=document.getElementById('deployVisual');if(!dv)return;
  const obs=new IntersectionObserver(es=>{es.forEach(e=>{
    if(!e.isIntersecting)return;
    e.target.querySelectorAll('.deploy-step').forEach((s,i)=>setTimeout(()=>s.classList.add('visible'),i*400));
    obs.unobserve(e.target);
  })},{threshold:.3});
  obs.observe(dv);
}

// ===== 18. FAQ ACCORDION =====
function initFAQ(){
  document.querySelectorAll('.faq__q').forEach(q=>{
    q.addEventListener('click',()=>{
      const item=q.closest('.faq__item'),wasOpen=item.classList.contains('open');
      // Close all in same FAQ list
      const parent=item.parentElement;
      if(parent)parent.querySelectorAll('.faq__item.open').forEach(i=>i.classList.remove('open'));
      if(!wasOpen)item.classList.add('open');
    });
  });
}

// ===== 19. PAGE TRANSITIONS =====
function initPageTransitions(){
  if(!transOverlay){transOverlay=document.querySelector('.page-transition-overlay')}
  document.addEventListener('click',e=>{
    const link=e.target.closest('a[data-page]');
    if(!link)return;
    const href=link.getAttribute('href')||link.dataset.page;
    if(!href||href.startsWith('#')||href.startsWith('http')||href.startsWith('mailto'))return;
    // Don't transition to current page
    const current=location.pathname.split('/').pop()||'index.html';
    if(href===current)return;
    e.preventDefault();
    if(transOverlay){transOverlay.classList.add('active');setTimeout(()=>{location.href=href},250)}
    else{location.href=href}
  });
}

// ===== 20. FEEDBACK WIDGET =====
function initFeedback(){
  document.querySelectorAll('.feedback__btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const fb=btn.closest('.feedback');
      fb.querySelectorAll('.feedback__btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const thanks=fb.querySelector('.feedback__thanks');
      if(thanks)thanks.classList.add('show');
    });
  });
}

// ===== 21. EXPANDABLE FEATURE CARDS =====
function toggleCard(card){
  if(typeof card==='string')card=document.querySelector(card);
  if(!card)return;
  const wasOpen=card.classList.contains('open');
  document.querySelectorAll('.f-card.open').forEach(c=>c.classList.remove('open'));
  if(!wasOpen)card.classList.add('open');
}

// ===== 22. TOGGLE ABILITIES (with safe btn reference) =====
function toggleAbilities(btn){
  const grid=document.querySelector('.more-abilities__grid');
  if(!grid)return;
  grid.classList.toggle('open');
  // Handle both button element and event object
  const button=btn instanceof HTMLElement?btn:(btn&&btn.target?btn.target.closest('button'):null);
  if(button)button.textContent=grid.classList.contains('open')?'Show less':'Show all capabilities';
  if(grid.classList.contains('open')){
    grid.querySelectorAll('.ability').forEach((a,i)=>setTimeout(()=>a.classList.add('visible'),i*60));
  }
}

// ===== 23. MODEL EXPANSION =====
function toggleModels(){
  const exp=document.querySelector('.models__expanded');if(!exp)return;
  exp.classList.toggle('open');
}

// ===== 24. PLAYGROUND SIMULATION =====
function initPlayground(){
  const pg=document.querySelector('.playground');if(!pg)return;
  const msgs=pg.querySelector('.pg-messages'),status=pg.querySelector('.pg-status'),input=pg.querySelector('.pg-input'),send=pg.querySelector('.pg-send');
  const chips=pg.querySelectorAll('.pg-chip');

  const responses=[
    {match:['portfolio','photo'],steps:['Planning layout...','Writing HTML/CSS/JS...','Generating hero image...','Deploying to CDN...'],reply:'Done! Your portfolio is live at alex.alinai.dev — 4 pages, dark theme, masonry gallery, contact form. Want any changes?'},
    {match:['landing','saas','startup'],steps:['Designing conversion flow...','Writing HTML + Tailwind CSS...','Building pricing table...','Deploying to startup.alinai.dev...'],reply:'SaaS landing page deployed! Hero with gradient CTA, 3-tier pricing table, testimonials, FAQ accordion. Live at startup.alinai.dev'},
    {match:['research','compare','best','ai tool'],steps:['Searching Brave API...','Reading 8 sources...','Cross-referencing data...','Compiling report...'],reply:'Research complete! Compared 5 platforms across 12 criteria. Cursor leads in market share, but ALIN wins on deploy-to-live pipeline. Full report with 8 citations attached.'},
    {match:['python','script','csv','data'],steps:['Creating analysis.py...','Importing pandas, matplotlib...','Processing data...','Generating 4 charts...'],reply:'Script complete! Loaded 2,847 rows, cleaned 23 null values, generated bar chart, scatter plot, histogram, and correlation matrix. Files saved to workspace.'},
    {match:['refactor','jwt','auth'],steps:['Scanning codebase...','Mapping auth flow...','Editing 8 files...','Running tests — 47/47 ✓'],reply:'TBWO complete. Replaced session auth with JWT across 8 files. All 47 tests passing. Structured receipt attached.'},
    {match:['logo','image','generate'],steps:['Crafting DALL-E prompt...','Generating 3 variations...','Uploading to CDN...'],reply:'3 logo variations ready on Cloudflare Images CDN. Each in 1024×1024 with transparent background. Want refinements?'},
    {match:['restaurant','menu','food','cafe'],steps:['Extracting menu info...','Designing layout...','Adding map embed...','Deploying to CDN...'],reply:'Restaurant site deployed! Full-bleed hero, tabbed menu, location map, and reservation CTA. Live at cafe.alinai.dev'},
    {match:['blog','article','write'],steps:['Planning content structure...','Writing 3 sample posts...','Styling reading layout...','Building RSS feed...'],reply:'Blog site ready at blog.alinai.dev — responsive reading layout, syntax highlighting, estimated read times, and RSS feed. 3 sample posts included.'}
  ];

  function findResponse(text){
    const l=text.toLowerCase();
    for(const r of responses){if(r.match.some(m=>l.includes(m)))return r}
    return{steps:['Analyzing request...','Planning approach...','Executing...','Finalizing...'],reply:'Task complete! This is a simulation — sign up to see ALIN handle this for real.'};
  }

  function addMsg(type,text){
    const d=document.createElement('div');d.className='pg-msg pg-msg--'+type;d.textContent=text;
    msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;
  }

  let busy=false;
  function simulate(prompt){
    if(busy)return;busy=true;
    const r=findResponse(prompt);
    addMsg('user',prompt);
    status.textContent='Thinking...';status.classList.add('thinking');
    const aiMsg=addMsg('ai','Working on it...');

    let i=0;
    const stepInterval=setInterval(()=>{
      if(i<r.steps.length){
        const s=document.createElement('span');s.className='pg-msg-step';s.textContent='⚡ '+r.steps[i];
        aiMsg.appendChild(s);msgs.scrollTop=msgs.scrollHeight;i++;
      } else {
        clearInterval(stepInterval);aiMsg.childNodes[0].textContent=r.reply;
        status.textContent='Ready';status.classList.remove('thinking');busy=false;
      }
    },800);
  }

  // Bind chips
  chips.forEach(chip=>chip.addEventListener('click',()=>{
    const prompt=chip.dataset.prompt||chip.textContent.replace(/^[^\w]+/,'').trim();
    simulate(prompt);
  }));
  if(send)send.addEventListener('click',()=>{if(input&&input.value.trim()){simulate(input.value.trim());input.value=''}});
  if(input)input.addEventListener('keydown',e=>{if(e.key==='Enter'&&input.value.trim()){simulate(input.value.trim());input.value=''}});
}

// Global fallback for inline onclick playground calls
function sendPlayground(text){
  const pg=document.querySelector('.playground');if(!pg)return;
  const input=pg.querySelector('.pg-input');
  if(input){input.value=text;input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))}
}

// ===== 25. TYPING ANIMATION (hero code block) =====
function initTyping(){
  const lines=document.querySelectorAll('.typed-line');if(!lines.length)return;
  lines.forEach((line,i)=>{
    const text=line.textContent;line.textContent='';
    setTimeout(()=>{
      let ci=0;
      const typer=setInterval(()=>{
        line.textContent=text.substring(0,ci+1);ci++;
        if(ci>=text.length){clearInterval(typer);line.classList.add('done');line.style.borderRight='2px solid transparent'}
      },35);
    },i*1200);
  });
}

// ===== 26. TOAST SYSTEM =====
function showToast(msg,type='success'){
  const t=document.createElement('div');t.className='toast toast--'+type;t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),300)},3000);
}

// ===== 27. BREADCRUMB GENERATOR =====
function getBreadcrumb(items){
  return '<div class="breadcrumb">'+items.map((item,i)=>{
    if(i===items.length-1)return `<span style="color:var(--text-2)">${item.label}</span>`;
    return `<a href="${item.href}" data-page="${item.href}">${item.label}</a><span class="breadcrumb__sep">/</span>`;
  }).join('')+'</div>';
}

// ===== 28. SCROLL TO SECTION HELPER =====
function scrollToSection(id){
  const el=document.getElementById(id);
  if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
}

// ===== 29. SLIDER FILL TRACKING =====
function initSliderFill(){
  document.querySelectorAll('input[type="range"]').forEach(slider=>{
    function updateFill(){
      const min=parseFloat(slider.min)||0,max=parseFloat(slider.max)||100,val=parseFloat(slider.value)||0;
      const pct=((val-min)/(max-min))*100;
      slider.style.setProperty('--fill',pct+'%');
      slider.classList.add('filled');
    }
    updateFill();
    slider.addEventListener('input',updateFill);
  });
}

// ===== 30. TEXT SCRAMBLE EFFECT =====
function scrambleText(el,finalText,duration){
  if(!el)return;
  duration=duration||600;
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*<>[]{}';
  let frame=0;const totalFrames=Math.ceil(duration/30);
  const interval=setInterval(()=>{
    let result='';
    for(let i=0;i<finalText.length;i++){
      if(i<Math.floor((frame/totalFrames)*finalText.length)){result+=finalText[i]}
      else if(finalText[i]===' '){result+=' '}
      else{result+=chars[Math.floor(Math.random()*chars.length)]}
    }
    el.textContent=result;frame++;
    if(frame>=totalFrames){el.textContent=finalText;clearInterval(interval)}
  },30);
}

// ===== 31. TEXT SCRAMBLE ON HOVER (for section titles) =====
function initTextScrambleHover(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  document.querySelectorAll('[data-scramble]').forEach(el=>{
    const original=el.textContent;
    let isScrambling=false;
    el.addEventListener('mouseenter',()=>{
      if(isScrambling)return;isScrambling=true;
      scrambleText(el,original,400);
      setTimeout(()=>{isScrambling=false},500);
    });
  });
}

// ===== 32. ENHANCED ANIMATED COUNTERS (with easing) =====
function initEasedCounters(){
  const obs=new IntersectionObserver(es=>{es.forEach(e=>{
    if(!e.isIntersecting)return;
    const el=e.target,target=parseInt(el.dataset.target),suffix=el.dataset.suffix||'',prefix=el.dataset.prefix||'';
    const duration=parseInt(el.dataset.duration)||1200;
    const startTime=performance.now();
    function easeOut(t){return 1-Math.pow(1-t,3)}
    function animate(now){
      const elapsed=now-startTime;const progress=Math.min(elapsed/duration,1);
      const eased=easeOut(progress);
      const current=Math.round(eased*target);
      el.textContent=prefix+(current>=1000?current.toLocaleString():current)+suffix;
      if(progress<1)requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
    obs.unobserve(el);
  })},{threshold:.5});
  document.querySelectorAll('.counter-eased').forEach(c=>obs.observe(c));
}

// ===== 33. SMOOTH SCROLL PARALLAX (section-based) =====
function initSmoothParallax(){
  const els=document.querySelectorAll('[data-speed]');if(!els.length)return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  window.addEventListener('scroll',()=>{
    const sy=window.scrollY;
    els.forEach(el=>{
      const rect=el.getBoundingClientRect();
      const speed=parseFloat(el.dataset.speed)||0.05;
      const yPos=-(rect.top*speed);
      el.style.transform=`translateY(${yPos}px)`;
    });
  },{passive:true});
}

// ===== 34. HOVER TILT LIGHT (smaller cards) =====
function initLightTilt(){
  if(window.matchMedia('(pointer:coarse)').matches||window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  document.querySelectorAll('[data-tilt-light]').forEach(card=>{
    card.addEventListener('mouseenter',()=>{
      card.style.transition='border-color .35s, box-shadow .35s, background .35s, opacity .35s';
    });
    card.addEventListener('mousemove',e=>{
      const r=card.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      const cx=r.width/2,cy=r.height/2;
      const rotY=((x-cx)/cx)*3,rotX=((cy-y)/cy)*3;
      card.style.transform=`perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
      card.style.setProperty('--mx',x+'px');card.style.setProperty('--my',y+'px');
    });
    card.addEventListener('mouseleave',()=>{
      card.style.transition='';
      card.style.transform='';
      card.style.setProperty('--mx','50%');card.style.setProperty('--my','50%');
    });
  });
}

// ===== 35. BACK TO TOP BUTTON =====
function initBackToTop(){
  let btn=document.querySelector('.back-to-top');
  if(!btn){
    btn=document.createElement('button');
    btn.className='back-to-top';
    btn.innerHTML='↑';
    btn.setAttribute('aria-label','Back to top');
    document.body.appendChild(btn);
  }
  btn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  window.addEventListener('scroll',()=>{btn.classList.toggle('visible',scrollY>600)},{passive:true});
}

// ===== 36. GRADIENT BORDER SCROLL TRIGGER =====
function initGradBorderScroll(){
  const els=document.querySelectorAll('.grad-border');if(!els.length)return;
  const obs=new IntersectionObserver(es=>{es.forEach(e=>{
    if(e.isIntersecting){
      const before=e.target.querySelector('::before');// Can't select pseudo but we add class
      e.target.classList.add('grad-border--active');
    }
  })},{threshold:.3});
  els.forEach(el=>obs.observe(el));
}

// ===== 37. BILLING TOGGLE (pricing page helper) =====
function initBillingToggle(){
  const toggle=document.getElementById('billingToggle');if(!toggle)return;
  const monthLabel=document.getElementById('monthLabel');
  const yearLabel=document.getElementById('yearLabel');
  let annual=false;

  toggle.addEventListener('click',()=>{
    annual=!annual;
    toggle.classList.toggle('annual',annual);
    if(monthLabel)monthLabel.classList.toggle('active',!annual);
    if(yearLabel)yearLabel.classList.toggle('active',annual);
    // Dispatch custom event for pricing cards to listen to
    document.dispatchEvent(new CustomEvent('billing-change',{detail:{annual}}));
  });
}

// ===== 38. VS COMPETITOR ROTATOR (pricing page helper) =====
function initVsRotator(competitors,interval){
  interval=interval||4000;
  let idx=0;
  const dots=document.querySelectorAll('.vs__dot');
  const nameEl=document.getElementById('vsName');
  const priceEl=document.getElementById('vsPrice');
  const featEl=document.getElementById('vsFeat');
  const capEl=document.getElementById('vsCap');
  if(!competitors||!nameEl)return;

  function show(i){
    idx=i;
    const c=competitors[i];
    nameEl.textContent=c.name;
    priceEl.textContent=c.price;
    if(featEl)featEl.textContent=c.feat||'';
    if(capEl)capEl.textContent=c.cap||'';
    dots.forEach((d,j)=>d.classList.toggle('on',j===i));
  }

  dots.forEach((d,i)=>d.addEventListener('click',()=>{show(i);clearInterval(autoRotate);autoRotate=setInterval(()=>show((idx+1)%competitors.length),interval)}));
  let autoRotate=setInterval(()=>show((idx+1)%competitors.length),interval);
  show(0);
}

// ===== 39. COST CALCULATOR (pricing page helper) =====
function initCostCalc(config){
  // config: {slidersMap: [{id,label,min,max,step,thresholds}], resultEl, resultPlanEl, resultWhyEl, resultSaveEl}
  if(!config)return;
  const sliders=config.slidersMap;
  if(!sliders)return;

  function calculate(){
    const vals={};
    sliders.forEach(s=>{
      const el=document.getElementById(s.id);
      if(el){vals[s.id]=parseInt(el.value);
        const valEl=document.getElementById(s.id+'Val');
        if(valEl)valEl.textContent=s.format?s.format(vals[s.id]):vals[s.id];
      }
    });
    if(config.onCalculate)config.onCalculate(vals);
  }

  sliders.forEach(s=>{
    const el=document.getElementById(s.id);
    if(el)el.addEventListener('input',calculate);
  });
  calculate();
}

// ===== 40. COMPARISON TABLE HOVER COLUMN HIGHLIGHT =====
function initCompareHighlight(){
  const table=document.querySelector('.cmp table');if(!table)return;
  table.querySelectorAll('td,th').forEach(cell=>{
    cell.addEventListener('mouseenter',()=>{
      const idx=[...cell.parentElement.children].indexOf(cell);
      table.querySelectorAll('tr').forEach(row=>{
        if(row.children[idx])row.children[idx].style.background='rgba(16,185,129,0.02)';
      });
    });
    cell.addEventListener('mouseleave',()=>{
      table.querySelectorAll('td,th').forEach(c=>c.style.background='');
    });
  });
}

// ===== 41. KEYBOARD SHORTCUTS (global site nav) =====
function initKeyboardNav(){
  document.addEventListener('keydown',e=>{
    // Don't intercept when typing in inputs
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)return;
    // Ctrl/Cmd + K → trigger command palette if on docs page
    if((e.metaKey||e.ctrlKey)&&e.key==='k'){
      e.preventDefault();
      if(typeof openCmd==='function'){openCmd()}
      return;
    }
  });
}

// ===== 42. INTERSECTION OBSERVER UTILITY =====
function onVisible(selector,callback,options){
  const obs=new IntersectionObserver(es=>{es.forEach(e=>{
    if(e.isIntersecting){callback(e.target);if(!options||!options.repeat)obs.unobserve(e.target)}
  })},Object.assign({threshold:.2},options));
  document.querySelectorAll(selector).forEach(el=>obs.observe(el));
  return obs;
}

// ===== 43. ELEMENT BUILDER UTILITY =====
function el(tag,attrs,children){
  const e=document.createElement(tag);
  if(attrs)Object.entries(attrs).forEach(([k,v])=>{
    if(k==='class')e.className=v;
    else if(k==='style'&&typeof v==='object')Object.assign(e.style,v);
    else if(k.startsWith('on'))e.addEventListener(k.slice(2).toLowerCase(),v);
    else e.setAttribute(k,v);
  });
  if(children){
    if(typeof children==='string')e.textContent=children;
    else if(Array.isArray(children))children.forEach(c=>{if(c)e.appendChild(typeof c==='string'?document.createTextNode(c):c)});
  }
  return e;
}

// ===== 44. DEBOUNCE UTILITY =====
function debounce(fn,delay){
  let t;return function(...args){clearTimeout(t);t=setTimeout(()=>fn.apply(this,args),delay)};
}

// ===== 45. THROTTLE UTILITY =====
function throttle(fn,limit){
  let last=0;return function(...args){const now=Date.now();if(now-last>=limit){last=now;fn.apply(this,args)}};
}
