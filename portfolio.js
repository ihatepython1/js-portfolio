(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motion = document.getElementById('motion');
  let paused = reduced.matches;
  const setMotion = () => {
    document.body.classList.toggle('motion-paused', paused);
    motion.setAttribute('aria-pressed', String(paused));
    motion.setAttribute('aria-label', document.documentElement.lang === 'th' ? (paused ? 'เปิดภาพเคลื่อนไหว' : 'หยุดภาพเคลื่อนไหว') : (paused ? 'Enable animations' : 'Pause animations'));
    motion.textContent = paused ? '▷' : 'Ⅱ';
  };
  document.addEventListener('portfolio-language', setMotion);
  setMotion();
  motion.addEventListener('click', () => { paused = !paused; setMotion(); });
  reduced.addEventListener('change', () => { paused = reduced.matches; setMotion(); });
  const clock = document.getElementById('clock');
  const tick = () => { clock.textContent = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date()) + ' / TH'; };
  tick(); setInterval(tick, 1000);
  if ('IntersectionObserver' in window) {
    const reveals = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.remove('pending'); reveals.unobserve(entry.target); }
    }), { threshold:0.08 });
    document.querySelectorAll('.reveal').forEach(el => { if (el.getBoundingClientRect().top > innerHeight) el.classList.add('pending'); reveals.observe(el); });
    document.body.classList.add('motion-enabled');
  }
  const links = [...document.querySelectorAll('.nav-links a')];
  const sections = ['top','about','work'].map(id => document.getElementById(id));
  let queued = false;
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    document.querySelector('.progress').style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    let active = 0;
    sections.forEach((section, i) => { if (section.getBoundingClientRect().top <= 180) active = i; });
    links.forEach((link, i) => { link.classList.toggle('active', i === active); if(i === active) link.setAttribute('aria-current','location'); else link.removeAttribute('aria-current'); });
    queued = false;
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive:true });
  addEventListener('resize', update); update();
})();
