(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const frames = $$('.frame'), fileInput = $('#file');
  const items = frames.map(() => null);           // {blob,url,caption}
  let target = 0;

  /* ---------- IndexedDB ---------- */
  const dbp = new Promise(res => {
    const r = indexedDB.open('moon-polaroids', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => res(null);
  });
  const store = async (fn) => { const db = await dbp; if (!db) return; return new Promise(ok => { const t = db.transaction('kv', 'readwrite'); fn(t.objectStore('kv')); t.oncomplete = ok; }); };
  const save = i => store(s => items[i] ? s.put({ blob: items[i].blob, caption: items[i].caption }, i) : s.delete(i));

  /* ---------- Rendering ---------- */
  function render(i) {
    const f = frames[i], slot = $('.slot', f), it = items[i];
    $('img', slot)?.remove();
    f.classList.toggle('has', !!it);
    $('.cap', f).disabled = !it;
    $('.cap', f).value = it ? it.caption : '';
    slot.setAttribute('aria-label', it ? `Open photo ${i + 1}` : `Add photo to frame ${i + 1}`);
    if (it) {
      const img = new Image(); img.src = it.url; img.loading = 'lazy'; img.draggable = true;
      img.alt = it.caption || `Photo ${i + 1}`;
      img.ondragstart = e => e.dataTransfer.setData('text/x-swap', i);
      slot.prepend(img);
    }
  }

  /* ---------- Image handling (resize to max 1600px) ---------- */
  async function shrink(file) {
    const bmp = await createImageBitmap(file), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = bmp.width * k; c.height = bmp.height * k;
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', .88));
  }
  async function setPhoto(i, file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return alert('Please choose a JPG, PNG or WebP image.');
    const blob = await shrink(file);
    if (items[i]) URL.revokeObjectURL(items[i].url);
    items[i] = { blob, url: URL.createObjectURL(blob), caption: items[i]?.caption || '' };
    render(i); save(i);
  }
  function clearPhoto(i) { if (items[i]) URL.revokeObjectURL(items[i].url); items[i] = null; render(i); save(i); }

  /* ---------- Frame events ---------- */
  frames.forEach((f, i) => {
    $('.slot', f).onclick = () => items[i] ? openModal(i) : pick(i);
    $('.cap', f).oninput = e => { if (items[i]) { items[i].caption = e.target.value; save(i); } };
    $('.tools', f).onclick = e => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'replace') pick(i);
      if (a === 'swap') { const j = (i + 1) % frames.length; [items[i], items[j]] = [items[j], items[i]]; render(i); render(j); save(i); save(j); }
      if (a === 'rm') clearPhoto(i);
      if (a === 'dl') download(i);
    };
    f.addEventListener('dragover', e => { e.preventDefault(); f.classList.add('over'); });
    f.addEventListener('dragleave', () => f.classList.remove('over'));
    f.addEventListener('drop', e => {
      e.preventDefault(); f.classList.remove('over');
      const from = e.dataTransfer.getData('text/x-swap');
      if (from !== '') { const a = +from; if (!isNaN(a) && a !== i) { [items[a], items[i]] = [items[i], items[a]]; render(a); render(i); save(a); save(i); } return; }
      const file = e.dataTransfer.files[0]; if (file) setPhoto(i, file);
    });
    // 3D tilt
    f.addEventListener('pointermove', e => {
      const r = f.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      f.style.setProperty('--ry', x * 14 + 'deg'); f.style.setProperty('--gx', (x + .5) * 100 + '%'); f.style.setProperty('--gy', (y + .5) * 100 + '%'); f.style.setProperty('--rx', -y * 14 + 'deg');
    });
    f.addEventListener('pointerleave', () => { f.style.setProperty('--rx', '0deg'); f.style.setProperty('--ry', '0deg'); });
  });
  const pick = i => { target = i; fileInput.value = ''; fileInput.click(); };
  fileInput.onchange = () => fileInput.files[0] && setPhoto(target, fileInput.files[0]);
  const download = i => { const a = document.createElement('a'); a.href = items[i].url; a.download = `polaroid-${i + 1}.jpg`; a.click(); };

  /* ---------- Modal ---------- */
  const modal = $('#modal'), big = $('#big');
  let cur = 0;
  const filled = () => items.map((x, i) => x ? i : -1).filter(i => i >= 0);
  function openModal(i) {
    cur = i; const it = items[i];
    big.src = it.url; big.alt = it.caption || `Photo ${i + 1}`; $('#bigCap').textContent = it.caption;
    $('#bigDl').href = it.url; $('#bigDl').download = `polaroid-${i + 1}.jpg`;
    modal.hidden = false; $('#close').focus();
  }
  function step(d) { const l = filled(); if (l.length) openModal(l[(l.indexOf(cur) + d + l.length) % l.length]); }
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  $('#close').onclick = () => modal.hidden = true;
  modal.onclick = e => { if (e.target === modal) modal.hidden = true; };
  addEventListener('keydown', e => {
    if (modal.hidden) return;
    if (e.key === 'Escape') modal.hidden = true;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  let swx = null;                                   // swipe left/right in the preview
  modal.addEventListener('touchstart', e => swx = e.touches[0].clientX, { passive: true });
  modal.addEventListener('touchend', e => { if (swx == null) return; const d = e.changedTouches[0].clientX - swx; swx = null; if (Math.abs(d) > 50) step(d < 0 ? 1 : -1); });

  /* ---------- Toolbar ---------- */
  $('#modeBtn').onclick = () => document.body.classList.toggle('bright');
  $('#resetBtn').onclick = () => { if (confirm('Remove all photos and captions?')) items.forEach((_, i) => clearPhoto(i)); };

  /* ---------- Music player (3 generated ambient tracks + your own songs) ---------- */
  const T = [{ n: 'Moonlight', f: [110, 164.8, 220.5, 277] }, { n: 'Quiet Orbit', f: [98, 146.8, 196, 246.9] }, { n: 'Saturn Lullaby', f: [130.8, 196, 261.6, 329.6] }];
  const au = new Audio(); au.loop = true;
  let ac, mg, ag, rec, osc = [], ti = 0, on = false, t0 = 0, vol = .3;
  function audio() {                      // one audio graph feeds both the speakers and the video recorder
    if (!ac) {
      ac = new AudioContext(); rec = ac.createMediaStreamDestination();
      mg = ac.createGain(); ag = ac.createGain();
      [mg, ag].forEach(g => { g.connect(ac.destination); g.connect(rec); });
      ac.createMediaElementSource(au).connect(ag);
    }
    ac.resume();
  }
  const ui = () => { $('#pPlay').textContent = on ? '❚❚' : '▶'; $('#pPlay').setAttribute('aria-label', on ? 'Pause' : 'Play'); $('#player').classList.toggle('playing', on); };
  const label = () => { $('#title').textContent = T[ti].n; $('#sub').textContent = `Track ${ti + 1} / ${T.length}` + (T[ti].url ? ' · yours' : ''); };
  const stopSynth = () => { osc.forEach(o => { try { o.stop(); } catch {} }); osc = []; };
  function play() {
    const t = T[ti]; stopSynth(); au.pause(); audio();
    if (t.url) { au.src = t.url; ag.gain.value = vol; au.play(); }
    else {
      mg.gain.value = vol * .3;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.connect(mg);
      t.f.forEach((f, k) => { const o = ac.createOscillator(); o.frequency.value = f; o.detune.value = k * 4; const g = ac.createGain(); g.gain.value = .25; o.connect(g).connect(lp); o.start(); osc.push(o); });
    }
    on = true; t0 = performance.now(); ui();
  }
  const pause = () => { stopSynth(); au.pause(); on = false; ui(); };
  const go = d => { ti = (ti + d + T.length) % T.length; label(); if (on) play(); };
  $('#pPlay').onclick = () => on ? pause() : play();
  $('#pPrev').onclick = () => go(-1); $('#pNext').onclick = () => go(1);
  $('#vol').oninput = e => { vol = +e.target.value; if (mg) { mg.gain.value = vol * .3; ag.gain.value = vol; } };
  $('#seek').oninput = e => { if (T[ti].url && au.duration) au.currentTime = e.target.value / 100 * au.duration; };
  $('#songIn').onchange = e => { const f = e.target.files[0]; if (!f) return; T.push({ n: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }); ti = T.length - 1; label(); play(); };
  setInterval(() => { if (!on) return; const sk = $('#seek'); if (T[ti].url) sk.value = au.duration ? au.currentTime / au.duration * 100 : 0; else sk.value = ((performance.now() - t0) / 1000 % 120) / 120 * 100; }, 300);

  /* ---------- 3D scene, cursor atmosphere, interactive spider ---------- */
  const stage = $('#stage'), calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches && innerWidth > 700;
  if (fine && !calm) document.body.classList.add('fx');
  let mx = -999, my = -999, nx = 0, ny = 0, sx = 0, sy = 0, lastMove = 0, boost = 0;
  let dx = 0, dy = 0, tx = 0, ty = 0;
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    mx = e.clientX; my = e.clientY; nx = mx / innerWidth - .5; ny = my / innerHeight - .5; lastMove = performance.now();
  });
  const pl = $('#player');
  const mobileMQ = matchMedia('(max-width: 600px)');   // on phones the player docks to the bottom of the screen
  const dockIt = () => { pl.classList.toggle('dock', mobileMQ.matches); (mobileMQ.matches ? document.body : stage).appendChild(pl); };
  dockIt(); mobileMQ.addEventListener('change', dockIt);
  pl.addEventListener('pointermove', e => {
    const r = pl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    pl.style.setProperty('--ry', x * 10 + 'deg'); pl.style.setProperty('--rx', -y * 10 + 'deg');
    pl.style.setProperty('--gx', (x + .5) * 100 + '%'); pl.style.setProperty('--gy', (y + .5) * 100 + '%');
  });
  pl.addEventListener('pointerleave', () => { pl.style.setProperty('--rx', '0deg'); pl.style.setProperty('--ry', '0deg'); });

  function tick() {
    if (document.body.classList.contains('fx')) {
      dx += (mx - dx) * .5; dy += (my - dy) * .5; tx += (mx - tx) * .12; ty += (my - ty) * .12;
      $('#dot').style.transform = `translate(${dx}px,${dy}px)`; $('#trail').style.transform = `translate(${tx}px,${ty}px)`;
    }
    const tsx = -ny * 6, tsy = nx * 8;
    if (Math.abs(tsx - sx) > .01 || Math.abs(tsy - sy) > .01) {      // only touch the DOM while still moving
      sx += (tsx - sx) * .06; sy += (tsy - sy) * .06;
      stage.style.setProperty('--sx', sx.toFixed(2) + 'deg'); stage.style.setProperty('--sy', sy.toFixed(2) + 'deg');
    }
    if (!calm) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---------- Canvas renderer: full-page screenshot + smooth video (no screen-share needed) ---------- */
  const CW = 1152, CH = 2048, vb = $('#vidBtn');
  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  const saveBlob = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const SCRIPT = '"Segoe Script","Brush Script MT",cursive';

  async function buildStatic(k) {                       // background, silk, photos, captions: drawn once
    const c = document.createElement('canvas'); c.width = CW * k; c.height = CH * k;
    const g = c.getContext('2d'); g.scale(k, k);
    g.drawImage(await loadImg(window.SCENE_DATA || 'assets/scene.webp'), 0, 0, CW, CH);
    const vg = g.createRadialGradient(576, 920, 500, 576, 920, 1300); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
    g.fillStyle = vg; g.fillRect(0, 0, CW, CH);
    for (let i = 0; i < frames.length; i++) {
      const st = frames[i].style, x = parseFloat(st.getPropertyValue('--x')), y = parseFloat(st.getPropertyValue('--y')), w = parseFloat(st.getPropertyValue('--w')), h = parseFloat(st.getPropertyValue('--h'));
      const capw = (parseFloat(st.getPropertyValue('--capw')) || 96) / 100, it = items[i];
      if (it) {
        const im = await loadImg(it.url), s = Math.max(w / im.width, h / im.height), sw = w / s, sh = h / s;
        g.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h);
        const gl = g.createLinearGradient(x, y, x + w * .5, y + h * .4); gl.addColorStop(0, 'rgba(255,255,255,.14)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gl; g.fillRect(x, y, w, h);
      } else { g.fillStyle = 'rgba(233,207,200,.7)'; g.font = '40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+ Add Photo', x + w / 2, y + h / 2); }
      if (it?.caption) { g.fillStyle = '#222'; g.font = `italic 34px ${SCRIPT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(it.caption, x + w * .02 + w * capw / 2, y + h + h * .065); }
    }
    return c;
  }
  function drawPlayer(g, now) {
    const X = 150, Y = 368, W = 422, H = 604, pad = 41, iw = W - 2 * pad, cxm = X + W / 2;
    let gr = g.createLinearGradient(X, Y, X + W, Y + H); gr.addColorStop(0, 'rgb(80,80,88)'); gr.addColorStop(1, 'rgb(14,14,18)');
    g.save(); g.shadowColor = 'rgba(255,255,255,.3)'; g.shadowBlur = on ? 45 : 22; g.fillStyle = gr; rr(g, X, Y, W, H, 24); g.fill(); g.restore();
    g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 1.5; rr(g, X, Y, W, H, 24); g.stroke();
    gr = g.createLinearGradient(X, Y, X + W * .6, Y + H * .4); gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; rr(g, X, Y, W, H, 24); g.fill();
    const ay = Y + pad, ah = 250;
    gr = g.createRadialGradient(cxm, ay + ah * .3, 10, cxm, ay + ah * .3, 260); gr.addColorStop(0, '#4a4a52'); gr.addColorStop(1, '#0f0f12'); g.fillStyle = gr; rr(g, X + pad, ay, iw, ah, 16); g.fill();
    for (let k = 0; k < 7; k++) {                      // equaliser bars
      const hh = on ? 30 + (Math.sin(now / 190 * (1 + k * .23) + k * 1.7) * .5 + .5) * 120 : 36, bx = cxm - 133 + k * 40, by = ay + ah - 18 - hh;
      gr = g.createLinearGradient(0, by, 0, by + hh); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#777777'); g.fillStyle = gr; rr(g, bx, by, 26, hh, 5); g.fill();
    }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#f2f2f2'; g.font = 'bold 36px system-ui,sans-serif'; g.fillText($('#title').textContent, cxm, ay + ah + 50);
    g.globalAlpha = .6; g.font = '24px system-ui,sans-serif'; g.fillText($('#sub').textContent, cxm, ay + ah + 82); g.globalAlpha = 1;
    const sy = ay + ah + 105, prog = $('#seek').value / 100;
    g.fillStyle = 'rgba(255,255,255,.25)'; rr(g, X + pad, sy - 3, iw, 6, 3); g.fill();
    g.fillStyle = '#ffffff'; rr(g, X + pad, sy - 3, Math.max(6, iw * prog), 6, 3); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X + pad + iw * prog, sy, 9, 0, 7); g.fill();
    [[-100, 28, '⏮'], [0, 36, on ? '❚❚' : '▶'], [100, 28, '⏭']].forEach(([ox, r, t]) => {
      const bx = cxm + ox, by = sy + 62; gr = g.createLinearGradient(0, by - r, 0, by + r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#b8b8bf');
      g.fillStyle = gr; g.beginPath(); g.arc(bx, by, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#111'; g.font = '24px system-ui'; g.textBaseline = 'middle'; g.fillText(t, bx, by + 1);
    });
    const vy = sy + 128; g.textBaseline = 'middle'; g.font = '22px system-ui'; g.fillText('🔈', X + pad + 12, vy);
    g.fillStyle = 'rgba(255,255,255,.25)'; rr(g, X + pad + 36, vy - 3, iw - 36, 6, 3); g.fill();
    g.fillStyle = '#ffffff'; rr(g, X + pad + 36, vy - 3, Math.max(6, (iw - 36) * vol), 6, 3); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X + pad + 36 + (iw - 36) * vol, vy, 9, 0, 7); g.fill();
    g.globalAlpha = .6; g.font = '20px system-ui'; g.fillText('+ Add your own song', cxm, sy + 172); g.globalAlpha = 1;
  }
  function drawDust(g) {
    for (const p of P) { g.fillStyle = p.red ? `rgba(255,255,255,${p.a})` : `rgba(230,210,200,${p.a * .5})`; g.beginPath(); g.arc(p.x / cv.width * CW, p.y / cv.height * CH, p.r * 1.8, 0, 7); g.fill(); }
  }

  $('#shotBtn').onclick = async () => {                // full page, full resolution, one click
    const b = $('#shotBtn'), old = b.textContent; b.textContent = '… saving';
    try {
      const st = await buildStatic(1), c = document.createElement('canvas'); c.width = CW; c.height = CH;
      const g = c.getContext('2d'); g.drawImage(st, 0, 0); drawDust(g); drawPlayer(g, performance.now());
      c.toBlob(bl => saveBlob(bl, 'moon-gallery.png'), 'image/png');
    } catch (e) { alert('Screenshot failed: ' + e.message); }
    b.textContent = old;
  };

  let mr = null, chunks = [], timer;
  async function startRec() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return alert('Video download needs Chrome, Edge or Firefox on desktop.');
    const k = .625, stat = await buildStatic(k), c = document.createElement('canvas'); c.width = CW * k; c.height = CH * k;
    const g = c.getContext('2d');
    if (!on) play(); audio();
    const stream = c.captureStream(30); rec.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    if (ext === 'webm') alert('This browser cannot record MP4 directly, so the video will be saved as WebM. Update Chrome/Edge (v126+) for MP4.');
    chunks = []; mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5e6 });
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = () => { clearInterval(timer); saveBlob(new Blob(chunks, { type: mime.split(';')[0] }), 'moon-gallery.' + ext); vb.textContent = '⬇ Video'; mr = null; };
    const frame = now => {
      if (!mr || mr.state === 'inactive') return;
      g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(stat, 0, 0);
      g.save(); g.scale(k, k); drawDust(g); drawPlayer(g, now); g.restore();
      requestAnimationFrame(frame);
    };
    mr.start(1000); requestAnimationFrame(frame);
    let n = 0; vb.textContent = '⏹ Stop 0:00';
    timer = setInterval(() => { n++; vb.textContent = `⏹ Stop ${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; if (n >= 120) mr.stop(); }, 1000);
  }
  vb.onclick = () => mr ? mr.stop() : startRec();

  /* ---------- Dust + red embers ---------- */
  const cv = $('#fx'), cx = cv.getContext('2d');
  let P = [];
  const size = () => { cv.width = innerWidth; cv.height = innerHeight; };
  size(); addEventListener('resize', size);
  const mk = () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, r: Math.random() * 1.6 + .4,
    vx: (Math.random() - .5) * .2, vy: -Math.random() * .25 - .05, red: Math.random() < .12, a: Math.random() * .5 + .2 });
  P = Array.from({ length: 35 }, mk);
  let skip = 0;
  (function loop() {
    if (skip++ % 2 && !calm) return requestAnimationFrame(loop);   // ~30fps is plenty for dust
    cx.clearRect(0, 0, cv.width, cv.height);
    if (document.body.classList.contains('fx') && mx > 0) { cx.shadowBlur = 0; for (const p of P) { const d = Math.hypot(p.x - mx, p.y - my); if (d < 110) { cx.strokeStyle = `rgba(220,220,235,${(1 - d / 110) * .5})`; cx.lineWidth = .6; cx.beginPath(); cx.moveTo(mx, my); cx.lineTo(p.x, p.y); cx.stroke(); } } }
    for (const p of P) {
      if (!calm) { p.x += p.vx; p.y += p.vy; }
      if (p.y < -5) { p.y = cv.height + 5; p.x = Math.random() * cv.width; }
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7);
      cx.fillStyle = p.red ? `rgba(255,255,255,${p.a})` : `rgba(230,210,200,${p.a * .5})`;
      cx.fill();
    }
    if (!calm) requestAnimationFrame(loop);
  })();

  /* ---------- Load saved gallery ---------- */
  dbp.then(db => {
    if (!db) return;
    const s = db.transaction('kv').objectStore('kv');
    frames.forEach((_, i) => s.get(i).onsuccess = e => {
      const d = e.target.result; if (!d) return;
      items[i] = { blob: d.blob, url: URL.createObjectURL(d.blob), caption: d.caption || '' }; render(i);
    });
  });
})();
