(() => {
  const hero = document.querySelector('.hero');
  const wrapWords = () => {
    hero.querySelectorAll('.display').forEach(display => {
      [...display.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).forEach(node => {
        const word = document.createElement('span');
        word.className = 'hero-word';
        word.textContent = node.textContent;
        node.replaceWith(word);
      });
    });
  };
  wrapWords();
  document.addEventListener('portfolio-language', wrapWords);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = matchMedia('(hover: hover) and (pointer: fine)');
  let frame = 0;
  let x = 0, y = 0;
  const enabled = () => !reduced.matches && !document.body.classList.contains('motion-paused');
  const paint = () => {
    frame = 0;
    const active = enabled() && pointer.matches;
    hero.style.setProperty('--mouse-x', `${active ? x * 5 : 0}px`);
    hero.style.setProperty('--mouse-y', `${active ? y * 3 : 0}px`);
    hero.style.setProperty('--light-x', `${active ? 50 + x * 35 : 50}%`);
    hero.style.setProperty('--light-y', `${active ? 50 + y * 35 : 50}%`);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
  hero.addEventListener('pointermove', event => {
    if (!enabled() || !pointer.matches || event.pointerType === 'touch') return;
    const rect = hero.getBoundingClientRect();
    x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - .5) * 2));
    y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - .5) * 2));
    schedule();
  }, { passive:true });
  hero.addEventListener('pointerleave', () => { x = y = 0; schedule(); });
  new MutationObserver(schedule).observe(document.body, {attributes:true, attributeFilter:['class']});
  reduced.addEventListener('change', schedule);
  pointer.addEventListener('change', schedule);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => hero.classList.toggle('hero-offscreen', !entry.isIntersecting)).observe(hero);
  }
  document.addEventListener('visibilitychange', () => hero.classList.toggle('hero-hidden', document.hidden));
  paint();
})();
