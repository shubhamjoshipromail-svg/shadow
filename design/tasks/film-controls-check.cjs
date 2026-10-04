/* Local validation harness for the site/index.html film controls.
   Real Google Chrome (Playwright's default launch args — no autoplay-policy flag),
   headless, DEFAULT browser autoplay policy. Static server on :8137.
   Preserved integration verification harness. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.TACET_PLAYWRIGHT_MODULE || '/private/tmp/tacet-sol-tools/node_modules/playwright');

const REPO = path.resolve(__dirname, '..', '..');
const ROOT = path.join(REPO, 'site');
const PORT = 8137;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = path.join(REPO, 'design', 'tasks', 'shots');
const URL = `http://127.0.0.1:${PORT}/index.html`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript',
  '.css': 'text/css', '.ico': 'image/x-icon'
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/') url = '/index.html';
      const file = path.join(ROOT, url);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
        const type = MIME[path.extname(file)] || 'application/octet-stream';
        const range = req.headers.range;
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          let start = m && m[1] ? parseInt(m[1], 10) : 0;
          let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
          if (!isFinite(start) || start < 0) start = 0;
          if (!isFinite(end) || end >= st.size) end = st.size - 1;
          res.writeHead(206, {
            'content-type': type, 'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${st.size}`,
            'content-length': end - start + 1, 'cache-control': 'no-store'
          });
          fs.createReadStream(file, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
          fs.createReadStream(file).pipe(res);
        }
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const STATE = `(function(){
  var v=document.getElementById('film');
  var controls=document.getElementById('film-controls');
  var sound=document.getElementById('film-sound');
  var play=document.getElementById('film-play');
  var status=document.getElementById('film-sound-status');
  var en=document.getElementById('film-lang-en'), de=document.getElementById('film-lang-de');
  var slot=document.getElementById('film-slot');
  function h(el){return el?Math.round(el.getBoundingClientRect().height):null;}
  function w(el){return el?Math.round(el.getBoundingClientRect().width):null;}
  return {
    readyState:v.readyState, paused:v.paused, muted:v.muted, volume:v.volume,
    currentTime:Math.round((v.currentTime||0)*100)/100,
    duration:isFinite(v.duration)?Math.round(v.duration*100)/100:null,
    src:v.getAttribute('src'), vlang:v.getAttribute('lang'),
    hasVideo:slot.classList.contains('has-video'), controlsHidden:controls.hidden,
    soundHidden:sound.hidden, soundPressed:sound.getAttribute('aria-pressed'), soundText:sound.textContent.trim(),
    soundPrimary:sound.classList.contains('primary'), soundHeight:h(sound), soundWidth:w(sound),
    statusText:status.textContent.trim(), statusRole:status.getAttribute('role'), statusLive:status.getAttribute('aria-live'),
    playHidden:play.hidden, playText:play.textContent.trim(), playHeight:h(play), playWidth:w(play),
    enPressed:en.getAttribute('aria-pressed'), dePressed:de.getAttribute('aria-pressed'),
    enHeight:h(en), deHeight:h(de), enLang:en.getAttribute('lang'), deLang:de.getAttribute('lang'),
    captionHidden:document.getElementById('film-caption').hidden,
    captionText:document.getElementById('film-caption').textContent.trim().slice(0,90),
    autoplayPolicy:(typeof navigator.getAutoplayPolicy==='function')?navigator.getAutoplayPolicy('mediaelement'):'unavailable',
    docScrollW:document.documentElement.scrollWidth, innerW:window.innerWidth
  };
})()`;

const checks = [];
function check(name, cond, detail) {
  checks.push({ name, pass: !!cond, detail: detail === undefined ? null : detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}
async function state(page) { return page.evaluate(STATE); }
async function waitState(page, fn, timeout = 20000) { await page.waitForFunction(fn, null, { timeout }); }
async function waitControls(page, timeout = 20000) {
  await page.waitForFunction(`document.getElementById('film-controls') && !document.getElementById('film-controls').hidden`, null, { timeout });
}
async function fontsReady(page) {
  await page.evaluate(`Promise.race([
    (document.fonts && document.fonts.ready) ? document.fonts.ready.then(() => true) : Promise.resolve(true),
    new Promise((r) => setTimeout(() => r(true), 4000))
  ])`);
}
async function shot(page, name, selector) {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const file = path.join(SHOTS, name);
  await el.screenshot({ path: file });
  return file;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const out = {};
  console.error('[step] browser up');
  try {
    /* ── Scenario A: desktop, default policy ─────────────────────────────── */
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctxA.newPage();
    page.on('console', (m) => { if (/autoplay|play\(\)/i.test(m.text())) console.error('[page console]', m.type(), m.text()); });
    await page.goto(URL, { waitUntil: 'load' });
    await fontsReady(page);
    await waitControls(page);
    await page.waitForTimeout(900);
    let s = await state(page);
    out.A_initial = s;
    console.log('A_initial', JSON.stringify(s));
    check('A controls become visible once the clip is ready', s.controlsHidden === false && s.hasVideo === true);
    check('A no fake "Sound on" while muted', !(s.soundText === 'Mute' && s.muted));
    check('A sound status is honest', (s.muted ? /muted/i.test(s.statusText) : s.statusText === 'Sound on'), { muted: s.muted, status: s.statusText });
    check('A language selection explicit (exactly one pressed)', (s.enPressed === 'true') !== (s.dePressed === 'true'), { en: s.enPressed, de: s.dePressed });
    check('A 44px hit target: language English', s.enHeight >= 44, s.enHeight);
    check('A 44px hit target: language Deutsch', s.deHeight >= 44, s.deHeight);
    check('A 44px hit target: sound', s.soundHeight >= 44, s.soundHeight);
    check('A 44px hit target: play (when shown)', s.playHidden === true || s.playHeight >= 44, { hidden: s.playHidden, height: s.playHeight });
    check('A sound status is a live region', s.statusRole === 'status' && s.statusLive === 'polite', { role: s.statusRole, live: s.statusLive });
    out.A_autoplayPolicy = s.autoplayPolicy;
    out.A_unmuted_autoplay_allowed = !s.muted && !s.paused;
    check('A real default autoplay policy blocked unmuted autoplay → muted fallback', out.A_unmuted_autoplay_allowed === false && /blocked autoplay/i.test(out.A_initial.statusText), { unmutedAllowed: out.A_unmuted_autoplay_allowed, status: out.A_initial.statusText });

    /* If the real policy allowed unmuted autoplay, mute with a real click so we
       can still record the muted/enable-sound state. */
    if (!s.muted) { await page.click('#film-sound'); await page.waitForTimeout(300); s = await state(page); }
    out.A_muted = s;
    console.log('A_muted', JSON.stringify(s));
    check('A muted state shows a truthful status + Enable sound action', s.muted === true && /muted/i.test(s.statusText) && s.soundText === 'Enable sound', { status: s.statusText, action: s.soundText });
    check('A muted Enable sound is the prominent action', s.soundPrimary === true);
    out.shot_muted = await shot(page, 'film-controls-muted-fallback.png', '.film-bar');

    /* click-to-sound (real trusted click) → sound on, no fake label */
    await page.click('#film-sound');
    await page.waitForTimeout(400);
    s = await state(page);
    out.A_sound_on = s;
    console.log('A_sound_on', JSON.stringify(s));
    check('A click-to-sound turns sound on', s.muted === false && s.volume > 0, { muted: s.muted, volume: s.volume });
    check('A sound-on state is labelled truthfully', s.soundText === 'Mute' && s.statusText === 'Sound on' && s.soundPressed === 'true');
    out.shot_sound = await shot(page, 'film-controls-sound-on.png', '.film-bar');

    /* ── Scenario B: timestamp / playback / sound across EN↔DE ──────────── */
    /* Paused switch → exact timestamp + paused state must survive. */
    await page.evaluate(`(function(){var v=document.getElementById('film');v.pause();v.currentTime=6.0;return true;})()`);
    await page.waitForTimeout(350);
    const beforeSwitch = await state(page);
    await page.click('#film-lang-de');
    await waitState(page, `document.getElementById('film-lang-de').getAttribute('aria-pressed')==='true' && document.getElementById('film').getAttribute('src').indexOf('film.de.mp4')>=0 && document.getElementById('film').readyState>=1`);
    await page.waitForTimeout(700);
    s = await state(page);
    out.B_de = s;
    console.log('B_de', JSON.stringify(s));
    check('B German selection is explicit', s.dePressed === 'true' && s.enPressed === 'false');
    check('B timestamp preserved across EN→DE (paused)', Math.abs(s.currentTime - beforeSwitch.currentTime) <= 0.35, { before: beforeSwitch.currentTime, after: s.currentTime });
    check('B sound preference preserved across EN→DE', s.muted === beforeSwitch.muted, { before: beforeSwitch.muted, after: s.muted });
    check('B paused playback state preserved across EN→DE', s.paused === true && beforeSwitch.paused === true, { before: beforeSwitch.paused, after: s.paused });
    check('B German caption track loaded for the German clip', s.vlang === 'de', s.vlang);
    out.shot_de = await shot(page, 'film-controls-deutsch.png', '.film-bar');

    /* Playing switch (sound still on) → keeps playing, keeps its place. */
    await page.click('#film-play');
    await waitState(page, `!document.getElementById('film').paused`, 8000).catch(() => {});
    await page.waitForTimeout(600);
    const beforeBack = await state(page);
    await page.click('#film-lang-en');
    await waitState(page, `document.getElementById('film-lang-en').getAttribute('aria-pressed')==='true' && document.getElementById('film').getAttribute('src').indexOf('film.de.mp4')<0 && document.getElementById('film').readyState>=1`);
    await page.waitForTimeout(600);
    s = await state(page);
    out.B_back_en = s;
    console.log('B_back_en', JSON.stringify(s));
    check('B back to English explicit', s.enPressed === 'true' && s.dePressed === 'false');
    check('B playing state preserved across DE→EN', s.paused === false && beforeBack.paused === false, { before: beforeBack.paused, after: s.paused });
    check('B timestamp kept (did not restart) across DE→EN', s.currentTime >= beforeBack.currentTime - 0.35 && s.currentTime > 2, { before: beforeBack.currentTime, after: s.currentTime });

    /* explicit mute survives a swap */
    await page.click('#film-sound');
    await page.waitForTimeout(250);
    await page.click('#film-lang-de');
    await waitState(page, `document.getElementById('film-lang-de').getAttribute('aria-pressed')==='true'`);
    await page.waitForTimeout(600);
    s = await state(page);
    check('B explicit mute preserved across EN→DE', s.muted === true && /muted/i.test(s.statusText), { muted: s.muted, status: s.statusText });
    await page.click('#film-sound');
    await page.waitForTimeout(250);
    const en = await state(page);
    check('B Enable sound after explicit mute', en.muted === false && en.soundText === 'Mute');
    await ctxA.close();

    /* ── Scenario C: rejected play promise → blocked player keeps Play ────── */
    const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctxC.addInitScript(`window.__forcePlayBlock=true;(function(){var orig=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(window.__forcePlayBlock){return Promise.reject(new DOMException('play blocked by test harness','NotAllowedError'));}return orig.apply(this,arguments);};})();`);
    const pageC = await ctxC.newPage();
    await pageC.goto(URL, { waitUntil: 'load' });
    await fontsReady(pageC);
    await pageC.waitForFunction(`document.getElementById('film').readyState >= 1`, null, { timeout: 15000 }).catch(() => {});
    await pageC.waitForTimeout(800);
    s = await state(pageC);
    out.C_blocked = s;
    console.log('C_blocked', JSON.stringify(s));
    check('C blocked player is paused', s.paused === true, s.paused);
    check('C blocked player retains visible Play with sound', s.playHidden === false && s.playText === 'Play with sound', { hidden: s.playHidden, text: s.playText });
    check('C blocked player never fakes Sound on', s.muted === true && /muted/i.test(s.statusText), { muted: s.muted, status: s.statusText });
    out.shot_blocked = await shot(pageC, 'film-controls-blocked.png', '.film-block');
    await pageC.evaluate(`window.__forcePlayBlock=false`);
    await pageC.click('#film-play');
    await waitState(pageC, `!document.getElementById('film').paused`, 8000).catch(() => {});
    await pageC.waitForTimeout(500);
    s = await state(pageC);
    out.C_play_sound = s;
    console.log('C_play_sound', JSON.stringify(s));
    check('C Play click defaults to sound ON', s.paused === false && s.muted === false, { paused: s.paused, muted: s.muted });
    check('C play button hidden while playing', s.playHidden === true);
    await ctxC.close();

    /* ── Scenario D: reduced motion — no autoplay ────────────────────────── */
    const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const pageD = await ctxD.newPage();
    await pageD.goto(URL, { waitUntil: 'load' });
    await fontsReady(pageD);
    await waitControls(pageD);
    await pageD.waitForTimeout(900);
    s = await state(pageD);
    out.D_reduce = s;
    console.log('D_reduce', JSON.stringify(s));
    check('D reduced motion does not autoplay', s.paused === true, s.paused);
    check('D reduced motion shows Play with sound', s.playHidden === false && s.playText === 'Play with sound', { hidden: s.playHidden, text: s.playText });
    out.shot_reduce = await shot(pageD, 'film-controls-reduced-motion.png', '.film-block');
    await pageD.click('#film-play');
    await waitState(pageD, `!document.getElementById('film').paused`, 8000).catch(() => {});
    await pageD.waitForTimeout(500);
    s = await state(pageD);
    out.D_play = s;
    console.log('D_play', JSON.stringify(s));
    check('D reduced-motion Play click starts with sound ON', s.paused === false && s.muted === false, { paused: s.paused, muted: s.muted });

    /* visible focus via real Tab key */
    await pageD.evaluate(`(function(){document.body.setAttribute('tabindex','-1');document.body.focus();return true;})()`);
    let focused = null;
    for (let i = 0; i < 26; i++) {
      await pageD.keyboard.press('Tab');
      await pageD.waitForTimeout(40);
      const id = await pageD.evaluate(`document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : ''`);
      if (String(id).indexOf('film-') === 0) { focused = id; break; }
    }
    const focusStyle = await pageD.evaluate(`(function(){var el=document.activeElement;var cs=getComputedStyle(el);return {id:el.id||el.tagName,outlineStyle:cs.outlineStyle,outlineWidth:cs.outlineWidth,outlineColor:cs.outlineColor};})()`);
    out.D_focus = focusStyle;
    console.log('D_focus', JSON.stringify(focusStyle));
    check('D keyboard focus is visibly outlined on a film control', focusStyle.outlineStyle !== 'none' && parseFloat(focusStyle.outlineWidth) >= 1, focusStyle);
    await ctxD.close();

    /* ── Scenario E: mobile 390×844 ──────────────────────────────────────── */
    const ctxE = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pageE = await ctxE.newPage();
    await pageE.goto(URL, { waitUntil: 'load' });
    await fontsReady(pageE);
    await waitControls(pageE);
    await pageE.waitForTimeout(900);
    s = await state(pageE);
    out.E_mobile = s;
    console.log('E_mobile', JSON.stringify(s));
    check('E mobile: no horizontal overflow', s.docScrollW <= s.innerW + 1, { scrollW: s.docScrollW, innerW: s.innerW });
    check('E mobile: language targets ≥44px', s.enHeight >= 44 && s.deHeight >= 44, { en: s.enHeight, de: s.deHeight });
    check('E mobile: sound target ≥44px', s.soundHeight >= 44, s.soundHeight);
    check('E mobile: sound/play actions are full-width rows', s.soundWidth >= 300, s.soundWidth);
    out.shot_mobile = await shot(pageE, 'film-controls-mobile-390.png', '.film-block');
    await ctxE.close();

    /* ── Scenario F: missing film fallback ───────────────────────────────── */
    const ctxF = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctxF.route('**/assets/film.mp4', (route) => route.abort('failed'));
    const pageF = await ctxF.newPage();
    await pageF.goto(URL, { waitUntil: 'load' });
    await fontsReady(pageF);
    await pageF.waitForTimeout(2500);
    s = await state(pageF);
    const posterVisible = await pageF.evaluate(`(function(){var p=document.getElementById('film-poster');return !!p && p.offsetParent!==null;})()`);
    out.F_missing = Object.assign({}, s, { posterVisible });
    console.log('F_missing', JSON.stringify(out.F_missing));
    check('F missing film: no video shown (poster holds)', s.hasVideo === false, s.hasVideo);
    check('F missing film: controls hidden, no dead buttons', s.controlsHidden === true && s.soundHeight === 0 && s.playHeight === 0 && s.enHeight === 0, { controlsHidden: s.controlsHidden, soundHeight: s.soundHeight, playHeight: s.playHeight, enHeight: s.enHeight });
    check('F missing film: poster still visible', posterVisible === true);
    await ctxF.close();

    /* ── Scenario G: page integrity (brand, privacy, a11y state, no errors) ─ */
    const ctxG = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const pageG = await ctxG.newPage();
    const pageErrors = [];
    pageG.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
    await pageG.goto(URL, { waitUntil: 'load' });
    await fontsReady(pageG);
    await pageG.waitForTimeout(700);
    const brand = await pageG.evaluate(`document.querySelector('[data-brand="product"]').textContent`);
    const detailsBefore = await pageG.evaluate(`document.getElementById('data').open`);
    await pageG.click('[data-open="data"]');
    const detailsAfter = await pageG.evaluate(`document.getElementById('data').open`);
    const legacyTextbtn = await pageG.evaluate(`document.querySelectorAll('.textbtn').length`);
    const controlsRole = await pageG.evaluate(`(function(){var c=document.getElementById('film-controls');return {groups:c.querySelectorAll('[role="group"]').length, pressed:c.querySelectorAll('[aria-pressed]').length};})()`);
    out.G = { brand, detailsBefore, detailsAfter, legacyTextbtn, controlsRole, pageErrors };
    console.log('G', JSON.stringify(out.G));
    check('G brand renders from the NAME constant', brand === 'Tacet', brand);
    check('G privacy ledger still opens from its one-line link', detailsBefore === false && detailsAfter === true, { before: detailsBefore, after: detailsAfter });
    check('G no legacy tiny text links remain', legacyTextbtn === 0, legacyTextbtn);
    check('G controls expose accessible state attributes', controlsRole.groups >= 2 && controlsRole.pressed >= 3, controlsRole);
    check('G no uncaught page errors', pageErrors.length === 0, pageErrors);
    await ctxG.close();

    out.summary = { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).map((c) => c.name) };
    fs.writeFileSync('/tmp/film-controls-result.json', JSON.stringify({ checks, out }, null, 2));
    console.log('\nSUMMARY', JSON.stringify(out.summary));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });
