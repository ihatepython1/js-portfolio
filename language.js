(() => {
  const translations = [];
  const add = (selector, thai) => {
    const elements = [...document.querySelectorAll(selector)];
    elements.forEach((element, i) => translations.push({element, en:element.innerHTML, th:Array.isArray(thai) ? thai[i] : thai}));
  };
  add('.skip', 'ข้ามไปดูผลงาน');
  add('.nav-links a', ['หน้าแรก','เกี่ยวกับ','ผลงาน <span>04</span>']);
  add('.hero-top .eyebrow', 'ลองคิด ลองทำ / JAVASCRIPT');
  add('.edition', 'รวมผลงาน — 01');
  add('.hello', 'สวัสดีครับ ผม<br><strong>NOPPAWIT<br>PUTTHANBUT</strong><br>เรียกผมว่า “พูน” ครับ');
  add('.display', ['ผลงาน <span class="asterisk" aria-hidden="true">✳</span>','ดิจิทัล','ของผม<span class="period">.</span>']);
  add('.hero-caption', 'เว็บและแอปที่ผมลงมือทำ<br>โดย NOPPAWIT PUTTHANBUT<br><span>สร้างด้วย JAVASCRIPT</span>');
  add('.hero-subtitle', '4 โปรเจกต์ที่ผมเขียนด้วย JavaScript โดยไม่ใช้ไลบรารีเสริม');
  add('.hero-bottom > span', ['<i></i> เขียนเอง ลองเอง ใช้งานได้จริง','ลำปาง ประเทศไทย']);
  add('.hero-bottom > a', 'เลื่อนเพื่อดูผลงาน ↓');
  add('#about .eyebrow', '01 / ทำไมถึงทำโปรเจกต์เหล่านี้');
  add('#about-title', 'เริ่มจากความสงสัย<br>แล้วลองทำดู<span>.</span>');
  add('.about-copy > p:not(.status):not(.meta)', [
    'ผมอยากลองว่า ถ้าใช้แค่ HTML, CSS และ JavaScript จะทำอะไรได้บ้าง เลยทำออกมาเป็น 4 โปรเจกต์ ทั้งแอปจัดสต็อก ตัวจำลองการหาเส้นทาง เครื่องมือแต่งภาพ และเครื่องทำจังหวะกลอง แต่ละแอปอยู่ในไฟล์ HTML เดียว ไม่ใช้เฟรมเวิร์กหรือไลบรารีเสริม และเปิดใช้งานได้เลยโดยไม่ต้องบิลด์',
    'ผมทำฝั่งเซิร์ฟเวอร์ด้วย Node.js ไว้ด้วย ใช้แค่โมดูล <code>node:</code> ที่มีมาให้ แล้วเขียนส่วนรับส่งข้อมูล การสร้างไฟล์ PNG และ WAV รวมถึง WebSocket เอง ส่วนงานที่ใช้เวลาประมวลผลมากก็แยกไปทำใน worker threads ทุกแอปใช้งานในเบราว์เซอร์ได้อยู่แล้ว แต่ถ้าเปิดเซิร์ฟเวอร์ด้วย ก็จะเพิ่มความสามารถอย่างการบันทึกข้อมูลและซิงก์ข้ามแท็บได้'
  ]);
  add('.meta', 'Noppawit Putthanbut (พูน) · ลำปาง ประเทศไทย · <a href="https://ihatepython1.github.io">ihatepython1.github.io</a>');
  add('.ticker > div', ('สถานะและข้อมูล <span>✳</span> อัลกอริทึม <span>✳</span> ภาพ <span>✳</span> เสียง <span>✳</span> ').repeat(2));
  add('#work .eyebrow', '02 / ผลงานของผม');
  add('#work-title', 'ลองเปิดดู<br><em>ลองเล่นได้เลย</em>');
  add('#work > div > p', 'ทั้ง 4 แอปเปิดใช้งานได้จริง<br>เลือกโปรเจกต์ที่สนใจ<br>แล้วลองเล่นดูครับ ↙');
  add('.project-meta > span:first-child', ['ผลงาน / 01','ผลงาน / 02','ผลงาน / 03','ผลงาน / 04']);
  add('.project-meta > span:last-child', 'เปิดแอป ↗');
  add('.visual-label', ['จัดสต็อกให้เป็นระบบ','แต่ละวิธีหาเส้นทางต่างกันยังไง','ลองปรับภาพในแบบของคุณ','มาสร้างจังหวะกัน']);
  add('.project-copy h2', ['Shelf — จัดการสต็อกสินค้า','Pathfinder — ดูวิธีหาเส้นทาง','Image Lab — ลองแต่งภาพ','Pulse-16 — ทำจังหวะกลอง']);
  add('.project-copy > p:not(.extra)', [
    'แอปช่วยดูแลสต็อกสำหรับร้านเล็ก ๆ ดูได้ว่าสินค้าอะไรใกล้หมด เรียงข้อมูลตามที่ต้องการ และนำเข้าหรือส่งออกไฟล์ CSV ได้ ถ้าเผลอลบสินค้าก็กู้คืนได้ ข้อมูลจะเก็บไว้ในเบราว์เซอร์',
    'ลองดูว่าอัลกอริทึม 5 แบบ ได้แก่ A*, Dijkstra, breadth-first, greedy และ depth-first หาเส้นทางต่างกันยังไง แต่ละแบบจะวิ่งบนแผนที่เดียวกันให้เห็นชัด ๆ ว่าไปสำรวจตรงไหนบ้าง ลองสร้างเขาวงกตหรือเพิ่มพื้นที่ที่เดินผ่านยากขึ้นได้ด้วย',
    'เครื่องมือแต่งภาพที่ผมเขียนการคำนวณพิกเซลเอง ปรับความสว่าง คอนทราสต์ และแกมมาได้ด้วย lookup table รวมถึงเบลอ เพิ่มความคม ทำภาพนูน และหาขอบภาพด้วย Sobel มีกราฟ RGB อัปเดตตามภาพ และแถบเลื่อนให้เทียบก่อน–หลังได้ทันที',
    'ลองทำจังหวะกลองด้วยเสียงที่สร้างขึ้นตอนเล่น โดยไม่ใช้ไฟล์เสียงสำเร็จรูป ทั้งเสียงกระเดื่อง ไฮแฮต และตบมือมาจากการสังเคราะห์เสียงด้วยออสซิลเลเตอร์และสัญญาณรบกวน มีการจัดเวลาเสียงล่วงหน้าเพื่อให้จังหวะไม่สะดุด และแชร์จังหวะที่ทำไว้ผ่านลิงก์ได้'
  ]);
  add('.extra', [
    'เปิดเซิร์ฟเวอร์แล้วจะเก็บข้อมูลใน SQLite ซิงก์ข้อมูลระหว่างแท็บได้ทันที และดูประวัติการเพิ่ม–ลดสินค้าได้',
    'เปิดเซิร์ฟเวอร์แล้วจะทดสอบเทียบทั้ง 5 วิธีบนเขาวงกตที่กำหนด seed ไว้ได้ โดยแบ่งงานให้ worker ช่วยประมวลผล',
    'เปิดเซิร์ฟเวอร์แล้วจะแต่งภาพที่ความละเอียดเต็มผ่าน worker และส่งออก PNG ด้วยตัวเข้ารหัสที่ผมเขียนเองได้',
    'เปิดเซิร์ฟเวอร์แล้วจะสร้างไฟล์ WAV ได้โดยไม่ต้องเล่นเสียง บันทึกจังหวะไว้ และเข้าเล่นด้วยกันในห้องแจมได้'
  ]);
  add('.tags span:first-child', ['สถานะและข้อมูล','อัลกอริทึม','กราฟิก','Web Audio']);
  const tagWords = {'CSV parser':'ตัวอ่าน CSV','Binary heap':'ฮีปทวิภาค','Convolution':'คอนโวลูชัน','PNG encoder':'ตัวเข้ารหัส PNG','Synthesis':'สังเคราะห์เสียง','Lookahead clock':'จัดเวลาเสียงล่วงหน้า','WAV encoder':'ตัวเข้ารหัส WAV'};
  document.querySelectorAll('.tags span:not(:first-child)').forEach(element => { if(tagWords[element.textContent]) translations.push({element,en:element.innerHTML,th:tagWords[element.textContent]}); });
  add('.footer-top .eyebrow', 'ยังมีอีก ลองแวะไปดูครับ');
  add('.footer-top > a', 'ไปดูผลงานอื่นของผม<span>↗</span>');
  add('.footer-bottom > a', 'กลับขึ้นด้านบน ↑');
  const labels = [['.nav','เมนูหลัก'],['.wordmark','หน้าแรกของพูน'],['#clock','เวลาในประเทศไทย'],['.round-link','ดูผลงานทั้ง 4 โปรเจกต์']].map(([selector,th]) => {const element=document.querySelector(selector);return {element,th,en:element.getAttribute('aria-label')};});
  const button = document.getElementById('language');
  const status = document.getElementById('status');
  let lang = 'en';
  let health;
  try { if(localStorage.getItem('portfolio-language') === 'th') lang = 'th'; } catch {}
  function renderStatus() {
    const th = lang === 'th';
    if(health === undefined) status.textContent = th ? 'กำลังตรวจสอบการเชื่อมต่อเซิร์ฟเวอร์…' : 'Checking for a backend on this origin…';
    else if(health) status.textContent = th
      ? `เชื่อมต่อเซิร์ฟเวอร์แล้ว · ${health.node} · จัดเก็บด้วย ${health.storage} · ${health.workers.solve + health.workers.pixels} worker threads · ใช้ฟีเจอร์เพิ่มเติมของทุกแอปได้แล้ว`
      : `Backend up · ${health.node} · ${health.storage} storage · ${health.workers.solve + health.workers.pixels} worker threads · every app below has its extras enabled.`;
    else status.textContent = th ? 'ตอนนี้ยังไม่ได้เปิดเซิร์ฟเวอร์ แต่ทั้ง 4 แอปยังเล่นในเบราว์เซอร์ได้ตามปกติ ถ้าอยากลองฟีเจอร์เพิ่มเติม ให้รัน node server/index.mjs' : 'No backend on this origin — the four apps below run entirely in your browser. Clone the repo and run node server/index.mjs to switch on the rest.';
  }
  function render() {
    document.documentElement.lang = lang;
    document.title = lang === 'th' ? 'ผลงานเว็บแอป — Noppawit Putthanbut' : 'My digital work — Noppawit Putthanbut';
    translations.forEach(({element,en,th}) => {element.innerHTML = lang === 'th' ? th : en;});
    labels.forEach(({element,en,th}) => element.setAttribute('aria-label',lang === 'th' ? th : en));
    button.textContent = lang === 'th' ? 'EN' : 'ไทย';
    button.lang = lang === 'th' ? 'en' : 'th';
    button.setAttribute('aria-label', lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย');
    renderStatus();
    document.dispatchEvent(new Event('portfolio-language'));
  }
  button.addEventListener('click', () => {lang = lang === 'th' ? 'en' : 'th';try{localStorage.setItem('portfolio-language',lang);}catch{}render();});
  render();
  (async () => {
    try {
      const response = await fetch('/api/health', {signal:AbortSignal.timeout(1500)});
      if(!response.ok) throw Error('offline');
      const data = await response.json();
      if(!data.workers || typeof data.workers.solve !== 'number' || typeof data.workers.pixels !== 'number') throw Error('invalid health');
      health = data;status.dataset.on = 'true';
    } catch {health = null;}
    renderStatus();
  })();
})();
