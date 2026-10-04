/* Focused refinement harness for site/index.html film controls.
   Real Google Chrome, headless, DEFAULT autoplay policy (no policy flags).
   Static server on :8141 with HTTP Range. New checks for the refined design and
   behaviour — the old 45-check label/style assumptions are not reused. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.TACET_PLAYWRIGHT_MODULE || '/private/tmp/tacet-sol-tools/node_modules/playwright');

const REPO = '/Users/shubhamjoshi/Hacknation 2';
const ROOT = path.join(REPO, 'site');
const PORT = 8141;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = '/tmp/film-refine-shots';
const URL = `http://127.0.0.1:${PORT}/index.html`;
const MIME = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };

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
          res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1, 'cache-control': 'no-store' });
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
  var cap=document.getElementById('film-caption');
  function cs(el,p){return el?getComputedStyle(el,p):null;}
  function h(el){return el?Math.round(el.getBoundingClientRect().height*100)/100:null;}
  function w(el){return el?Math.round(el.getBoundingClientRect().width*100)/100:null;}
  function top(el){return el?Math.round(el.getBoundingClientRect().top):null;}
  var soundCS=cs(sound), enCS=cs(en), deCS=cs(de), playCS=cs(play), statusCS=cs(status);
  return {
    readyState:v.readyState, paused:v.paused, muted:v.muted, volume:v.volume,
    currentTime:Math.round((v.currentTime||0)*100)/100,
    duration:isFinite(v.duration)?Math.round(v.duration*100)/100:null,
    src:v.getAttribute('src'), vlang:v.getAttribute('lang'),
    hasVideo:slot.classList.contains('has-video'), controlsHidden:controls.hidden,
    langLabelPresent:!!document.getElementById('film-lang-label'),
    controlsText:controls.textContent.replace(/\\s+/g,' ').trim(),
    legacyInside:controls.querySelectorAll('.btn,.seg,.ctl').length,
    tabGroupLabel:(function(){var g=document.getElementById('film-lang-tabs');return g?g.getAttribute('aria-label'):null;})(),
    soundPressed:sound.getAttribute('aria-pressed'), soundText:document.getElementById('film-sound-label').textContent.trim(),
    soundLabel:sound.getAttribute('aria-label'), soundBg:soundCS.backgroundColor, soundColor:soundCS.color,
    soundFont:soundCS.fontSize, soundHeight:h(sound), soundWidth:w(sound), soundTop:top(sound),
    soundAfterHeight:(function(){var s=getComputedStyle(sound,'::after');return s?s.height:null;})(),
    soundHasSvg:!!sound.querySelector('svg'), soundPrimary:sound.classList.contains('primary'),
    statusText:status.textContent.trim(), statusRole:status.getAttribute('role'),
    statusLive:status.getAttribute('aria-live'), statusSr:status.classList.contains('sr'),
    statusClip:statusCS.clipPath||statusCS.clip,
    playHidden:play.hidden, playText:document.getElementById('film-play-label').textContent.trim(),
    playHeight:h(play), playWidth:w(play), playFont:playCS.fontSize,
    enPressed:en.getAttribute('aria-pressed'), dePressed:de.getAttribute('aria-pressed'),
    enPending:en.getAttribute('data-pending'), dePending:de.getAttribute('data-pending'),
    enBusy:en.getAttribute('aria-busy'), deBusy:de.getAttribute('aria-busy'),
    enHeight:h(en), deHeight:h(de), enFont:enCS.fontSize, enTop:top(en),
    enUnderline:enCS.borderBottomColor, deUnderline:deCS.borderBottomColor, enBg:enCS.backgroundColor,
    enAfterHeight:(function(){var s=getComputedStyle(en,'::after');return s?s.height:null;})(),
    controlsHeight:h(controls),
    captionHidden:cap.hidden, captionText:cap.textContent.trim().slice(0,120),
    autoplayPolicy:(typeof navigator.getAutoplayPolicy==='function')?navigator.getAutoplayPolicy('mediaelement'):'unavailable',
    docScrollW:document.documentElement.scrollWidth, innerW:window.innerWidth
  };
})()`;

const checks = [];
function check(name, cond, detail) {
  checks.push({ name, pass: !!cond, detail: detail === undefined ? null : detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}
const TRANSPARENT = (c) => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
const SAGE = 'rgb(78, 107, 68)';

async function state(page) { return page.evaluate(STATE); }
async function fontsReady(page) {
  await page.evaluate(`Promise.race([(document.fonts&&document.fonts.ready)?document.fonts.ready.then(()=>true):Promise.resolve(true), new Promise(r=>setTimeout(()=>r(true),4000))])`);
}
async function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(page, fn, timeout = 20000) { await page.waitForFunction(fn, null, { timeout }); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const out = {};
  console.error('[step] browser up');
  try {
    /* ── A · refined design + honest default sound ───────────────────────── */
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctxA.newPage();
    await page.goto(URL, { waitUntil: 'load' });
    await fontsReady(page);
    await waitFor(page, `document.getElementById('film').readyState>=1`);
    await delay(700);
    let s = await state(page);
    out.A_initial = s;
    console.log('A_initial', JSON.stringify(s));
    check('A controls visible once metadata is known', s.controlsHidden === false && s.hasVideo === true);
    check('A no visible "Language" label', s.langLabelPresent === false && !/Language/i.test(s.controlsText), { langLabelPresent: s.langLabelPresent });
    check('A no legacy pill/segment/btn inside controls', s.legacyInside === 0, s.legacyInside);
    check('A single visual row is 36px', Math.abs(s.controlsHeight - 36) <= 1.5, s.controlsHeight);
    check('A each control has an invisible 44px touch area', s.soundAfterHeight === '44px' && s.enAfterHeight === '44px', { sound: s.soundAfterHeight, en: s.enAfterHeight });
    check('A 13px type on tabs and sound', s.enFont === '13px' && s.soundFont === '13px', { en: s.enFont, sound: s.soundFont });
    check('A transparent tab and sound backgrounds (no fills)', TRANSPARENT(s.enBg) && TRANSPARENT(s.soundBg), { enBg: s.enBg, soundBg: s.soundBg });
    check('A sound control is not the dark primary fill', s.soundPrimary === false);
    check('A sound control has an inline speaker SVG', s.soundHasSvg === true);
    check('A exactly one language is pressed (confirmed)', (s.enPressed === 'true') !== (s.dePressed === 'true'), { en: s.enPressed, de: s.dePressed });
    check('A pressed language has a thin underline, the other none', !TRANSPARENT(s.enUnderline) && TRANSPARENT(s.deUnderline), { en: s.enUnderline, de: s.deUnderline });
    check('A honest default-policy muted fallback', s.muted === true && s.soundText === 'Sound off', { muted: s.muted, sound: s.soundText, policy: s.autoplayPolicy });
    check('A no redundant visible sound status at rest', s.statusRole === 'status' && s.statusLive === 'polite' && s.statusText === '' && s.statusSr === true, { text: s.statusText, sr: s.statusSr });
    await page.locator('.film-bar').screenshot({ path: path.join(SHOTS, 'refine-muted.png') });

    /* click Sound off → sound on, quiet sage, no primary fill */
    await page.click('#film-sound');
    await page.waitForFunction(`getComputedStyle(document.getElementById('film-sound')).color==='rgb(78, 107, 68)'`, null, { timeout: 5000 }).catch(() => {});
    await delay(150);
    s = await state(page);
    out.A_sound_on = s;
    console.log('A_sound_on', JSON.stringify(s));
    check('A Sound off click turns sound on', s.muted === false && s.volume > 0 && s.soundText === 'Sound on' && s.soundPressed === 'true', { muted: s.muted, text: s.soundText });
    check('A sound-on state is quiet sage, no fill', s.soundColor === SAGE && TRANSPARENT(s.soundBg), { color: s.soundColor, bg: s.soundBg });
    check('A status stays visually hidden when there is nothing to say', s.statusText === '' && s.statusSr === true);
    await page.locator('.film-bar').screenshot({ path: path.join(SHOTS, 'refine-sound-on.png') });

    /* click again → explicit mute */
    await page.click('#film-sound');
    await delay(250);
    s = await state(page);
    check('A explicit mute shows Sound off honestly', s.muted === true && s.soundText === 'Sound off' && s.soundPressed === 'false');
    await ctxA.close();

    /* ── B · immediate sound during buffering (no finish/restart) ─────────── */
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctxB.route('**/assets/film.mp4', async (route) => { await delay(2500); await route.continue(); });
    const pageB = await ctxB.newPage();
    await pageB.goto(URL, { waitUntil: 'domcontentloaded' });
    await waitFor(pageB, `document.getElementById('film').muted===true`, 6000).catch(() => {});
    let bs = await state(pageB);
    out.B_buffering = bs;
    console.log('B_buffering', JSON.stringify(bs));
    check('B mid-buffer: no media data yet and sound honestly off', bs.readyState === 0 && bs.muted === true && bs.soundText === 'Sound off', { readyState: bs.readyState, muted: bs.muted });
    await pageB.click('#film-sound');
    bs = await state(pageB);
    check('B sound click unmutes during that gesture, while still buffering', bs.muted === false && bs.soundText === 'Sound on' && bs.readyState === 0, { muted: bs.muted, readyState: bs.readyState });
    await waitFor(pageB, `!document.getElementById('film').paused && document.getElementById('film').currentTime>0`, 15000).catch(() => {});
    await delay(400);
    bs = await state(pageB);
    out.B_started = bs;
    console.log('B_started', JSON.stringify(bs));
    check('B playback starts with sound once data arrives (no restart/finish needed)', bs.paused === false && bs.muted === false && bs.src.indexOf('film.mp4') >= 0, { paused: bs.paused, muted: bs.muted, src: bs.src });
    await ctxB.close();

    /* ── C · latest language wins over an in-flight swap ──────────────────── */
    const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctxC.route('**/assets/film.mp4', async (route) => { await delay(1800); await route.continue(); });
    await ctxC.route('**/assets/film.de.mp4', async (route) => { await delay(1800); await route.continue(); });
    const pageC = await ctxC.newPage();
    await pageC.goto(URL, { waitUntil: 'load' });
    await waitFor(pageC, `document.getElementById('film-controls') && !document.getElementById('film-controls').hidden`);
    await pageC.click('#film-lang-de');
    let cs = await state(pageC);
    out.C_de_pending = cs;
    console.log('C_de_pending', JSON.stringify(cs));
    check('C loading a language shows Loading Deutsch', cs.statusText === 'Loading Deutsch' && cs.statusSr === false, cs.statusText);
    check('C pending tab is busy but NOT marked confirmed', cs.dePressed === 'false' && cs.dePending === 'true' && cs.deBusy === 'true', { pressed: cs.dePressed, pending: cs.dePending });
    await pageC.locator('.film-bar').screenshot({ path: path.join(SHOTS, 'refine-loading.png') });
    await pageC.click('#film-lang-en');
    cs = await state(pageC);
    out.C_latest = cs;
    console.log('C_latest', JSON.stringify(cs));
    check('C latest click replaces the in-flight swap (Loading English)', cs.statusText === 'Loading English', cs.statusText);
    await waitFor(pageC, `document.getElementById('film').readyState>=1 && document.getElementById('film').getAttribute('src').indexOf('film.de.mp4')<0`, 15000);
    await delay(1200);
    cs = await state(pageC);
    out.C_settled = cs;
    console.log('C_settled', JSON.stringify(cs));
    check('C the latest language is the confirmed one', cs.enPressed === 'true' && cs.dePressed === 'false' && cs.vlang === 'en', { en: cs.enPressed, de: cs.dePressed, lang: cs.vlang });
    check('C pending/busy flags clear and status returns to hidden', cs.enPending === 'false' && cs.dePending === 'false' && cs.statusText === '' && cs.statusSr === true, { en: cs.enPending, de: cs.dePending, status: cs.statusText });
    check('C stale German response did not overwrite English', cs.src.indexOf('film.mp4') >= 0 && cs.enPressed === 'true', cs.src);
    await ctxC.close();

    /* ── D · position, playing state and explicit mute preserved ──────────── */
    const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const pageD = await ctxD.newPage();
    await pageD.goto(URL, { waitUntil: 'load' });
    await waitFor(pageD, `document.getElementById('film').readyState>=1`);
    /* make the mute an explicit viewer choice (not the browser fallback) */
    if ((await state(pageD)).soundPressed === 'false') { await pageD.click('#film-sound'); await delay(200); }
    await pageD.click('#film-sound');
    await delay(200);
    await pageD.evaluate(`(function(){var v=document.getElementById('film');v.currentTime=7.0;return true;})()`);
    await delay(400);
    let ds = await state(pageD);
    const before = ds;
    check('D start: playing and explicitly muted', ds.paused === false && ds.muted === true && ds.soundText === 'Sound off', { paused: ds.paused, muted: ds.muted, text: ds.soundText });
    await pageD.click('#film-lang-de');
    await waitFor(pageD, `document.getElementById('film').readyState>=1 && document.getElementById('film').getAttribute('lang')==='de'`, 15000);
    await waitFor(pageD, `!document.getElementById('film').paused`, 8000).catch(() => {});
    await delay(500);
    ds = await state(pageD);
    out.D_de = ds;
    console.log('D_de', JSON.stringify(ds));
    check('D position carried across EN→DE (did not restart)', ds.currentTime >= before.currentTime - 0.2 && ds.currentTime - before.currentTime <= 2.0, { before: before.currentTime, after: ds.currentTime });
    check('D explicit mute preserved across EN→DE', ds.muted === true && ds.soundText === 'Sound off', { muted: ds.muted, text: ds.soundText });
    check('D playing state preserved across EN→DE', ds.paused === false, ds.paused);
    check('D German is confirmed, English is not', ds.dePressed === 'true' && ds.enPressed === 'false');
    /* DE→EN while playing, now with sound explicitly on */
    await pageD.click('#film-sound');
    await delay(250);
    const onState = await state(pageD);
    const t2 = onState.currentTime;
    check('D sound turns on by the same gesture', onState.muted === false && onState.soundText === 'Sound on');
    await pageD.click('#film-lang-en');
    await waitFor(pageD, `document.getElementById('film').readyState>=1 && document.getElementById('film').getAttribute('lang')==='en'`, 15000);
    await waitFor(pageD, `!document.getElementById('film').paused`, 8000).catch(() => {});
    await delay(500);
    ds = await state(pageD);
    out.D_back_en = ds;
    console.log('D_back_en', JSON.stringify(ds));
    check('D did not restart on DE→EN', ds.currentTime >= t2 - 0.6 && ds.currentTime > 2, { before: t2, after: ds.currentTime });
    check('D sound-on choice preserved across DE→EN', ds.muted === false && ds.soundText === 'Sound on', { muted: ds.muted });
    await ctxD.close();

    /* ── E · captions clear and re-render in the new language ─────────────── */
    const ctxE = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctxE.route('**/assets/film.de.mp4', async (route) => { await delay(1200); await route.continue(); });
    const pageE = await ctxE.newPage();
    await pageE.goto(URL, { waitUntil: 'load' });
    await waitFor(pageE, `document.getElementById('film').readyState>=2`);
    await pageE.evaluate(`(function(){var v=document.getElementById('film');v.currentTime=9.0;return true;})()`);
    await waitFor(pageE, `!document.getElementById('film-caption').hidden`, 8000).catch(() => {});
    let es = await state(pageE);
    const enCaption = es.captionText;
    out.E_en_caption = enCaption;
    console.log('E_en_caption', JSON.stringify({ text: enCaption }));
    check('E English caption renders at ~9s', es.captionHidden === false && /Mira writes|guess/i.test(enCaption), enCaption);
    await pageE.click('#film-lang-de');
    es = await state(pageE);
    check('E old caption clears immediately on switch', es.captionHidden === true && es.captionText === '', { hidden: es.captionHidden, text: es.captionText });
    await waitFor(pageE, `document.getElementById('film').getAttribute('lang')==='de' && document.getElementById('film').readyState>=2`, 15000);
    await waitFor(pageE, `!document.getElementById('film-caption').hidden`, 8000).catch(() => {});
    es = await state(pageE);
    out.E_de_caption = es.captionText;
    console.log('E_de_caption', JSON.stringify({ text: es.captionText }));
    check('E the German caption then renders (current language)', es.captionHidden === false && es.captionText !== '' && es.captionText !== enCaption, { de: es.captionText, en: enCaption });
    await ctxE.close();

    /* ── F · reduced motion never autoplays ──────────────────────────────── */
    const ctxF = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const pageF = await ctxF.newPage();
    await pageF.goto(URL, { waitUntil: 'load' });
    await waitFor(pageF, `document.getElementById('film').readyState>=1`);
    await delay(600);
    let fsx = await state(pageF);
    out.F_reduce = fsx;
    console.log('F_reduce', JSON.stringify(fsx));
    check('F reduced motion does not autoplay', fsx.paused === true, fsx.paused);
    check('F reduced motion waits with a quiet Play', fsx.playHidden === false && fsx.playText === 'Play' && fsx.playFont === '13px', { hidden: fsx.playHidden, text: fsx.playText });
    await pageF.click('#film-play');
    await waitFor(pageF, `!document.getElementById('film').paused`, 8000).catch(() => {});
    await delay(300);
    fsx = await state(pageF);
    check('F Play click starts with sound and hides the control', fsx.paused === false && fsx.muted === false && fsx.playHidden === true, { paused: fsx.paused, muted: fsx.muted, hidden: fsx.playHidden });
    /* a paused (reduced-motion) viewer who switches language stays paused and in place */
    const pageF2 = await ctxF.newPage();
    await pageF2.goto(URL, { waitUntil: 'load' });
    await waitFor(pageF2, `document.getElementById('film').readyState>=1`);
    await pageF2.evaluate(`(function(){var v=document.getElementById('film');v.currentTime=9.0;return true;})()`);
    await delay(300);
    const f2before = await state(pageF2);
    await pageF2.click('#film-lang-de');
    await waitFor(pageF2, `document.getElementById('film').getAttribute('lang')==='de' && document.getElementById('film').readyState>=1`, 15000);
    await delay(500);
    const f2after = await state(pageF2);
    out.F_paused_switch = f2after;
    console.log('F_paused_switch', JSON.stringify({ paused: f2after.paused, currentTime: f2after.currentTime }));
    check('F paused switch stays paused and keeps the exact position', f2after.paused === true && Math.abs(f2after.currentTime - f2before.currentTime) <= 0.1, { paused: f2after.paused, before: f2before.currentTime, after: f2after.currentTime });
    await ctxF.close();

    /* ── G · failure leaves working retry/switch controls ────────────────── */
    const ctxG = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    let blockFilm = true;
    await ctxG.route('**/assets/film.mp4', (route) => blockFilm ? route.abort('failed') : route.continue());
    await ctxG.route('**/assets/film.de.mp4', (route) => blockFilm ? route.abort('failed') : route.continue());
    const pageG = await ctxG.newPage();
    await pageG.goto(URL, { waitUntil: 'load' });
    await waitFor(pageG, `/load/i.test(document.getElementById('film-sound-status').textContent)`, 8000).catch(() => {});
    await delay(400);
    let gs = await state(pageG);
    out.G_error = gs;
    console.log('G_error', JSON.stringify(gs));
    check('G failure shows a concise visible error status', /load/i.test(gs.statusText) && gs.statusSr === false, gs.statusText);
    check('G failure keeps the switch controls in place', gs.controlsHidden === false && gs.enHeight > 30 && gs.deHeight > 30 && gs.soundHeight > 30, { en: gs.enHeight, de: gs.deHeight, sound: gs.soundHeight });
    await pageG.locator('.film-bar').screenshot({ path: path.join(SHOTS, 'refine-error.png') });
    blockFilm = false;
    await pageG.click('#film-lang-en');
    await waitFor(pageG, `document.getElementById('film').readyState>=1`, 15000);
    await delay(600);
    gs = await state(pageG);
    out.G_retry = gs;
    console.log('G_retry', JSON.stringify(gs));
    check('G clicking a language retries and recovers', gs.hasVideo === true && gs.enPressed === 'true', { hasVideo: gs.hasVideo, en: gs.enPressed });
    check('G status clears after a successful retry', gs.statusText === '' && gs.statusSr === true);
    await ctxG.close();

    /* ── H · keyboard focus + a11y state ─────────────────────────────────── */
    const ctxH = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const pageH = await ctxH.newPage();
    await pageH.goto(URL, { waitUntil: 'load' });
    await waitFor(pageH, `document.getElementById('film').readyState>=1`);
    const groupLabel = (await state(pageH)).tabGroupLabel;
    check('H language group has an accessible name, no visible label', groupLabel === 'Film language', groupLabel);
    await pageH.evaluate(`(function(){document.body.setAttribute('tabindex','-1');document.body.focus();return true;})()`);
    let focusStyle = null;
    for (let i = 0; i < 40; i++) {
      await pageH.keyboard.press('Tab');
      await pageH.waitForTimeout(35);
      focusStyle = await pageH.evaluate(`(function(){var el=document.activeElement;var cs=getComputedStyle(el);return {id:el.id||el.tagName,outlineStyle:cs.outlineStyle,outlineWidth:cs.outlineWidth,outlineColor:cs.outlineColor};})()`);
      if (String(focusStyle.id).indexOf('film-') === 0) break;
    }
    out.H_focus = focusStyle;
    console.log('H_focus', JSON.stringify(focusStyle));
    check('H a film control is reachable and shows a visible focus ring', String(focusStyle.id).indexOf('film-') === 0 && focusStyle.outlineStyle !== 'none' && parseFloat(focusStyle.outlineWidth) >= 2, focusStyle);
    await ctxH.close();

    /* ── I · mobile: slim single row, no overflow, no full-width buttons ─── */
    const ctxI = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pageI = await ctxI.newPage();
    await pageI.goto(URL, { waitUntil: 'load' });
    await waitFor(pageI, `document.getElementById('film').readyState>=1`);
    await delay(500);
    let is = await state(pageI);
    out.I_mobile = is;
    console.log('I_mobile', JSON.stringify(is));
    check('I mobile: no horizontal overflow', is.docScrollW <= is.innerW + 1, { scrollW: is.docScrollW, innerW: is.innerW });
    check('I mobile: tabs and sound stay on one slim row', Math.abs(is.enTop - is.soundTop) <= 16 && is.controlsHeight <= 38, { enTop: is.enTop, soundTop: is.soundTop, row: is.controlsHeight });
    check('I mobile: 13px slim controls, not full-width buttons', is.enFont === '13px' && is.soundWidth < 220, { font: is.enFont, soundWidth: is.soundWidth });
    check('I mobile: touch area still 44px', is.enAfterHeight === '44px' && is.soundAfterHeight === '44px');
    await pageI.locator('.film-block').screenshot({ path: path.join(SHOTS, 'refine-mobile.png') });
    await ctxI.close();

    /* ── J · page integrity ──────────────────────────────────────────────── */
    const ctxJ = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const pageJ = await ctxJ.newPage();
    const pageErrors = [];
    pageJ.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
    await pageJ.goto(URL, { waitUntil: 'load' });
    await fontsReady(pageJ);
    await waitFor(pageJ, `document.getElementById('film').readyState>=1`);
    await delay(500);
    const brand = await pageJ.evaluate(`document.querySelector('[data-brand="product"]').textContent`);
    const detailsBefore = await pageJ.evaluate(`document.getElementById('data').open`);
    await pageJ.click('[data-open="data"]');
    const detailsAfter = await pageJ.evaluate(`document.getElementById('data').open`);
    out.J = { brand, detailsBefore, detailsAfter, pageErrors };
    console.log('J', JSON.stringify(out.J));
    check('J brand renders from the NAME constant', brand === 'Tacet', brand);
    check('J privacy ledger still opens from its one-line link', detailsBefore === false && detailsAfter === true, { before: detailsBefore, after: detailsAfter });
    check('J no uncaught page errors', pageErrors.length === 0, pageErrors);
    await ctxJ.close();

    out.summary = { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).map((c) => c.name) };
    fs.writeFileSync('/tmp/film-refine-result.json', JSON.stringify({ checks, out }, null, 2));
    console.log('\nSUMMARY', JSON.stringify(out.summary));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });
