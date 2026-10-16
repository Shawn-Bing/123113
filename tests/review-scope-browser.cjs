'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const html=path.resolve(process.argv[2]||[path.join(__dirname,'../index.html'),path.join(__dirname,'../site/index.html')].find(fs.existsSync));
const fixtures=path.resolve(__dirname,'../tests/fixtures'),root=path.dirname(html),results=[];
const output=process.env.REVIEW_BROWSER_OUTPUT;
const {startFixtureServer}=require('./browser-fixture-server.cjs');let service;
const prefix='dictation_preview_',key=name=>prefix+name;
async function storage(page){return page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('dictation_preview_')).map(([k,v])=>[k,JSON.parse(v)])));}
async function seed(page,values){await page.evaluate(values=>{localStorage.clear();for(const [k,v]of Object.entries(values))localStorage.setItem('dictation_preview_'+k,JSON.stringify(v));location.hash='#wrong';},values);await page.reload();await page.locator('#wrong-chapter').waitFor();}
async function restore(page,backup){
 await page.locator('[data-act="backup-menu"]').first().click();await page.locator('#toast').evaluate(el=>el.textContent='');
 const event=page.waitForEvent('filechooser');await page.locator('[data-act="restore"]').click();await (await event).setFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
 await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('合并恢复'));
 if(await page.locator('[data-act="close-modal"]').count())await page.locator('[data-act="close-modal"]').first().click();
}
async function downloadCSV(page){const event=page.waitForEvent('download');await page.locator('[data-act="export-wrong"]').click();return fs.readFileSync(await (await event).path(),'utf8');}
async function downloadTXT(page){await page.locator('[data-act="answers-txt"]').click();const event=page.waitForEvent('download');await page.locator('[data-act="export-answers"][data-type="filtered"]').click();return fs.readFileSync(await (await event).path(),'utf8');}
function draft(id,items,inputs=items.map(()=>'')){return {id,sid:items.length===1?items[0].sid:'review',mode:'dictation',order:'normal',items,inputs,states:inputs.map(()=>''),idx:0,started:false,elapsed:0,filter:'all',marked:[]};}
async function submit(page,inputs){await page.evaluate(()=>location.hash='#practice');await page.reload();await page.locator('[data-act="start"]').click();for(let i=0;i<inputs.length;i++){const input=page.locator('[data-answer="'+i+'"]');await input.fill(inputs[i]);await input.press('Enter');}await page.locator('[data-act="finish-confirm"]').click();await page.waitForFunction(()=>location.hash==='#result');await page.evaluate(()=>location.hash='#wrong');await page.locator('#wrong-chapter').waitFor();}
async function played(page,item){
 const clip=await page.evaluate(item=>DICT_REVIEW_PUBLICATION.clips[item.sid+':'+item.index],item);
 const file=path.join(fixtures,clip.url),bytes=fs.readFileSync(file);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),clip.sha256,'fixture must match published original audio');
 await page.locator('[data-act="speak"][data-sid="'+item.sid+'"][data-index="'+item.index+'"]').click();
 await page.waitForFunction(url=>{const a=document.querySelector('#dictation-audio');return a.src.endsWith(url)&&a.readyState>=2&&a.played.length>0;},clip.url);
 return {sid:item.sid,index:item.index,sha256:clip.sha256,...await page.locator('#dictation-audio').evaluate(a=>({src:a.src,duration:a.duration}))};
}
async function prepareSubmission(page,id,item,input){
 if(await page.locator('[data-act="leave"]').count())await page.locator('[data-act="leave"]').click();
 await page.evaluate(()=>location.hash='#wrong');await page.locator('#wrong-chapter').waitFor();
 await page.evaluate(value=>{localStorage.setItem('dictation_preview_dict3_draft',JSON.stringify(value));location.hash='#practice';},draft(id,[item]));await page.reload();await page.locator('[data-act="start"]').click();await page.locator('[data-answer="0"]').fill(input);await page.locator('[data-answer="0"]').press('Enter');assert.equal((await storage(page))[key('dict3_draft')].id,id);await page.locator('[data-act="finish-confirm"]').waitFor();
}
async function holdEvidenceLock(page){
 await page.evaluate(()=>{window.qaLockReady=false;window.qaHeld=navigator.locks.request('dictation_preview_dict3-evidence-transaction',()=>new Promise(resolve=>{window.qaRelease=resolve;window.qaLockReady=true;}));});await page.waitForFunction(()=>window.qaLockReady);
 return async()=>{await page.evaluate(()=>window.qaRelease());await page.evaluate(()=>window.qaHeld);};
}
(async()=>{
 service=await startFixtureServer(html);const url=service.url+'?preview=1#wrong';
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  async function check(name,fn){
   const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
   try{await page.goto(url);await page.locator('#wrong-chapter').waitFor();const items=await page.evaluate(()=>['C11-T1','C3-T3'].map(sid=>DictationCore.itemsFor(DICT_DATA,sid).find(item=>item.w==='demonstration')));const evidence=await fn(page,items);assert.deepEqual(errors,[]);results.push({name,passed:true,evidence});}
   catch(error){results.push({name,passed:false,error:error.stack,pageErrors:errors});if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,results.length+'-failure.png'),fullPage:true});}}
   finally{await context.close();}
  }
  await check('P1 mixed pending chapter after actual submission',async(page,[a,b])=>{
   await seed(page,{dict3_draft:draft('confirmed',[a]),dict2_wrong:{demonstration:{sid:b.sid,index:b.index,n:5,ts:1}}});await submit(page,['demonstratiom']);
   assert.match(await page.locator('#wrong-list').innerText(),/另有待确认旧证据/);
   await page.locator('[data-act="wrong-evidence"]').click();
   assert.match(await page.locator('[data-evidence-group="confirmed"]').innerText(),/原题计错 · 1 次/);assert.ok(!(await page.locator('[data-evidence-group="confirmed"]').innerText()).includes(b.sid));
   assert.match(await page.locator('[data-evidence-group="unresolved"]').innerText(),/缺少原始输入/);assert.match(await page.locator('[data-evidence-group="cumulative"]').innerText(),/5 次（未验证）/);
   assert.match(await page.locator('#modal-root').innerText(),/另有待核实证据/);if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'mixed-evidence.png'),fullPage:true});}await page.locator('[data-act="close-modal"]').first().click();
   await page.locator('#wrong-chapter').selectOption(b.sid);assert.equal(await page.locator('[data-wrong-count="pending"]').innerText(),'0');assert.ok(await page.locator('[data-act="review-all"]').isDisabled());
   await page.locator('[data-act="wrong-filter"][data-value="uncertain"]').click();assert.match(await page.locator('#wrong-list').innerText(),/原始输入缺失/);assert.ok(await page.locator('[data-act="review-all"]').isDisabled());
   const csv=await downloadCSV(page);assert.ok(csv.includes(b.sid));assert.ok(!csv.includes(a.sid));assert.ok(!csv.includes('demonstratiom'));
   let downloads=0;const onDownload=()=>downloads++;page.on('download',onDownload);await page.locator('[data-act="answers-txt"]').click();await page.locator('[data-act="export-answers"][data-type="filtered"]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('没有符合条件'));await page.locator('[data-act="close-modal"]').first().click();assert.equal(downloads,0);page.off('download',onDownload);
   await page.locator('#wrong-chapter').selectOption(a.sid);await page.locator('[data-act="wrong-filter"][data-value="pending"]').click();const audio=await played(page,a);
   assert.equal((await downloadTXT(page)).trim(),'demonstration');
   await page.locator('[data-act="review-all"]').click();await page.locator('[data-act="begin"]').click();const saved=await storage(page);assert.equal(saved[key('dict3_draft')].items.length,1);assert.equal(saved[key('dict3_draft')].items[0].sid,a.sid);return {csv,audio};
  });
  await check('P1 chapter typo, count, evidence and CSV after actual two-source submission',async(page,[a,b])=>{
   await seed(page,{dict3_draft:draft('both',[a,b])});await submit(page,['demonstratiom','demonstartion']);
   for(const [item,input,other] of [[a,'demonstratiom','demonstartion'],[b,'demonstartion','demonstratiom']]){
    await page.locator('#wrong-chapter').selectOption(item.sid);const text=await page.locator('#wrong-list').innerText();assert.ok(text.includes(input));assert.ok(!text.includes(other));assert.match(text,/1 次/);
    const csv=await downloadCSV(page);assert.ok(csv.includes(input));assert.ok(!csv.includes(other));await played(page,item);
    assert.equal((await downloadTXT(page)).trim(),item.w);
    await page.locator('[data-act="wrong-evidence"]').click();assert.ok(!(await page.locator('#modal-root').innerText()).includes(other));await page.locator('[data-act="close-modal"]').first().click();
   }
   return {chapters:2,actualSubmissions:2};
  });
  await check('P1 colliding draft JSON restore is stable in both orders and after reload/export',async(page,[item])=>{
   const a=draft('r100',[item],['local']),b=draft('r100',[item],['imported']);
   const backup=value=>({records:[{id:'preserved',sid:item.sid,mode:'dictation',ts:100,ms:1,rows:[{...item,in:'demonstratiom'}]}],wrong:{demonstration:{sid:item.sid,index:item.index,n:5,in:'demonstrationn',ts:50}},draft:value,drafts:[value]});
   for(const [first,second]of [[a,b],[b,a]]){
    await seed(page,{dict3_draft:first});await restore(page,backup(second));const once=await storage(page);
    for(let i=0;i<3;i++)await restore(page,backup(second));assert.deepEqual(await storage(page),once);assert.equal(once[key('dict3_saved_drafts')].length,1);assert.deepEqual(once[key('dict3_draft')],first);
    await page.reload();await restore(page,backup(second));assert.deepEqual(await storage(page),once);
    await page.locator('[data-act="backup-menu"]').first().click();const event=page.waitForEvent('download');await page.locator('[data-act="backup"]').click();const exported=JSON.parse(fs.readFileSync(await (await event).path(),'utf8'));
    await seed(page,{});await restore(page,exported);const imported=await storage(page);await restore(page,backup(second));assert.deepEqual(await storage(page),imported);assert.equal(imported[key('dict3_saved_drafts')].length,2);
   }
   await seed(page,{dict3_draft:a,dict3_saved_drafts:[{...b,id:'r100-import-1'}]});await restore(page,backup(b));assert.equal((await storage(page))[key('dict3_saved_drafts')].length,2);const once=await storage(page);await restore(page,backup(b));assert.deepEqual(await storage(page),once);
   return {orders:2,repeatedRestores:8,ambiguousOldSuffixPreserved:true,exportRoundTrip:true};
  });
  await check('P1 review button remains disabled when no original vocabulary item resolves',async(page)=>{
   await seed(page,{dict2_wrong:{'removed word':{sid:'C11-T1',index:-1,in:'typo',n:1}}});assert.match(await page.locator('#wrong-list').innerText(),/removed word/);assert.ok(await page.locator('[data-act="review-all"]').isDisabled());
   await page.locator('#wrong-search').fill('removed');assert.ok(await page.locator('[data-act="review-all"]').isDisabled());return {initialAndSearchDisabled:true};
  });
  await check('P2 original suffix IDs remain separate from explicit import lineage',async(page,[item])=>{
   const backup=value=>({records:[],wrong:{},draft:value}),a=draft('r100',[item],['same']),b={...a,id:'r100-import-1'};
   for(const [first,second]of [[a,b],[b,a]]){await seed(page,{dict3_draft:first});await restore(page,backup(second));assert.equal((await storage(page))[key('dict3_saved_drafts')].length,1);assert.equal((await storage(page))[key('dict3_saved_drafts')][0].id,second.id);const once=await storage(page);await page.reload();await restore(page,backup(second));assert.deepEqual(await storage(page),once);}
   await seed(page,{dict3_saved_drafts:[{...b,importSourceId:a.id}]});await restore(page,backup(a));assert.equal((await storage(page))[key('dict3_saved_drafts')].length,1);
   await restore(page,backup(b));assert.equal((await storage(page))[key('dict3_saved_drafts')].length,2);const once=await storage(page);await restore(page,backup(b));assert.deepEqual(await storage(page),once);return {originalSuffixOrders:2,explicitImportCollisionPreserved:true};
  });
  await check('P2 stable legacy rows count individually while cumulative claims do not multiply',async(page,[item])=>{
   const backup=await page.evaluate(item=>{const snapshots={};for(let i=0;i<5;i++){const id=DictationCore.stableJSON(['bundled-legacy-records',item.sid,i,item.w,'demonstratiom']);snapshots[id]={word:item.w,sid:item.sid,index:item.index,hasInput:true,in:'demonstratiom',n:1,sourceId:id};}return {records:[],wrong:{[item.w]:{...DictationCore.evidenceEntry(item.w),legacySnapshots:snapshots}}};},item);
   await seed(page,{});await restore(page,backup);assert.match(await page.locator('#wrong-list').innerText(),/5 次/);const once=await storage(page);await restore(page,backup);assert.deepEqual(await storage(page),once);
   await page.locator('[data-act="wrong-evidence"]').click();assert.equal(await page.locator('[data-evidence-group="confirmed"] tbody tr').count(),5);await page.locator('[data-act="close-modal"]').first().click();
   const unknown={records:[],wrong:{[item.w]:{sid:item.sid,index:item.index,in:'demonstratiom',n:5}}};await seed(page,{});for(let i=0;i<3;i++)await restore(page,unknown);assert.match(await page.locator('#wrong-list').innerText(),/1 次原题复习（旧累计 5 待确认）/);return {identifiedRows:5,cumulativeClaim:5,confirmedCumulativeErrors:1};
  });
  await check('P1 mixed manual/history/pending evidence retains mastery across restore until a new error',async(page,[a,b])=>{
   const original=await page.evaluate(({a,b})=>({records:[{id:'old-error',sid:a.sid,mode:'dictation',ts:100,ms:1,rows:[{...a,in:'demonstratiom'}]}],wrong:DictationCore.mutateWrong({[a.w]:{sid:b.sid,index:b.index,n:5}},{type:'manual',items:[b],now:100})}),{a,b});
   await seed(page,{});await restore(page,original);await page.locator('[data-act="master"][data-word="demonstration"]').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dictation_preview_dict2_wrong')).demonstration.mastered===true);const mastered=(await storage(page))[key('dict2_wrong')].demonstration.mastery;
   await restore(page,original);assert.deepEqual((await storage(page))[key('dict2_wrong')].demonstration.mastery,mastered);await page.locator('[data-act="wrong-filter"][data-value="mastered"]').click();assert.ok(await page.locator('[data-act="review-all"]').isDisabled());
   await page.locator('[data-act="wrong-evidence"]').click();assert.match(await page.locator('#modal-root').innerText(),/已掌握（保留）/);assert.match(await page.locator('[data-evidence-group="confirmed"]').innerText(),/手动标记可用于复习，不增加错误次数/);assert.match(await page.locator('[data-evidence-group="unresolved"]').innerText(),/缺少原始输入/);await page.locator('[data-act="close-modal"]').first().click();
   await page.evaluate(value=>localStorage.setItem('dictation_preview_dict3_draft',JSON.stringify(value)),draft('after-mastery',[a]));await submit(page,['demonstrationn']);
   const saved=await storage(page);assert.equal(saved[key('dict2_wrong')].demonstration.mastered,false);assert.equal(Object.keys(saved[key('dict2_wrong')].demonstration.manualSources).length,1);await page.locator('[data-act="wrong-filter"][data-value="pending"]').click();assert.match(await page.locator('#wrong-list').innerText(),/2 次/);return {masterySurvivesRestore:true,newErrorInvalidatesMastery:true};
  });
  await check('C actual ten-word 90 to 100 percent rounds preserve independent review and repeated JSON restore',async(page)=>{
   const items=await page.evaluate(()=>{const C=DictationCore,D=DICT_DATA;return [...C.itemsFor(D,'C3-T1').slice(0,7),C.itemsFor(D,'C3-T1').find(v=>v.w==='advertisements'),C.itemsFor(D,'C5-T12').find(v=>v.w==='effect'),C.itemsFor(D,'C11-T1').find(v=>v.w==='survey')];});assert.ok(items.every(Boolean));
   const inputs=items.map(v=>v.w);inputs[7]='advertisement';inputs[8]='affect';inputs[9]='suvey';await seed(page,{dict2_settings:{ignoreCase:false},dict3_draft:draft('ten-c-first',items)});await submit(page,inputs);
   let saved=await storage(page),first=saved[key('dict2_records')][0];assert.equal(first.pct,90);assert.equal(first.rows[8].liveCorrect,true);assert.equal(first.rows[8].correct,true);assert.equal(first.rows[8].reviewRequired,true);assert.equal(first.rows[7].reviewRequired,false);
   const counts=await page.evaluate(()=>{const v=DictationCore.deriveWrong(JSON.parse(localStorage.getItem('dictation_preview_dict2_records')),JSON.parse(localStorage.getItem('dictation_preview_dict2_wrong')),DICT_RULES);return {effect:[v.effect.n,v.effect.homophoneCount,v.effect.reviewCount],survey:[v.survey.n,v.survey.spellingCount],keys:Object.keys(v)};});assert.deepEqual(counts,{effect:[0,1,1],survey:[1,1],keys:['effect','survey']});
   await page.locator('#wrong-reason').selectOption('homophone');assert.equal(await page.locator('#wrong-list tbody tr').count(),1);assert.match(await page.locator('#wrong-list').innerText(),/affect/);const audio=await played(page,items[8]);if(output)await page.screenshot({path:path.join(output,'homophone-filter.png'),fullPage:true});await page.locator('[data-act="wrong-evidence"]').click();assert.match(await page.locator('#modal-root').innerText(),/学习判分：正确（语料库同音豁免）/);assert.match(await page.locator('#modal-root').innerText(),/复习原因：同音异形词混淆/);await page.locator('[data-act="close-modal"]').first().click();
   const csv=await downloadCSV(page);assert.match(csv,/原题计错次数/);assert.match(csv,/同音混淆次数/);assert.match(csv,/"effect"/);assert.ok(!csv.includes('"survey"'));assert.equal((await downloadTXT(page)).trim(),'effect');
   inputs[9]='survey';await page.evaluate(value=>localStorage.setItem('dictation_preview_dict3_draft',JSON.stringify(value)),draft('ten-c-fixed',items));await submit(page,inputs);saved=await storage(page);assert.equal(saved[key('dict2_records')][1].pct,100);
   await page.locator('[data-act="backup-menu"]').first().click();let event=page.waitForEvent('download');await page.locator('[data-act="backup"]').click();const backup=JSON.parse(fs.readFileSync(await(await event).path(),'utf8'));const raw=JSON.stringify(backup.records);
   await seed(page,{});for(let i=0;i<5;i++)await restore(page,backup);await page.reload();const restored=await storage(page);assert.equal(JSON.stringify(restored[key('dict2_records')]),raw);const view=await page.evaluate(()=>DictationCore.deriveWrong(JSON.parse(localStorage.getItem('dictation_preview_dict2_records')),JSON.parse(localStorage.getItem('dictation_preview_dict2_wrong')),DICT_RULES));assert.equal(view.effect.homophoneCount,2);assert.equal(view.survey.n,1);
   await page.evaluate(()=>location.hash='#statistics');await page.locator('[data-act="record"][data-id="ten-c-fixed"]').first().click();await page.locator('.result-hero').waitFor();assert.match(await page.locator('.result-hero').innerText(),/100/);await page.locator('[data-act="result-filter"][data-value="wrong"]').click();assert.equal(await page.locator('.result-details tbody tr').count(),1);assert.match(await page.locator('.result-details').innerText(),/effect/);
   return {first:90,next:100,homophone:2,spelling:1,restores:5,audio};
  });
  await check('C type and chapter select actual matching sources while profile keeps its complete denominator',async(page)=>{
   const [a,b]=await page.evaluate(()=>['C11-T1','C5-T11'].map(sid=>DictationCore.itemsFor(DICT_DATA,sid).find(v=>v.w==='weekly return'))),rec=(id,item,input,ts)=>({id,sid:item.sid,mode:'dictation',ts,ignoreCase:false,rows:[{...item,in:input,liveCorrect:false}]});
   const history=[rec('h',a,'weakly return',100),rec('s',b,'weeky return',200),rec('s2',a,'weeky return',300),rec('correct',a,'WEEKLY RETURN',400)],raw=JSON.stringify(history);await seed(page,{dict2_records:history});await page.locator('#wrong-reason').selectOption('homophone');await page.locator('#wrong-search').fill('weekly');const audio=await played(page,a);
   await page.locator('[data-act="word-profile"][data-word="weekly"]').click();assert.match(await page.locator('#modal-root').innerText(),/正确率 50%/);await page.locator('[data-act="close-modal"]').first().click();await page.locator('#wrong-chapter').selectOption(a.sid);await page.locator('[data-act="word-profile"][data-word="weekly"]').click();assert.match(await page.locator('#modal-root').innerText(),/正确率 66\.7%/);assert.ok(!(await page.locator('#modal-root').innerText()).includes(b.sid));await page.locator('[data-act="close-modal"]').first().click();
   await page.locator('[data-act="paper-setup"]').click();await page.locator('[data-act="paper-option"][data-key="source"][data-value="filtered"]').click();await page.locator('[data-act="paper-option"][data-key="dedupe"][data-value="false"]').click();await page.locator('[data-act="paper-start"]').click();await page.locator('#paper-stage').waitFor();let saved=await storage(page);assert.equal(saved[key('dict3_paper_draft')].items.length,1);assert.equal(saved[key('dict3_paper_draft')].items[0].sid,a.sid);await page.locator('[data-act="paper-exit"]').click();
   await page.locator('#wrong-chapter').selectOption(b.sid);await page.locator('[data-act="wrong-filter"][data-value="frequency"]').click();assert.equal(await page.locator('[data-frequency-word="weekly"]').count(),0);await page.locator('#wrong-reason').selectOption('spelling');await page.locator('[data-act="frequency-sources"][data-word="weekly"]').click();await played(page,b);await page.locator('[data-act="close-modal"]').first().click();await page.locator('#wrong-reason').selectOption('homophone');await page.locator('#wrong-chapter').selectOption('all');await page.locator('[data-act="wrong-filter"][data-value="pending"]').click();await page.locator('[data-act="review-all"]').click();await page.locator('[data-act="begin"]').click();saved=await storage(page);assert.equal(saved[key('dict3_draft')].items.length,1);assert.equal(saved[key('dict3_draft')].items[0].sid,a.sid);await page.locator('[data-act="leave"]').click();await page.evaluate(()=>location.hash='#wrong');
   await page.locator('[data-act="master"][data-word="weekly return"]').click();await page.locator('[data-act="wrong-filter"][data-value="mastered"]').click();assert.match(await page.locator('#wrong-list').innerText(),/同音混淆/);assert.match(await page.locator('#wrong-list').innerText(),/移回待复习/);assert.ok(await page.locator('[data-act="review-all"]').isDisabled());assert.equal(JSON.stringify((await storage(page))[key('dict2_records')]),raw);
   return {audio,allAccuracy:50,chapterAccuracy:66.7,matchingOriginalQuestions:1,rawPreserved:true};
  });
  await check('C mixed actual phrase retains two token reasons and one source in every review queue',async(page)=>{
   const item=await page.evaluate(()=>DictationCore.itemsFor(DICT_DATA,'C11-T1').find(v=>v.w==='weekly return'));await seed(page,{dict3_draft:draft('mixed-actual',[item])});await submit(page,['weakly retun']);
   const view=await page.evaluate(()=>DictationCore.deriveWrong(JSON.parse(localStorage.getItem('dictation_preview_dict2_records')),JSON.parse(localStorage.getItem('dictation_preview_dict2_wrong')),DICT_RULES)['weekly return']);assert.deepEqual([view.n,view.homophoneCount,view.spellingCount,view.reviewCount,view.reviewRows],[1,1,1,2,1]);
   await page.locator('[data-act="wrong-evidence"]').click();assert.equal(await page.locator('.review-token').count(),2);if(output)await page.screenshot({path:path.join(output,'mixed-token-evidence.png'),fullPage:true});assert.match(await page.locator('#modal-root').innerText(),/整题学习判分：错误/);assert.match(await page.locator('#modal-root').innerText(),/学习判分：正确（语料库同音豁免）/);await page.locator('[data-act="close-modal"]').first().click();
   for(const reason of ['homophone','spelling']){await page.locator('#wrong-reason').selectOption(reason);assert.equal((await downloadTXT(page)).trim(),item.w);await page.locator('[data-act="paper-setup"]').click();await page.locator('[data-act="paper-option"][data-key="source"][data-value="filtered"]').click();await page.locator('[data-act="paper-option"][data-key="dedupe"][data-value="false"]').click();await page.locator('[data-act="paper-start"]').click();assert.equal((await storage(page))[key('dict3_paper_draft')].items.length,1);await page.locator('[data-act="paper-exit"]').click();}
   await page.locator('#wrong-reason').selectOption('all');await page.locator('[data-act="wrong-filter"][data-value="frequency"]').click();await page.locator('[data-act="review-all"]').click();await page.locator('[data-act="begin"]').click();assert.equal((await storage(page))[key('dict3_draft')].items.length,1);return {rowErrors:1,tokenReviewEvents:2,queuedOriginalQuestions:1};
  });
  await check('C explicit bundled rescan repairs an already-imported homophone without automatic writes',async(page)=>{
   const imported=await page.evaluate(()=>DICT_LEGACY_RECORDS['C11-T1'].map((row,index)=>DictationCore.stableJSON(['bundled-legacy-records','C11-T1',index,row.w,row.in])));await seed(page,{dict3_legacy_wrong:imported});assert.equal((await storage(page))[key('dict2_wrong')],undefined);
   await page.evaluate(()=>{window.DICT_LEGACY_RECORDS={'C11-T1':DICT_LEGACY_RECORDS['C11-T1']};location.hash='#settings';});await page.locator('[data-act="legacy"]').click();await page.waitForFunction(()=>!!JSON.parse(localStorage.getItem('dictation_preview_dict2_wrong'))?.['weekly return']);
   let saved=await storage(page),wrong=saved[key('dict2_wrong')],view=await page.evaluate(()=>DictationCore.deriveWrong([],JSON.parse(localStorage.getItem('dictation_preview_dict2_wrong')),DICT_RULES)['weekly return']);assert.equal(view.n,0);assert.equal(view.homophoneCount,1);assert.equal(view.reviewRows,1);await page.locator('[data-act="legacy"]').click();saved=await storage(page);assert.deepEqual(saved[key('dict2_wrong')],wrong);return {explicitRescan:true,homophone:1,repeatedScanStable:true};
  });
  await check('D external Web Lock queues distinct ordinary and homophone submissions and same-word chapter sources',async(page)=>{
   const other=await page.context().newPage(),holder=await page.context().newPage(),backupPage=await page.context().newPage();for(const tab of [other,holder,backupPage]){await tab.goto(url);await tab.evaluate(()=>DictationReady);}
   const cases=await page.evaluate(()=>{const C=DictationCore,D=DICT_DATA;return [[C.itemsFor(D,'C11-T1').find(v=>v.w==='demonstration'),C.itemsFor(D,'C5-T12').find(v=>v.w==='effect'),'demonstratiom','affect'],[C.itemsFor(D,'C11-T1').find(v=>v.w==='weekly return'),C.itemsFor(D,'C5-T11').find(v=>v.w==='weekly return'),'weakly return','weeky return']];});
   for(let i=0;i<cases.length;i++){
    const [a,b,left,right]=cases[i];await seed(page,{});await prepareSubmission(page,'distinct-a-'+i,a,left);await prepareSubmission(other,'distinct-b-'+i,b,right);const release=await holdEvidenceLock(holder);
    await Promise.all([page.locator('[data-act="finish-confirm"]').click(),other.locator('[data-act="finish-confirm"]').click()]);assert.equal((await storage(holder))[key('dict2_records')],undefined);await backupPage.locator('[data-act="backup-menu"]').first().click();const event=backupPage.waitForEvent('download');await backupPage.locator('[data-act="backup"]').click();await release();await Promise.all([page.waitForURL(/#result$/),other.waitForURL(/#result$/)]);await holder.waitForFunction(()=>JSON.parse(localStorage.getItem('dictation_preview_dict2_records')||'[]').length===2);const backup=JSON.parse(fs.readFileSync(await(await event).path(),'utf8'));assert.deepEqual(new Set(backup.records.map(v=>v.id)),new Set(['distinct-a-'+i,'distinct-b-'+i]));await backupPage.locator('[data-act="close-modal"]').first().click();
    const saved=await storage(holder),records=saved[key('dict2_records')];assert.deepEqual(new Set(records.map(v=>v.id)),new Set(['distinct-a-'+i,'distinct-b-'+i]));assert.equal(saved[key('dict3_evidence_pending')],null);assert.ok(saved[key('dict3_draft')],'submission never deletes the shared active draft');
    if(i===1){const entry=await holder.evaluate(()=>DictationCore.deriveWrong(JSON.parse(localStorage.getItem('dictation_preview_dict2_records')),JSON.parse(localStorage.getItem('dictation_preview_dict2_wrong')),DICT_RULES)['weekly return']);assert.equal(entry.n,1);assert.equal(entry.homophoneCount,1);assert.equal(entry.spellingCount,1);assert.equal(entry.sources.length,2);}
   }
   await other.close();await holder.close();await backupPage.close();return {externalLock:true,distinctAttempts:4,sameWordChapters:2,queuedBackups:2,journalCleared:true};
  });
  await check('D explicit mastery targets and a queued backup use the latest locked state',async(page,[item])=>{
   const original={id:'before-master',sid:item.sid,mode:'dictation',ts:100,ms:1,rows:[{...item,in:'demonstratiom'}]};await seed(page,{dict2_records:[original]});
   const second=await page.context().newPage(),holder=await page.context().newPage(),backupPage=await page.context().newPage();for(const tab of [second,holder,backupPage]){await tab.goto(url);await tab.evaluate(()=>DictationReady);}
   const release=await holdEvidenceLock(holder);await Promise.all([page.locator('[data-act="master"][data-value="true"]').click(),second.locator('[data-act="master"][data-value="true"]').click()]);
   await backupPage.locator('[data-act="backup-menu"]').click();const event=backupPage.waitForEvent('download');await backupPage.locator('[data-act="backup"]').click();await release();const backup=JSON.parse(fs.readFileSync(await(await event).path(),'utf8'));assert.equal(backup.wrong.demonstration.mastered,true);assert.equal((await storage(holder))[key('dict2_wrong')].demonstration.mastered,true);assert.deepEqual(backup.records,[original]);
   for(const tab of [second,holder,backupPage])await tab.close();return {twoExplicitMasterTargets:true,backupAfterQueue:true};
  });
  await check('D waiting finish freezes feedback and preserves new edits and another page active draft',async(page)=>{
   const item=await page.evaluate(()=>DictationCore.itemsFor(DICT_DATA,'C5-T12').find(v=>v.w==='effect')),holder=await page.context().newPage();await holder.goto(url);await holder.evaluate(()=>DictationReady);await seed(page,{});await prepareSubmission(page,'frozen-input',item,'affect');let release=await holdEvidenceLock(holder);await page.locator('[data-act="finish-confirm"]').click();await page.locator('[data-act="close-modal"]').first().click();await page.locator('[data-answer="0"]').fill('efffect');await release();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dictation_preview_dict2_records')||'[]').length===1);
   assert.equal(await page.evaluate(()=>location.hash),'#practice');let saved=await storage(page);assert.equal(saved[key('dict2_records')][0].rows[0].in,'affect');assert.equal(saved[key('dict2_records')][0].rows[0].immediate.correct,true);assert.equal(saved[key('dict3_draft')].inputs[0],'efffect');await page.locator('[data-answer="0"]').press('Enter');await page.locator('[data-act="finish-confirm"]').click();await page.locator('[data-act="commit-conflict-new"]').waitFor();await page.locator('[data-act="commit-conflict-new"]').click();await page.locator('[data-act="finish-confirm"]').click();await page.waitForURL(/#result$/);saved=await storage(page);assert.equal(saved[key('dict2_records')].length,2);assert.equal(saved[key('dict2_records')][1].rows[0].in,'efffect');
   await prepareSubmission(page,'another-finish',item,'affect');release=await holdEvidenceLock(holder);await page.locator('[data-act="finish-confirm"]').click();const untouched=draft('other-page-draft',[item],['other unfinished input']);await holder.evaluate(value=>localStorage.setItem('dictation_preview_dict3_draft',JSON.stringify(value)),untouched);await release();await page.waitForURL(/#result$/);assert.deepEqual((await storage(holder))[key('dict3_draft')],untouched);await holder.close();return {frozenSnapshot:true,editedSameIdSubmittedExplicitly:true,otherDraftUntouched:true};
  });
  await check('D unsupported and rejected locks refuse writes but preserve recoverable JSON',async(page,[item])=>{
   for(const mode of ['missing','rejected']){
    await seed(page,{});await prepareSubmission(page,'no-lock-'+mode,item,'demonstratiom');await page.evaluate(mode=>Object.defineProperty(navigator,'locks',{configurable:true,value:mode==='missing'?undefined:{request:()=>Promise.reject(Error('Injected denied lock'))}}),mode);await page.locator('[data-act="finish-confirm"]').click();assert.equal((await storage(page))[key('dict2_records')],undefined);assert.ok((await storage(page))[key('dict3_draft')]);await page.locator('[data-act="close-modal"]').first().click();await page.locator('[data-act="leave"]').click();await page.locator('[data-act="backup-menu"]').first().click();const event=page.waitForEvent('download');await page.locator('[data-act="backup"]').click();const backup=JSON.parse(fs.readFileSync(await(await event).path(),'utf8'));assert.equal(backup.draft.inputs[0],'demonstratiom');assert.equal(backup.records.length,0);
    await page.evaluate(()=>location.hash='#wrong');await page.reload();await page.evaluate(()=>DictationReady);
   }
   return {missingLockSafe:true,rejectedLockSafe:true,jsonDraftPreserved:true};
  });
  await check('D paper refresh preserves original positions and self judgments without revealing or autoplay',async(page,[a,b])=>{
   const saved={items:[{w:'removed',sid:'missing',index:0},a,b],idx:2,self:{0:'仍不会',1:'已掌握',2:'仍不会'},loop:true,rate:1.4,interval:.5,revealed:true};await seed(page,{dict3_paper_draft:saved});await page.evaluate(()=>location.hash='#paper');await page.reload();await page.locator('#paper-stage').waitFor();const actual=(await storage(page))[key('dict3_paper_draft')];assert.equal(actual.idx,1);assert.deepEqual(actual.self,{0:'已掌握',1:'仍不会'});assert.deepEqual(actual.items.map(v=>v.sid),[a.sid,b.sid]);assert.equal(actual.revealed,false);assert.ok(!(await page.locator('#paper-stage').innerText()).includes(b.w));assert.equal(await page.locator('#dictation-audio').evaluate(audio=>audio.paused&&audio.played.length===0),true);return {idx:1,selfRemapped:true,hidden:true,autoplay:false};
  });
  await check('D startup waits for the shared lock and storage refresh never writes old paper state',async(page,[item])=>{
   await seed(page,{dict3_draft:draft('ready-gate',[item])});const release=await holdEvidenceLock(page),waiting=await page.context().newPage();await waiting.goto(url.replace('#wrong','#practice'));await waiting.waitForFunction(()=>!!window.DictationReady);assert.equal(await waiting.locator('[data-act="start"]').count(),0);await page.evaluate(()=>localStorage.setItem('dictation_preview_dict2_records','[]'));assert.equal(await waiting.locator('[data-act="start"]').count(),0);await release();await waiting.locator('[data-act="start"]').click();await waiting.locator('[data-answer="0"]').fill('kept after ready');assert.equal((await storage(waiting))[key('dict3_draft')].inputs[0],'kept after ready');
   await page.evaluate(item=>{localStorage.setItem('dictation_preview_dict3_paper_draft',JSON.stringify({items:[item],idx:0,self:{0:'已掌握'}}));location.hash='#paper';},item);await page.reload();await page.locator('#paper-stage').waitFor();await page.locator('[data-act="paper-exit"]').click();const newer={items:[item],idx:0,self:{0:'仍不会'}};await waiting.evaluate(value=>{localStorage.setItem('dictation_preview_dict3_paper_draft',JSON.stringify(value));localStorage.setItem('dictation_preview_dict2_records','[]');},newer);assert.deepEqual((await storage(page))[key('dict3_paper_draft')],newer);await waiting.close();return {startupLockGate:true,passiveStorageReadOnly:true};
  });
  console.log(JSON.stringify({html,chrome:browser.version(),results},null,2));
  if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({html,chrome:browser.version(),results},null,2));}
  if(results.some(value=>!value.passed))process.exitCode=1;
 }finally{if(browser)await browser.close();await service.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
