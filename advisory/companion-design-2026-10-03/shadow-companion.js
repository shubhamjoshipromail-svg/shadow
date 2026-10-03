/* Standalone presentation component. No capture, microphone, backend, or dependencies. */
const artwork = new URL('./assets/intern-sprite-study.png', import.meta.url).href;
let instance = 0;
const STATES = {
  idle: ['Here when you need me', 'Observing', ''],
  question: ['One question, when you have a moment', 'Question ready', '?'],
  listening: ['Listening', 'Listening', ''],
  thinking: ['Checking what I learned', 'Checking', ''],
  learned: ['Added to my notes', 'Noted', '✓'],
  paused: ['Observation paused', 'Paused', 'Ⅱ'],
  offline: ['Connection unavailable', 'Offline', '–'],
};

export class ShadowCompanion extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._state = 'idle';
    this._open = false;
    this._motion = true;
    this._question = 'What made you choose a different route for this one?';
    this._uid = `shadow-intern-${++instance}`;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) return;
    const id = this._uid;
    this.shadowRoot.innerHTML = `
      <style>
        :host{--shadow-size:56px;--paper:#fffdf7;--ink:#30362f;--muted:#697165;--line:#e0e3d8;--accent:#627857;display:block;width:calc(var(--shadow-size) + 8px);font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);color-scheme:light}
        *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid #6f854f;outline-offset:4px}
        .anchor{position:relative;width:100%}.portrait{display:block;width:var(--shadow-size);height:calc(var(--shadow-size)*1.23);border:0;padding:0;margin:0 auto;background:none;position:relative;opacity:.86;transition:opacity .18s;touch-action:manipulation}.portrait:hover,.portrait:focus-visible,.anchor.open .portrait{opacity:1}.portrait svg{display:block;width:100%;height:100%;overflow:hidden;image-rendering:pixelated}
        .blink{animation:blink 8.6s steps(1,end) infinite;opacity:0}.curl{animation:curl 19s steps(2,end) infinite}
        @keyframes blink{0%,91%,94%,100%{opacity:0}92%,93%{opacity:1}}
        @keyframes curl{0%,79%,100%{transform:translate(0,0)}83%,86%{transform:translate(3px,0)}90%{transform:translate(1px,0)}}
        .badge{position:absolute;right:-2px;top:5px;display:none;align-items:center;justify-content:center;min-width:17px;height:17px;border-radius:5px;background:#efe3bb;color:#67552c;border:1px solid #d8c999;font:600 11px/1 ui-monospace,monospace}.question .badge,.learned .badge,.paused .badge,.offline .badge{display:flex}.learned .badge{background:#e4ecdc;color:#48663d;border-color:#bacbad}.paused .badge,.offline .badge{background:#f1f0e9;color:#797d72;border-color:#dadcd3}
        .paused .portrait,.offline .portrait{filter:saturate(.3);opacity:.65}.paused .blink,.paused .curl,.offline .blink,.offline .curl,.still .blink,.still .curl{animation:none}.listening .portrait,.question .portrait{opacity:1}
        .hint{position:absolute;bottom:20px;right:calc(100% + 10px);padding:7px 11px;background:var(--paper);border:1px solid var(--line);border-radius:9px;color:var(--muted);font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transform:translateX(3px);transition:opacity .15s,transform .15s}.portrait:hover~.hint,.portrait:focus-visible~.hint{opacity:1;transform:none}.open .hint{display:none}
        .panel{position:absolute;bottom:calc(var(--shadow-size)*1.23 + 14px);right:0;width:min(304px,calc(100vw - 40px));background:var(--paper);border:1px solid var(--line);border-radius:15px;box-shadow:0 8px 26px #26321d12;padding:18px;display:none}.open .panel{display:block}
        .heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.brand{font-weight:650;font-size:13px}.close{border:0;background:none;font-size:20px;line-height:20px;color:var(--muted);padding:3px 4px}.status{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);margin-top:2px}.status i{width:5px;height:5px;border-radius:50%;background:#8b9d76;display:inline-block}.paused .status i,.offline .status i{background:#989d93}.question .status i{background:#b49858}
        .message{font-size:14px;line-height:1.55;margin:16px 0;color:var(--ink)}.meta{font-size:11px;line-height:1.6;color:var(--muted);margin:0 0 14px}.row{display:flex;gap:7px;align-items:center}.answer{min-width:0;flex:1;border:1px solid var(--line);border-radius:7px;background:#fff;padding:9px 10px;color:var(--ink);font-size:12px}.send{padding:8px 11px;border:1px solid #556b49;border-radius:7px;background:#637a57;color:#fff;font-size:12px}.actions{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:15px;padding-top:12px;border-top:1px solid var(--line)}.text-button{border:0;background:none;color:var(--muted);font-size:11px;padding:3px 0;text-decoration:underline;text-underline-offset:3px}.live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}[hidden]{display:none!important}
        @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
      </style>
      <div class="anchor idle">
        <section class="panel" id="${id}-panel" role="dialog" aria-label="Shadow companion" hidden>
          <div class="heading"><div><span class="brand">Shadow</span><div class="status"><i></i><span>Observing</span></div></div><button class="close" aria-label="Close companion">×</button></div>
          <p class="message"></p><p class="meta"></p>
          <form class="row" hidden><input class="answer" aria-label="Answer Shadow" placeholder="A short answer is enough…" autocomplete="off"><button class="send" type="submit">Send</button></form>
          <div class="actions"><button class="text-button later" hidden>Ask me later</button><button class="text-button pause">Pause</button><button class="text-button notebook">Open notebook ↗</button></div>
        </section>
        <button class="portrait" aria-label="Open Shadow — here when you need me" aria-expanded="false" aria-controls="${id}-panel">
          <svg viewBox="145 96 426 520" aria-hidden="true" focusable="false">
            <defs>
              <clipPath id="${id}-eyes"><ellipse cx="313" cy="294" rx="28" ry="24"/><ellipse cx="404" cy="289" rx="27" ry="24"/></clipPath>
              <clipPath id="${id}-curl"><path d="M470 329 L515 333 L537 362 L524 380 L509 386 L493 410 L468 401 L479 381 L487 365 Z"/></clipPath>
            </defs>
            <image href="${artwork}" width="1254" height="1254"/>
            <g clip-path="url(#${id}-eyes)" class="blink"><image href="${artwork}" width="1254" height="1254" transform="translate(-552 0)"/></g>
            <g class="curl"><g clip-path="url(#${id}-curl)"><image href="${artwork}" width="1254" height="1254"/></g></g>
          </svg>
          <span class="badge" aria-hidden="true"></span>
        </button>
        <span class="hint" aria-hidden="true">Here when you need me</span>
        <span class="live" aria-live="polite" aria-atomic="true"></span>
      </div>`;
    const $ = s => this.shadowRoot.querySelector(s);
    $('.portrait').addEventListener('click', () => this.toggle());
    $('.close').addEventListener('click', () => this.toggle(false));
    $('.pause').addEventListener('click', () => this.emit(this._state === 'paused' ? 'resume' : 'pause'));
    $('.later').addEventListener('click', () => { this.emit('defer'); this.toggle(false); });
    $('.notebook').addEventListener('click', () => this.emit('notebook'));
    $('form').addEventListener('submit', e => { e.preventDefault(); const value = $('.answer').value.trim(); if (value) { this.emit('answer', { text: value }); $('.answer').value = ''; } });
    this.shadowRoot.addEventListener('keydown', e => { if (e.key === 'Escape') { this.toggle(false); $('.portrait').focus(); } });
    this.update();
  }

  emit(action, detail = {}) { this.dispatchEvent(new CustomEvent('shadow-action', { detail: { action, ...detail }, bubbles: true, composed: true })); }
  setState(state, options = {}) {
    if (!STATES[state]) throw new Error(`Unknown companion state: ${state}`);
    this._state = state;
    if (typeof options.question === 'string') this._question = options.question;
    this.update();
  }
  setMotion(enabled) { this._motion = Boolean(enabled); this.update(); }
  toggle(force) {
    this._open = typeof force === 'boolean' ? force : !this._open;
    this.update();
    if (this._open) this.shadowRoot.querySelector(this._state === 'question' ? '.answer' : '.close').focus();
  }
  update() {
    if (!this.shadowRoot.childElementCount) return;
    const $ = s => this.shadowRoot.querySelector(s);
    const [hint, status, badge] = STATES[this._state];
    $('.anchor').className = `anchor ${this._state}${this._open ? ' open' : ''}${this._motion ? '' : ' still'}`;
    $('.panel').hidden = !this._open;
    $('.portrait').setAttribute('aria-expanded', String(this._open));
    $('.portrait').setAttribute('aria-label', `Open Shadow — ${hint}`);
    $('.hint').textContent = hint;
    $('.status span').textContent = status;
    $('.badge').textContent = badge;
    $('.live').textContent = this._state === 'idle' ? '' : hint;
    $('.message').textContent = {
      idle: 'Keep going. I’ll save my questions for a pause.', question: this._question,
      listening: 'Take your time. I’m listening.', thinking: 'I’m checking that against what you showed me.',
      learned: 'Added to my notes. I’ll check it on the next example.', paused: 'I’m paused. Resume whenever you’re ready.',
      offline: 'I can’t reach Shadow right now.',
    }[this._state];
    $('.meta').textContent = this._state === 'learned' ? 'A note is not a verified rule yet.' : this._state === 'question' ? 'Answer now, or save it for the debrief.' : 'Your work stays in front. I’m here when you need me.';
    $('form').hidden = this._state !== 'question';
    $('.later').hidden = this._state !== 'question';
    $('.pause').textContent = this._state === 'paused' ? 'Resume' : 'Pause';
  }
}
if (!customElements.get('shadow-intern')) customElements.define('shadow-intern', ShadowCompanion);
