'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const html=path.resolve(process.argv[2]||[path.join(__dirname,'../index.html'),path.join(__dirname,'../site/index.html')].find(fs.existsSync));
const fixtures=path.resolve(__dirname,'../tests/fixtures'),root=path.dirname(html),results=[];
const output=process.env.REVIEW_BROWSER_OUTPUT;
const prefix='dictation_preview_',key=name=>prefix+name;
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||path.basename(html);
 const safe=directory=>{const target=path.resolve(directory,name);return target.startsWith(directory+path.sep)&&fs.existsSync(target)&&fs.statSync(target).isFile()?target:null;};
 const file=safe(root)||safe(fixtures);if(!file){res.writeHead(404);res.end();return;}
 const raw=fs.readFileSync(file),type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wav':'audio/wav'}[path.extname(file)]||'application/octet-stream';
 const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');let start=0,end=raw.length-1;
 if(range){start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;if(start>end){res.writeHead(416);res.end();return;}}
 res.writeHead(range?206:200,{'Content-Type':type,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${raw.length}`}:{})});res.end(raw.subarray(start,end+1));
});
async function storage(page){return page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('dictation_preview_')).map(([k,v])=>[k,JSON.parse(v)])));}
async function seed(page,values){await page.evaluate(values=>{localStorage.clear();for(const [k,v]of Object.entries(values))localStorage.setItem('dictation_preview_'+k,JSON.stringify(v));location.hash='#wrong';},values);await page.reload();await page.locator('#wrong-chapter').waitFor();}
async function restore(page,backup){
 await page.locator('[data-act="backup-menu"]').click();await page.locator('#toast').evaluate(el=>el.textContent='');
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
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/${path.basename(html)}?preview=1#wrong`;
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
   assert.match(await page.locator('[data-evidence-group="confirmed"]').innerText(),/确定错误 · 1 次/);assert.ok(!(await page.locator('[data-evidence-group="confirmed"]').innerText()).includes(b.sid));
   assert.match(await page.locator('[data-evidence-group="unresolved"]').innerText(),/缺少原始输入/);assert.match(await page.locator('[data-evidence-group="cumulative"]').innerText(),/5 次（未验证）/);
   assert.match(await page.locator('#modal-root').innerText(),/另有待核实证据/);if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'mixed-evidence.png'),fullPage:true});}await page.locator('[data-act="close-modal"]').first().click();
   await page.locator('#wrong-chapter').selectOption(b.sid);assert.equal(await page.locator('[data-wrong-count="pending"]').innerText(),'0');assert.ok(await page.locator('[data-act="review-all"]').isDisabled());
   await page.locator('[data-act="wrong-filter"][data-value="uncertain"]').click();assert.match(await page.locator('#wrong-list').innerText(),/原始输入缺失/);assert.ok(await page.locator('[data-act="review-all"]').isDisabled());
   const csv=await downloadCSV(page);assert.ok(csv.includes(b.sid));assert.ok(!csv.includes(a.sid));assert.ok(!csv.includes('demonstratiom'));
   let downloads=0;const onDownload=()=>downloads++;page.on('download',onDownload);await page.locator('[data-act="answers-txt"]').click();await page.locator('[data-act="export-answers"][data-type="filtered"]').click();assert.match(await page.locator('#toast').innerText(),/没有符合条件/);await page.locator('[data-act="close-modal"]').first().click();assert.equal(downloads,0);page.off('download',onDownload);
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
    await page.locator('[data-act="backup-menu"]').click();const event=page.waitForEvent('download');await page.locator('[data-act="backup"]').click();const exported=JSON.parse(fs.readFileSync(await (await event).path(),'utf8'));
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
   const unknown={records:[],wrong:{[item.w]:{sid:item.sid,index:item.index,in:'demonstratiom',n:5}}};await seed(page,{});for(let i=0;i<3;i++)await restore(page,unknown);assert.match(await page.locator('#wrong-list').innerText(),/1 次（旧累计 5 待确认）/);return {identifiedRows:5,cumulativeClaim:5,confirmedCumulativeErrors:1};
  });
  await check('P1 mixed manual/history/pending evidence retains mastery across restore until a new error',async(page,[a,b])=>{
   const original=await page.evaluate(({a,b})=>({records:[{id:'old-error',sid:a.sid,mode:'dictation',ts:100,ms:1,rows:[{...a,in:'demonstratiom'}]}],wrong:DictationCore.mutateWrong({[a.w]:{sid:b.sid,index:b.index,n:5}},{type:'manual',items:[b],now:100})}),{a,b});
   await seed(page,{});await restore(page,original);await page.locator('[data-act="master"][data-word="demonstration"]').click();const mastered=(await storage(page))[key('dict2_wrong')].demonstration.mastery;
   await restore(page,original);assert.deepEqual((await storage(page))[key('dict2_wrong')].demonstration.mastery,mastered);await page.locator('[data-act="wrong-filter"][data-value="mastered"]').click();assert.ok(await page.locator('[data-act="review-all"]').isDisabled());
   await page.locator('[data-act="wrong-evidence"]').click();assert.match(await page.locator('#modal-root').innerText(),/已掌握（保留）/);assert.match(await page.locator('[data-evidence-group="confirmed"]').innerText(),/手动标记可用于复习，不增加错误次数/);assert.match(await page.locator('[data-evidence-group="unresolved"]').innerText(),/缺少原始输入/);await page.locator('[data-act="close-modal"]').first().click();
   await page.evaluate(value=>localStorage.setItem('dictation_preview_dict3_draft',JSON.stringify(value)),draft('after-mastery',[a]));await submit(page,['demonstrationn']);
   const saved=await storage(page);assert.equal(saved[key('dict2_wrong')].demonstration.mastered,false);assert.equal(Object.keys(saved[key('dict2_wrong')].demonstration.manualSources).length,1);await page.locator('[data-act="wrong-filter"][data-value="pending"]').click();assert.match(await page.locator('#wrong-list').innerText(),/2 次/);return {masterySurvivesRestore:true,newErrorInvalidatesMastery:true};
  });
  console.log(JSON.stringify({html,chrome:browser.version(),results},null,2));
  if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({html,chrome:browser.version(),results},null,2));}
  if(results.some(value=>!value.passed))process.exitCode=1;
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
