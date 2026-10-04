// Automated CDP truth test. Synthetic cases and scripted expert choices; real core/LLM, no simulator.
(async function () {
  const API = 'http://localhost:8001';
  async function request(path, body) {
    const r = await fetch(API + path, body ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {});
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  const pause = ms => new Promise(r=>setTimeout(r,ms));
  const events = [];
  const demos = [];
  shadowObserve.on(e=>events.push(e));
  shadowObserve.refresh();
  for (const team of ['Engineering','Dispatch','Engineering']) {
    const control = document.getElementById('assigned_team');
    control.value = team; control.dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('save_ticket').click();
    demos.push(events.splice(0));
    document.getElementById('next').click();
    await pause(350);
  }
  const onboard = await request('/api/onboard', {goal:'Route each service ticket to the right team.',events:true,demos,pack_id:'sol_service_desk',expert:'Service expert'});
  const sid = onboard.session.id;
  for (const event of events.splice(0)) await request(`/api/sessions/${sid}/events`,event);
  const control = document.getElementById('assigned_team');
  control.value = 'Dispatch'; control.dispatchEvent(new Event('change',{bubbles:true}));
  document.getElementById('save_ticket').click();
  for (const event of events.splice(0)) await request(`/api/sessions/${sid}/events`,event);
  await pause(2200);
  const snapshot = await request(`/api/sessions/${sid}`);
  const match = await request('/api/workflows/match',{url:location.href,fields:shadowObserve.snapshot().fields.map(f=>f.name),actions:['save_ticket']});
  window.solTruth = {sid,task:onboard.task,metrics:snapshot.metrics,episodes:snapshot.episodes,awaiting:snapshot.awaiting,match,health:await request('/health'),demos};
})().catch(e=>{window.solTruth={error:e.message};});
