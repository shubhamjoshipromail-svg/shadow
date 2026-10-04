// Local DOM emulation when this workspace cannot launch headless Chrome.
// This is an API/observer test, not a claim of browser visual verification.
const {JSDOM} = require('/private/tmp/tacet-sol-tools/node_modules/jsdom');
const fs = require('fs');
const dom = new JSDOM(fs.readFileSync('design/tasks/sol_fixture/tickets.html','utf8'), {
  url:'http://localhost:8011/tickets.html?case=T-1',runScripts:'dangerously',pretendToBeVisual:true
});
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({width:100,height:30});
dom.window.fetch = fetch;
dom.window.eval(fs.readFileSync('backend/shadow/static/observe.js','utf8'));
setTimeout(()=>dom.window.eval(fs.readFileSync('design/tasks/sol_fixture/truth-browser.js','utf8')),10);
const poll = setInterval(()=>{
  const result = dom.window.solTruth;
  if (!result) return;
  clearInterval(poll);
  const summary = {sid:result.sid,metrics:result.metrics,match:result.match,spend:result.health?.spend,error:result.error};
  fs.writeFileSync('design/tasks/sol_fixture/truth-before.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(summary,null,2));
  dom.window.close();
},250);
setTimeout(()=>{clearInterval(poll);dom.window.close();process.exit(1)},90000).unref();
