// npm install --prefix /private/tmp/tacet-sol-tools --cache /private/tmp/tacet-npm-cache playwright
// Start the isolated :8001 core and a static server at :8011, then run with node.
const {chromium} = require(process.env.SOL_PLAYWRIGHT || '/private/tmp/tacet-sol-tools/node_modules/playwright');
const fs = require('fs');
const API = 'http://localhost:8001';
async function request(path, body) {
  const r = await fetch(API + path, body ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {});
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
(async () => {
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8011/tickets.html?case=T-1');
    await page.addScriptTag({url:API+'/observe.js'});
    await page.evaluate(() => {
      window.events = [];
      shadowObserve.on(e => events.push(e));
      shadowObserve.refresh();
    });
    const demos = [];
    for (const team of ['Support','Engineering','Dispatch']) {
      await page.selectOption('#assigned_team', team);
      await page.click('#save_ticket');
      demos.push(await page.evaluate(() => events.splice(0)));
      await page.click('#next');
      await page.waitForTimeout(350);
    }
    const onboard = await request('/api/onboard', {goal:'Route each service ticket to the right team.',events:true,demos,pack_id:'sol_service_desk',expert:'Service expert'});
    const sid = onboard.session.id;
    for (const event of await page.evaluate(() => events.splice(0))) await request(`/api/sessions/${sid}/events`,event);
    await page.selectOption('#assigned_team','Dispatch');
    await page.click('#save_ticket');
    for (const event of await page.evaluate(() => events.splice(0))) await request(`/api/sessions/${sid}/events`,event);
    await page.waitForTimeout(2200);
    const snapshot = await request(`/api/sessions/${sid}`);
    const match = await request('/api/workflows/match',await page.evaluate(() => ({url:location.href,fields:shadowObserve.snapshot().fields.map(f=>f.name),actions:['save_ticket']})));
    const result = {sid,task:onboard.task,metrics:snapshot.metrics,episodes:snapshot.episodes,awaiting:snapshot.awaiting,match,health:await request('/health')};
    fs.writeFileSync('design/tasks/sol_fixture/truth-before.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify({sid,metrics:snapshot.metrics,awaiting:snapshot.awaiting,match,spend:result.health.spend},null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
