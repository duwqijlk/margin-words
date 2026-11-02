// Actual sync engine, isolated storage and mocked transport. No live accounts, mail or sound.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=new URL(process.argv[2]||'http://127.0.0.1:8098/');
const browser=await chromium.launch({executablePath:process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  for(const k of ['tutorial','feedback-tip','quote-tip'])localStorage.setItem('cibian-'+k+'-v1','seen');
  HTMLMediaElement.prototype.play=async()=>{};if(window.speechSynthesis)window.speechSynthesis.speak=()=>{};
  if(localStorage.getItem('fixture-seeded'))return;
  localStorage.setItem('fixture-seeded','1');
  localStorage.setItem('cibian-locale-v1','en');
  localStorage.setItem('cibian-device-owner-v1','fixture@example.test');
  localStorage.setItem('cibian-prefs-v1',JSON.stringify({version:0,state:{theme:'sepia',font:'lora',size:23,leading:2.05,column:45,wordHints:'underline',quietMarks:false,pronunciationAccent:'UK'}}));
  // An old dirty record must not erase unrelated pending data or produce preference echoes.
  localStorage.setItem('cibian-sync-dirty-v1','1');
  localStorage.setItem('cibian-sync-server-v1',JSON.stringify({email:'fixture@example.test',cursor:1,fullAt:Date.now(),sigs:{}}));
  HTMLMediaElement.prototype.play=async()=>{};if(window.speechSynthesis)window.speechSynthesis.speak=()=>{};
 });
 let server=[{kind:'settings',itemId:'main',updatedAt:10,deleted:false,data:{theme:'dark',font:'sans',size:30,locale:'zh',wordHints:'off',quietMarks:true,reviewLog:{'2026-11-01':{reviewed:3,correct:2}},readDays:['2026-11-01']}}];
 const calls=[],pushes=[];let cursor=Date.now();
 await context.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url());if(u.origin!==base.origin)return r.abort();
  const json=(data,status=200)=>r.fulfill({contentType:'application/json',status,body:JSON.stringify(data)});
  if(u.pathname==='/src/lib/sync-engine.ts'){const response=await r.fetch();return r.fulfill({response,body:(await response.text())+`\nwindow.__engineStores={useVocab,useProgress,useQuotes,useAccount};`});}
  const stores={ '/src/lib/account-store.ts':['__syncAccount','useAccount'], '/src/lib/vocab-store.ts':['__syncVocab','useVocab'], '/src/lib/reader-prefs.ts':['__syncPrefs','usePrefs'], '/src/lib/progress-store.ts':['__syncProgress','useProgress'], '/src/lib/quote-store.ts':['__syncQuotes','useQuotes'], '/src/lib/i18n.ts':['__syncLocale','useLocale'] };
  if(stores[u.pathname]){const response=await r.fetch();const [key,name]=stores[u.pathname];return r.fulfill({response,body:(await response.text())+`\nwindow.${key}=${name};`});}
  if(u.pathname==='/local-preferences-fixture')return r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Isolated sync engine regression</title></head><body></body></html>'});
  if(u.pathname==='/api/auth/me')return json({user:{email:'fixture@example.test',nickname:'Fixture',emailVerified:true,role:'user',publicId:'abc123def456',avatar:0}});
  if(u.pathname==='/api/sync'){
   calls.push({method:q.method(),query:u.search});
   if(q.method()==='GET')return json({items:server,cursor:++cursor});
   const incoming=q.postDataJSON().items;pushes.push(incoming);
   // Real server normalizes legacy preference defaults into its response. Ignore them client-side.
   const saved=incoming.map(item=>item.kind==='settings'?{...item,data:{theme:'light',font:'literata',size:20,locale:'en',wordHints:'subtle',quietMarks:false,...item.data}}:item);
   for(const item of saved){const at=server.findIndex(old=>old.kind===item.kind&&old.itemId===item.itemId);if(at<0)server.push(item);else server[at]=item;}
   return json({items:saved,cursor:++cursor});
  }
  if(u.pathname.startsWith('/api/'))return json({});return r.continue();
 });
 const page=await context.newPage();await page.clock.install();const errors=[];page.on('pageerror',e=>errors.push(e.message));

 const boot=async()=>page.evaluate(async()=>{
  await import('/src/lib/i18n.ts');
  const prefs=await import('/src/lib/reader-prefs.ts');
  const vocab=await import('/src/lib/vocab-store.ts');
  const progress=await import('/src/lib/progress-store.ts');
  const quotes=await import('/src/lib/quote-store.ts');
  await Promise.all([prefs.usePrefs.persist.rehydrate(),vocab.useVocab.persist.rehydrate(),progress.useProgress.persist.rehydrate(),quotes.useQuotes.persist.rehydrate()]);
  const engine=await import('/src/lib/sync-engine.ts');
  window.__syncVocab=window.__engineStores.useVocab;window.__syncProgress=window.__engineStores.useProgress;window.__syncQuotes=window.__engineStores.useQuotes;window.__syncAccount=window.__engineStores.useAccount;
  window.__stopSync=engine.startAccountSync();engine.notifySyncReady();
 });
 await page.goto(new URL('local-preferences-fixture',base).href);await boot();
 await page.waitForFunction(async()=>{return window.__syncAccount?.getState().sync==='saved';});
 const local=async()=>page.evaluate(async()=>{const p=window.__syncPrefs.getState();return {theme:p.theme,font:p.font,size:p.size,wordHints:p.wordHints,locale:window.__syncLocale.getState().locale};});
 assert.deepEqual(await local(),{theme:'sepia',font:'lora',size:23,wordHints:'underline',locale:'en'});
 assert.ok(calls.some(c=>c.method==='GET'&&!c.query),'old signatures require one full pull');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cibian-sync-server-v1'))?.version===2);
 // Let startup/hydration catch-up finish before measuring preference-driven increments.
 await page.clock.fastForward(10000);await page.waitForFunction(async()=>window.__syncAccount.getState().sync==='saved');
 const before=calls.length;
 await page.evaluate(async()=>{const usePrefs=window.__syncPrefs,useLocale=window.__syncLocale;for(let i=0;i<12;i++){usePrefs.getState().set({theme:i%2?'dark':'light',font:i%2?'sans':'literata',size:16+i,leading:1.6,column:30+i,focus:!!(i%2),paging:!!(i%2),pronunciationAccent:i%2?'UK':'US',wordHints:['subtle','underline','off'][i%3]});useLocale.getState().setLocale(i%2?'en':'zh');}});
 await page.clock.fastForward(120000);await page.waitForTimeout(20);
 assert.equal(calls.length,before,'setting/locale changes create zero extra sync GET or POST: '+JSON.stringify(calls));
 assert.notEqual(await page.evaluate(()=>localStorage.getItem('cibian-sync-dirty-v1')),'1');
 const chosen=await local();
 // Real retained-store updates must still schedule uploads and merge histories.
 const historyUploaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sync'&&r.request().method()==='POST'&&r.request().postDataJSON().items.some(i=>i.kind==='settings'));
 await page.evaluate(async()=>{const useVocab=window.__syncVocab;useVocab.setState({log:{'2026-11-01':{reviewed:5,correct:4}},readDays:['2026-11-01','2026-11-02']});});
 await page.waitForFunction(()=>localStorage.getItem('cibian-sync-dirty-v1')==='1');
 await page.clock.fastForward(10000);await page.waitForFunction(async()=>localStorage.getItem('cibian-sync-dirty-v1')!=='1'&&window.__syncAccount.getState().sync==='saved');
 await historyUploaded;
 assert.ok(pushes.flat().some(item=>item.kind==='settings'&&item.data.reviewLog['2026-11-01'].reviewed===5),'review history still uploads: '+JSON.stringify({pushes,server,calls}));
 for(const item of pushes.flat().filter(i=>i.kind==='settings'))assert.deepEqual(Object.keys(item.data).sort(),['readDays','reviewLog'],'client never uploads device preferences');
 assert.deepEqual(await local(),chosen,'server-normalized preferences do not overwrite local changes');
 const afterHistory=calls.length;
 await page.clock.fastForward(120000);
 const pulledAgain=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sync'&&r.request().method()==='GET');
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));await pulledAgain;await page.waitForFunction(async()=>window.__syncAccount.getState().sync==='saved');
 assert.equal(pushes.flat().filter(i=>i.kind==='settings').length,1,'follow-up flush does not echo settings defaults');
 assert.ok(calls.length>=afterHistory);
 // Independent synchronized data types still flow through the actual engine.
 for(const kind of ['shelf','progress','wordbook','quotes']){
  const count=pushes.length;
  const uploaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sync'&&r.request().method()==='POST'&&r.request().postDataJSON().items.some(i=>i.kind===kind));
  await page.evaluate(async kind=>{const now=Date.now();const useVocab=window.__syncVocab;if(kind==='shelf')useVocab.setState({books:[{id:'local-pref-fixture',title:'Synthetic book',author:'Fixture',source:'epub',cloth:'cloth',createdAt:now,updatedAt:now}]});if(kind==='progress')window.__syncProgress.setState({items:{'local-pref-fixture':{chapter:0,chapters:1,scroll:.2,updatedAt:now}}});if(kind==='wordbook')useVocab.setState({words:[{id:'local-pref-word',lemma:'lantern',surface:'lantern',pos:'noun',meaning:'A portable light.',whyHard:'',sentence:'A lantern stood by the door.',recommend:true,stage:0,dueAt:now,createdAt:now,updatedAt:now,reps:0,lapses:0,sources:[]}]});if(kind==='quotes')window.__syncQuotes.setState({quotes:[{id:'local-pref-quote',book:'synthetic book|fixture',title:'Synthetic book',author:'Fixture',chapter:0,paragraph:0,start:0,end:23,text:'A quiet light remained.',savedAt:now}],removed:[]});},kind);
  await page.waitForFunction(()=>localStorage.getItem('cibian-sync-dirty-v1')==='1');
  await page.clock.fastForward(10000);await page.waitForFunction(async()=>localStorage.getItem('cibian-sync-dirty-v1')!=='1'&&window.__syncAccount.getState().sync==='saved');
  await uploaded;
  assert.ok(pushes.slice(count).flat().some(i=>i.kind===kind),`${kind} still uploads`);
 }
 await page.reload();await boot();await page.waitForFunction(async()=>window.__syncAccount.getState().sync==='saved');
 assert.deepEqual(await local(),chosen,'device settings persist through reload/session refresh');
 assert.deepEqual(errors,[]);console.log('PASS actual engine: local preference/locale changes add zero sync requests or dirty state; remote preferences ignored; histories and shelf/progress/wordbook/quotes still upload; old view upgrades and response signatures converge.');
 await context.close();
}finally{await browser.close();}
