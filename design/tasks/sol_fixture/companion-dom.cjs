// Browser-independent companion/observer integration checks. No simulator or LLM calls.
const {JSDOM}=require('/private/tmp/tacet-sol-tools/node_modules/jsdom');
const fs=require('fs'), assert=require('assert/strict'), pause=ms=>new Promise(r=>setTimeout(r,ms));
const fixture=fs.readFileSync('design/tasks/sol_fixture/tickets.html','utf8');
async function test(verdict){
  const dom=new JSDOM(fixture,{url:'http://localhost:8011/tickets.html?case=T-1',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window,d=w.document,requests=[],sockets=[];
  w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
  w.SHADOW_API='http://localhost:8001';
  const snap={id:'test-pinned-session',mode:'capture',expert:'Test expert',simulated:false,pack:{id:'new_task',name:'Service routing'},metrics:{}};
  w.fetch=async(url,opts)=>{
    const path=new URL(url).pathname,body=opts?.body?JSON.parse(opts.body):undefined;
    requests.push({path,body});
    const value=path==='/api/config'?{}:path==='/api/workflows/match'?{verdict:verdict==='ambiguous'?'ask':verdict,best:verdict==='new'?null:{id:'existing_task',name:'Existing routing'},candidates:verdict==='ambiguous'?[{id:'existing_task',name:'Existing routing',score:1},{id:'other_task',name:'Another task',score:1}]:[]}:path==='/api/onboard'?{session:snap}:snap;
    return {ok:true,json:async()=>value};
  };
  w.WebSocket=class {
    constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
    send(v){this.sent.push(JSON.parse(v));} close(){this.readyState=3;this.onclose?.();}
  };
  try {
    w.eval(fs.readFileSync('backend/shadow/static/capture.js','utf8'));
    w.eval(fs.readFileSync('backend/shadow/static/observe.js','utf8'));
    await pause(30);
    const root=d.querySelector('[data-shadow-ui="companion"]').shadowRoot,$=id=>root.getElementById(id);
    assert(!sockets[0].sent.some(e=>e.type==='observe'),'unassigned observer leaked events');
    assert(sockets[0].url.endsWith('follow_latest=false'));
    $('b-learn').click();await pause(20);
    if(verdict!=='new'){
      assert(!$('learn-choose').hidden&&$('learn-match').textContent.includes('Existing routing'));
      if(verdict==='ambiguous'){
        assert(!$('learn-workflow-choice').hidden);
        $('learn-workflow').value='other_task';$('learn-continue').click();await pause(20);
        assert.equal(requests.find(x=>x.path==='/api/sessions').body.pack,'other_task');return;
      }
      if(verdict==='same'){
        $('learn-continue').click();await pause(20);
        const req=requests.find(x=>x.path==='/api/sessions');
        assert.equal(req.body.pack,'existing_task');assert.equal(req.body.fresh,false);assert.equal(req.body.simulate,false);
        return;
      }
      assert($('learn-match').textContent.startsWith('Is this '));
      $('learn-new').click();
    }
    $('learn-goal').value='Route service tickets to the right team';
    $('learn-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert($('hc-s').textContent.startsWith('Watching'));
    assert($('learn-done').disabled);
    $('learn-stop').click();assert($('hc-s').textContent==='Watching stopped');
    $('learn-resume').click();
    for(const team of ['Engineering','Dispatch','Engineering']){
      const control=d.getElementById('assigned_team');control.value=team;control.dispatchEvent(new w.Event('change',{bubbles:true}));
      d.getElementById('save_ticket').click();d.getElementById('next').click();await pause(350);
    }
    assert($('learn-count').textContent.includes('3 demonstrations saved'));
    $('learn-done').click();await pause(30);
    const req=requests.find(x=>x.path==='/api/onboard');
    assert.equal(req.body.events,true);assert.equal(req.body.demos.length,3);
    for(const demo of req.body.demos){
      assert.equal(demo.filter(e=>e.type==='action').length,1);
      assert.equal(demo[0].fields.find(f=>f.name==='assigned_team').value,'Support','demo leaked its outcome into opening facts');
    }
    assert.equal(w.sessionStorage.getItem('shadow.session'),snap.id);
    assert(sockets.at(-1).url.includes('?session='+snap.id));
    assert(sockets.at(-1).sent.some(e=>e.type==='observe'&&e.session===snap.id));
    assert($('learn').hidden&&$('sess-t').textContent.includes('Live'));
    assert(!requests.some(x=>x.body?.pack==='ap_invoices'),'new workflow fell back to invoices');
  } finally {dom.window.close();}
}
(async()=>{for(const verdict of ['new','same','ask','ambiguous'])await test(verdict);console.log('Companion DOM checks passed: new/three demos/stop/resume/pin/continue/ask/ambiguous selection.');})().catch(e=>{console.error(e);process.exitCode=1;});
