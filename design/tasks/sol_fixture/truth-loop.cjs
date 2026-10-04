// Real :8001 API/LLM loop driven by observe.js in local DOM emulation.
// It does not use shadow.sim, and is not browser visual verification.
const {JSDOM} = require('/private/tmp/tacet-sol-tools/node_modules/jsdom');
const fs = require('fs'), assert = require('assert/strict');
const API = 'http://localhost:8001', pause = ms => new Promise(r=>setTimeout(r,ms));
async function api(path,body) {
  const r=await fetch(API+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});
  const data=await r.json(); if(!r.ok) throw new Error(`${path}: ${r.status} ${data.detail}`); return data;
}
(async()=>{
  const dom=new JSDOM(fs.readFileSync('design/tasks/sol_fixture/tickets.html','utf8'),{url:'http://localhost:8011/tickets.html?case=T-1',runScripts:'dangerously',pretendToBeVisual:true});
  try {
    const w=dom.window, d=w.document, events=[];
    w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
    w.eval(fs.readFileSync('backend/shadow/static/observe.js','utf8'));
    await pause(50); w.shadowObserve.on(e=>events.push(e)); w.shadowObserve.refresh();
    function choose(team){d.getElementById('assigned_team').value=team;d.getElementById('assigned_team').dispatchEvent(new w.Event('change',{bubbles:true}));}
    async function next(){d.getElementById('next').click();await pause(350);}
    const demos=[];
    for(const team of ['Engineering','Dispatch','Engineering']){choose(team);d.getElementById('save_ticket').click();demos.push(events.splice(0));await next();}
    assert(demos.every(x=>x.filter(e=>e.type==='action').length===1),'native click/submit duplicated a demo');
    const r=await api('/api/onboard',{goal:'Route each service ticket to the right team.',events:true,demos,pack_id:'sol_service_loop_live',expert:'Service expert',workspace:'sol-live'});
    const sid=r.session.id, path=`/api/sessions/${sid}`;
    async function flush(){for(const e of events.splice(0))await api(path+'/events',e);}
    async function snapshot(){return api(path);}
    async function waitUntil(check,ms=45000){const until=Date.now()+ms;while(Date.now()<until){const s=await snapshot();if(check(s))return s;await pause(250);}throw Error('Timed out waiting for core learning state');}
    await flush();
    let s=await snapshot();const first=s.current_case,before=s.predictions[first].fields.assigned_team?.value;
    // A deliberately surprising, scripted expert policy, unknown to the code.
    const choice=before==='Dispatch'?'Engineering':'Dispatch';
    choose(choice);d.getElementById('save_ticket').click();await flush();
    s=await waitUntil(s=>s.pending.awaiting);
    assert(s.activity.paused,'question was asked outside a pause');
    const asked=s.inquiries.find(q=>q.id===s.pending.awaiting);
    const answer=`Premium service tickets open fewer than 8 hours always go to ${choice}. Other Premium tickets go to Dispatch. Standard tickets go to Engineering.`;
    await api(path+'/utterance',{text:answer});
    s=await waitUntil(s=>!s.pending.compiling&&s.map.rules.some(r=>r.then.assigned_team===choice));
    const rules=s.map.rules, receipt=s.receipts;
    await next();await flush();s=await snapshot();const later=s.current_case,prediction=s.predictions[later].fields.assigned_team;
    assert.equal(prediction.value,choice);assert.notEqual(prediction.source,'novice');
    choose(choice);d.getElementById('save_ticket').click();await flush();
    await api(path+'/debrief',{});
    await api(path+'/utterance',{text:'[[shadow:debrief]]'});
    const followups=[];
    for(let i=0;i<24;i++){
      s=await snapshot();const q=s.inquiries.find(q=>q.id===s.pending.awaiting);assert(q,'debrief did not ask');followups.push(q);
      // Label from the visible hypothetical, never from Mira's frozen expected answer.
      const facts={...(s.cases.find(c=>c.id===q.case_id)?.facts||{})};
      const visible=q.probe_delta||q.text;
      const level=visible.match(/Service level is (Standard|Premium)/i)||visible.match(/Service level[:=]? (Standard|Premium)/i);
      const hours=visible.match(/Hours open is ([\d.]+)/i)||visible.match(/Hours open[:=]? ([\d.]+)/i);
      if(level)facts.service_level=level[1];if(hours)facts.open_hours=Number(hours[1]);
      const team=facts.service_level==='Premium'?(facts.open_hours<8?choice:'Dispatch'):'Engineering';
      const text=q.type==='confirm'||q.type==='teachback'?'Yes, that is correct.':q.field==='assigned_team'?`Assign ${team}.`:q.field==='action'?'Save routing. There are no additional stop conditions in this simple test task.':answer;
      await api(path+'/utterance',{text});
      s=await snapshot();if(s.understood.done)break;
      if(q.type==='teachback')break;
    }
    const exports={};for(const fmt of ['json','md','skill']){const resp=await fetch(API+path+'/export/'+fmt);assert(resp.ok);exports[fmt]=await resp.text();}
    const tutor=await api('/api/sessions',{mode:'tutor',pack:r.pack_id,from_session:sid,trainee:'Test learner',workspace:'sol-live'});
    const snap=w.shadowObserve.snapshot();await api(`/api/sessions/${tutor.id}/events`,{type:'observe',url:snap.url,title:snap.title,fields:snap.fields});
    const ts=await api(`/api/sessions/${tutor.id}`), cid=ts.current_case;
    const wrong=choice==='Dispatch'?'Support':'Dispatch';
    const blocked=await api('/api/capture/before_save',{session:tutor.id,case_id:cid,booking:{assigned_team:wrong},action:'save_ticket'});
    assert.equal(blocked.allow,false);
    const allowed=await api('/api/capture/before_save',{session:tutor.id,case_id:cid,booking:{assigned_team:choice},action:'save_ticket'});assert.equal(allowed.allow,true);
    const match=await api('/api/workflows/match',{url:snap.url,fields:snap.fields.map(f=>f.name),actions:snap.actions.map(a=>a.name),workspace:'sol-live'});assert.equal(match.verdict,'same');assert.equal(match.best.id,r.pack_id);
    const health=await api('/health');assert(health.spend.usd<1,'test exceeded budget');
    const final=await snapshot();
    fs.writeFileSync('design/tasks/sol_fixture/truth-after.json',JSON.stringify({method:'DOM emulation + real API/LLM (browser CDP blocked)',sid,pack:r.pack_id,demos,before,choice,asked,answer,rules,receipt,later_prediction:prediction,followups,exports,tutor:tutor.id,blocked,allowed,match,metrics:final.metrics,understood:final.understood,spend:health.spend},null,2));
    console.log(JSON.stringify({sid,pack:r.pack_id,before,choice,later_prediction:prediction,questions:followups.length,tutor_blocked:!blocked.allow,match:match.verdict,metrics:final.metrics,spend:health.spend},null,2));
  } finally {dom.window.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
