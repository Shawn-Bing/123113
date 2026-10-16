'use strict';
// Same script is delivered as tests/review-regression.test.cjs in the release repository.
// Execute the shipped modules, not a copied implementation. Node standard library only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const filename=process.env.RELEASE_HTML||process.argv[2]||[path.resolve(__dirname,'../index.html'),path.resolve(__dirname,'../_scratch/tmp/ielts-target-reference/index.html')].find(file=>fs.existsSync(file));
assert.ok(filename,'Pass the generated index.html path or set RELEASE_HTML');
const html=fs.readFileSync(filename,'utf8');
function moduleCode(name){const escaped=name.replace(/[.*+?${}()|[\]\\]/g,'\\$&'),match=html.match(new RegExp('<!-- Inlined: '+escaped+' -->\\s*<script>\\s*([\\s\\S]*?)<\\/script>'));if(match)return match[1];assert.ok(html.includes('src="'+name+'"'),'Missing delivered module '+name);return fs.readFileSync(path.join(path.dirname(filename),name),'utf8');}
function environment(){const context={console,URL,URLSearchParams};context.window=context;vm.createContext(context);for(const name of ['data/words.js','data/rules.js','core.js','wrong-frequency.js','dictation-features.js','learning-insights.js'])vm.runInContext(moduleCode(name),context,{filename:name});return context;}
const scope=environment(),C=scope.DictationCore,W=scope.DictationWrongFrequency,R=scope.DICT_RULES,S={ignoreCase:true,looseRules:true},plain=value=>JSON.parse(JSON.stringify(value));
const row=(w,input,index=0)=>({w,in:input,sid:'C3-T1',index}),rec=(id,rows,ts=100)=>({id,sid:'C3-T1',mode:'dictation',ts,ms:1,rows});

test('delivered homophone review uses the existing real mapping without reducing learning accuracy',async ()=>{
 for(const [answer,input]of [['two','to'],['effect','affect'],['addition','edition'],['break','brake']]){
  const original=rec(answer,[row(answer,input)]),view=C.recordView(original,R),entry=C.deriveWrong([original],{},R)[answer],profile=W.profiles([original],R)[0];
  assert.equal(view.pct,100);assert.equal(view.rows[0].reviewRequired,true);assert.deepEqual(plain(view.rows[0].reviewReasons),['homophone']);assert.deepEqual([entry.n,entry.homophoneCount,entry.spellingCount,entry.reviewCount,entry.reviewRows],[0,1,0,1,1]);assert.equal(entry.sources[0].occurrences[0].reviewEvents[0].id,JSON.stringify([answer,0,0]));assert.equal(profile.accuracy,100);assert.equal(profile.n,0);assert.deepEqual(plain(profile.typos),[]);
 }
});

test('delivered mixed phrase and reviewed format keep row errors separate from token review counts',async ()=>{
 const mixed=rec('mixed',[row('two advertisements survey','to advertisement suvey')]),entry=C.deriveWrong([mixed],{},R)['two advertisements survey'];assert.deepEqual([entry.n,entry.rowErrors,entry.spellingCount,entry.homophoneCount,entry.reviewCount,entry.reviewRows],[1,1,1,1,2,1]);assert.deepEqual(plain(entry.sources[0].occurrences[0].reviewEvents.map(v=>v.id)),['["mixed",0,0]','["mixed",0,2]']);
 const format=C.scoreGrade('to full time','two full-time',S,R);assert.equal(format.correct,true);assert.deepEqual(plain(format.reviewReasons),['homophone']);
 const boundary=C.deriveWrong([rec('boundary',[row('high-rise','high rise')])],{},R)['high-rise'];assert.deepEqual([boundary.n,boundary.reviewCount,boundary.reviewRows,boundary.pending,boundary.reviewPending],[1,0,1,false,true]);
 const optional=C.scoreGrade('input','at(e)',S,{scoring:{number:{input:['ate']},homophones:{input:['at']}}});assert.deepEqual(plain(optional.acceptedBy),['number']);assert.equal(optional.reviewRequired,false);
 for(const [answer,input,reason]of [['tent(ed) accommodation','tentxx accomodation','spelling'],['tent(ed) two','tentxx to','homophone']]){
  const partial=C.scoreGrade(input,answer,S,R);assert.equal(partial.assessment.tokenObservations[0].learningCorrect,null);assert.deepEqual(plain(partial.assessment.tokenObservations[1].reviewReasons),[reason]);assert.equal(C.deriveWrong([rec(reason,[row(answer,input)])],{},R)[answer].reviewCount,1);
 }
});

test('delivered current case policy preserves raw legacy facts and original immediate feedback',async ()=>{
 const original={...rec('case',[{...row('apple','APPLE'),correct:false,liveCorrect:false}]),grading:'book',ignoreCase:false,pct:0},before=JSON.stringify(original),view=C.recordView(original,R);assert.equal(view.pct,100);assert.equal(view.rows[0].reviewRequired,false);assert.equal(C.originalImmediate(view,0),false);assert.equal(W.profiles([original],R)[0].accuracy,100);assert.equal(JSON.stringify(original),before);
 const item={w:'two',sid:'C3-T1',index:0},snapshot={input:'to',answer:'two',correct:false,analysisVersion:'old'},made=C.makeRecord({id:'snapshot',sid:item.sid,mode:'dictation',items:[item],inputs:['to'],states:['incorrect'],immediate:[snapshot]},S,R,'snapshot',100);assert.equal(made.pct,100);assert.equal(made.rows[0].liveCorrect,false);assert.deepEqual(plain(made.rows[0].immediate),snapshot);
});

test('delivered homophone history, mastery and repeated backup merge remain idempotent',async ()=>{
 const original=rec('homophone-history',[row('two','to')]),wrong={two:{sid:'C3-T1',index:0,in:'to',n:9,mastered:true}},before=JSON.stringify({original,wrong});let stored=C.mutateWrong(wrong,{type:'merge',wrong});
 for(let i=0;i<5;i++){stored=C.mutateWrong(stored,{type:'merge',wrong});const entry=C.deriveWrong([original,original],stored,R).two;assert.equal(entry.n,0);assert.equal(entry.reviewCount,1);assert.equal(entry.mastered,true);}
 const next=C.makeRecord({id:'new-homophone',sid:'C3-T1',mode:'dictation',items:[{w:'two',sid:'C3-T1',index:0}],inputs:['to']},S,R,'next',200),saved=C.mutateWrong(stored,{type:'record',record:next,now:200});assert.equal(saved.two.mastered,false);assert.equal(saved.two.n,9);assert.equal(C.deriveWrong([original,next],saved,R).two.homophoneCount,2);assert.equal(JSON.stringify({original,wrong}),before);
 const old={evidenceVersion:1,legacySnapshots:{},historyRefs:{},manualSources:{},mastery:{value:true,changedAt:null,actionId:'legacy'}},finite=C.mutateWrong({two:old},{type:'record',record:next,now:200});assert.equal(finite.two.n,0);assert.equal(JSON.parse(JSON.stringify(finite)).two.n,0);
});
async function app(storage={},hash='#wrong',options={}){
 const context=environment();let lockQueue=Promise.resolve();context.crypto=require('node:crypto').webcrypto;context.navigator={locks:{request:(name,callback)=>{const next=lockQueue.then(callback);lockQueue=next.catch(()=>{});return next;}}};const memory=new Map(Object.entries(storage).map(([key,value])=>[key,JSON.stringify(value)])),handlers={},events={};
 const classes={add(){},remove(){},toggle(){},contains(){return false;}},element=()=>({innerHTML:'',textContent:'',dataset:{},classList:classes,style:{},setAttribute(){},focus(){},querySelector(){return null;},querySelectorAll(){return [];},insertAdjacentHTML(){}}),root=element(),modal=element(),toast=element(),close=element();
 let answers=[],rendered='';Object.defineProperty(root,'innerHTML',{get:()=>rendered,set:html=>{rendered=html;answers=[];for(const [key]of Object.entries(nodes))if(key.startsWith('[data-answer='))delete nodes[key];for(const match of html.matchAll(/<input[^>]+data-answer="([0-9]+)"[^>]+value="([^"]*)"/g)){const input={...element(),value:match[2],dataset:{answer:match[1]},isConnected:true,closest(){return null;},setSelectionRange(){}};answers.push(input);nodes['[data-answer="'+match[1]+'"]']=input;}}});
 const nodes={'#app':root,'#modal-root':modal,'#toast':toast,'#modal-root .icon-btn':close};
 context.document={documentElement:{...element(),style:{setProperty(){},removeProperty(){}}},body:{classList:classes,appendChild(){}},querySelector:key=>nodes[key]||null,querySelectorAll:selector=>selector==='[data-answer]'?answers:[],activeElement:null,visibilityState:'visible',hidden:false,createElement(){const input={...element(),click(){}};nodes['file-input']=input;return input;},addEventListener:(name,fn)=>handlers[name]=fn};
 context.location={hash,search:'',protocol:'file:',href:'file:///review/index.html',hostname:''};context.Audio=class{setAttribute(){}pause(){}load(){}addEventListener(){}removeEventListener(){}play(){return Promise.resolve();}};
 context.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>{if(options.failWrite?.(key,value))throw Error('injected quota');memory.set(key,value);}};context.setTimeout=()=>1;context.clearTimeout=()=>{};context.setInterval=()=>1;context.clearInterval=()=>{};context.addEventListener=(name,fn)=>events[name]=fn;context.scrollTo=()=>{};context.innerHeight=720;context.scrollY=0;
 const hooks='window.__review={paperItems,answerEntries,filteredReviewItems,filteredWrong,currentWrong,currentRecords,get session(){return session;},setDownload(callback){download=callback;}};';
 await vm.runInContext(moduleCode('app.js').replace('  settings = sanitizeSettings(settings);',hooks+'\n  settings = sanitizeSettings(settings);'),context,{filename:'delivered-app.js'});
 const click=async(act,extra={})=>{const target={dataset:{act,...extra},classList:classes,closest(){return this;}};await handlers.click({target});};return {context,root,modal,memory,click,events,nodes,handlers,input(index,value){const target=nodes['[data-answer="'+index+'"]'];assert.ok(target,'actual input rendered');target.value=value;handlers.input({target,isComposing:false});},api:context.__review};
}
test('1 independent legacy error survives correct history, while known question evidence is counted once',async ()=>{
 const history=[rec('correct',[row('accommodation','accommodation')])],stored={accommodation:{sid:'C3-T1',index:0,in:'accomodation',n:4,ts:50,mastered:true}},before=JSON.stringify({history,stored});const actual=C.deriveWrong(history,stored,R);assert.equal(actual.accommodation.n,1);assert.equal(actual.accommodation.mastered,true);assert.equal(actual.accommodation.legacyCount,4);
 const made=C.makeRecord({id:'made',sid:'C3-T1',mode:'dictation',items:[{w:'accommodation',sid:'C3-T1',index:0}],inputs:['accomodation']},S,R,'made',200),saved=C.updateWrong({},made);for(let i=0;i<3;i++){const view=C.deriveWrong([made,made],saved,R);assert.equal(view.accommodation.n,1);assert.equal(view.accommodation.provenance.legacy,'none');}assert.equal(JSON.stringify({history,stored}),before);
 const unresolved=C.deriveWrong([made],stored,R).accommodation;assert.equal(unresolved.n,1);assert.equal(unresolved.legacyEvidence.state,'unresolved-link');
});
test('2 pending never replaces latest effective error or breaks effective consecutive correct',async ()=>{
 const pending=rec('p',[row('survey survey','survey')],200),correct=W.profiles([rec('c',[row('survey','survey'),row('survey','survey')]),pending],R).find(v=>v.word==='survey');assert.equal(correct.shortTerm.correctStreak,2);assert.equal(correct.pending,2);assert.equal(correct.shortTerm.latestRound,'c');const wrong=W.profiles([rec('bad',[row('survey','servey')]),pending],R).find(v=>v.word==='survey');assert.ok(wrong.observations.some(v=>v.code==='latest-error'));
});
test('3 delivered CSV keeps original live feedback, derived learning, strict and format columns separate',async()=>{
 const record={...rec('csv',[{...row('full-time','full time'),liveCorrect:false,correct:false},{...row('survey','servey'),liveCorrect:true}]),grading:'book'},h=await app({dict2_records:[record],dict3_last_result:'csv'},'#result');let output;h.api.setDownload((name,text)=>output=text);await h.click('export-result');
 const cells=line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(v=>v[1]),lines=output.split('\r\n'),header=cells(lines[0]),values=cells(lines[1]);assert.equal(values[header.indexOf('原始即时判定')],'错');assert.equal(values[header.indexOf('新版学习判定')],'对');assert.equal(values[header.indexOf('严格判定')],'错');assert.ok(values[header.indexOf('格式说明')]);await h.click('result-filter',{value:'wrong'});await h.click('export-result');const selected=cells(output.split('\r\n')[1]);assert.equal(selected[header.indexOf('原始即时判定')],'对');assert.equal(selected[header.indexOf('正确率(%)')],'50');
});
test('4 pending entries have a separate consistent group and preserve mastery',async()=>{
 const h=await app({dict2_wrong:{ability:{sid:'C3-T1',index:0,n:9,mastered:true},survey:{sid:'C11-T1',in:'servey',n:4}}});assert.match(h.root.innerHTML,/data-wrong-count="pending">1/);assert.match(h.root.innerHTML,/data-wrong-count="uncertain">1/);assert.match(h.root.innerHTML,/data-wrong-count="mastered">0/);assert.ok(!h.root.innerHTML.includes('data-act="wrong-evidence" data-word="ability"'));await h.click('wrong-filter',{value:'uncertain'});assert.match(h.root.innerHTML,/data-act="review-all" disabled/);assert.ok(h.root.innerHTML.includes('data-act="wrong-evidence" data-word="ability"'));await h.click('wrong-evidence',{word:'ability'});assert.match(h.modal.innerHTML,/缺少原始输入/);assert.match(h.modal.innerHTML,/已掌握（保留）/);assert.equal(h.api.currentWrong().ability.pending,true);
});
test('5 trend describes current derived learning rules, not original grading policy',async ()=>{const h=await app({},'#library');assert.match(h.root.innerHTML,/历史正确率按当前统一学习规则派生/);assert.ok(!h.root.innerHTML.includes('正确率沿用每次练习的判分设置'));});
test('6 corpus-based hyphen practice needs no history and retains original audio identities',async()=>{
 const h=await app();await h.click('paper-setup');assert.match(h.modal.innerHTML,/连字符专项/);assert.match(h.modal.innerHTML,/当前章节/);await h.click('paper-option',{key:'source',value:'hyphen'});const items=h.api.paperItems();assert.ok(items.length>90);for(const item of items)assert.equal(h.context.DICT_DATA.words[item.sid][item.index].w,item.w);const expected=Object.values(h.context.DICT_DATA.words).flat().filter(v=>C.normalize(v.w).includes('-')).length;assert.equal(items.length,expected);
});
test('7 accepted whole-answer formats never manufacture token errors in either direction or context',async ()=>{
 const rules={...R,learningFormats:[...R.learningFormats,['check-in','check in']]};for(const [a,b]of [['full-time','full time'],['brother-in-law','brother in law'],['mother-in-law','mother in law'],['check-in','check in']])for(const [answer,input]of [[a,b],[b,a],['a '+a+' student','a '+b+' student'],['a '+b+' student','a '+a+' student']]){assert.equal(C.scoreGrade(input,answer,S,rules).correct,true);assert.ok(W.occurrencesForRow(input,answer,S,rules).every(v=>!['incorrect','omission'].includes(v.verdict)));assert.ok(W.profiles([rec(answer,[row(answer,input)])],rules).every(v=>v.n===0));}
 for(const [input,answer]of [['fulltime','full-time'],['checkin','check-in'],['invisible','in visible'],['lisense','licence']])assert.equal(C.scoreGrade(input,answer,S,rules).correct,false);
});
test('8 raw history and saved wrong evidence remain unchanged in delivered JSON backup',async()=>{
 const record={...rec('backup',[{...row('full-time','full time'),correct:false,liveCorrect:false}]),pct:0},stored={'full-time':{sid:'C3-T1',index:0,in:'full time',n:4,mastered:true}},h=await app({dict2_records:[record],dict2_wrong:stored,dict3_last_result:'backup'},'#result');assert.ok(!h.api.currentWrong()['full-time']);let backup;h.api.setDownload((name,text)=>backup=JSON.parse(text));await h.click('backup');assert.deepEqual(plain(backup.records),[record]);assert.deepEqual(plain(backup.wrong),stored);
});

const deliveredItem=(w,sid)=>C.itemsFor(scope.DICT_DATA,sid).find(item=>item.w===w),storedValue=(h,key)=>JSON.parse(h.memory.get(key)||'null');
const deliveredSnapshot=(value,input,n)=>value&&typeof value==='object'&&(value.in===input&&value.n===n||Object.values(value).some(v=>deliveredSnapshot(v,input,n)));
async function deliveredCommit(items,inputs,storage={},id='actual-commit'){
 const draft={id,sid:items.length>1?'review':items[0].sid,mode:'dictation',order:'normal',items,inputs:items.map(()=>''),states:items.map(()=>''),idx:0,started:false,elapsed:0,filter:'all',marked:[]},h=await app({...storage,dict3_draft:draft},'#practice');await h.click('start');for(let i=0;i<inputs.length;i++){h.input(i,inputs[i]);await h.click('submit');}await h.click('finish-confirm');assert.equal(h.api.session,null);return h;
}
test('9 actual shipped commit handler freezes old evidence and invalidates mastery',async()=>{
 const item=deliveredItem('accommodation','C5-T12'),old={sid:item.sid,index:item.index,in:'accomodation',n:4,ts:50,mastered:true},h=await deliveredCommit([item],['acomodation'],{dict2_wrong:{accommodation:old}});assert.ok(deliveredSnapshot(storedValue(h,'dict2_wrong'),'accomodation',4));assert.equal(storedValue(h,'dict2_wrong').accommodation.mastered,false);assert.equal(h.api.currentWrong().accommodation.n,2);const storage=Object.fromEntries([...h.memory].map(([key,value])=>[key,JSON.parse(value)])),reloaded=await app(storage);assert.equal(reloaded.api.currentWrong().accommodation.n,2);
});
test('10 actual shipped commit keeps two chapter sources and chapter retry identity',async()=>{
 const items=['C11-T1','C3-T3'].map(sid=>deliveredItem('demonstration',sid)),h=await deliveredCommit(items,['demonstratiom','demonstratiom']);assert.equal(h.api.currentWrong().demonstration.n,2);assert.equal(h.api.currentWrong().demonstration.sources.length,2);h.context.location.hash='#wrong';h.events.hashchange();h.handlers.change({target:{id:'wrong-chapter',value:'C11-T1',dataset:{},classList:{contains(){return false;}}}});assert.match(h.root.innerHTML,/还有 1 个单词/);await h.click('review-all');await h.click('begin');assert.equal(h.api.session.items.length,1);assert.equal(h.api.session.items[0].sid,items[0].sid);assert.equal(h.api.session.items[0].index,items[0].index);
});
test('11 shipped missing-raw observations count only in coverage, not errors or accuracy',async ()=>{
 for(const answer of ['demonstration','postal survey']){const raw=rec('missing',[{w:answer,sid:'C11-T1',index:0}]),profiles=W.profiles([raw,rec('correct',[row(answer,answer)],200)],R);assert.equal(C.recordView(raw,R).pending,1);assert.ok(profiles.every(v=>v.pending===1&&v.total===1&&v.coverage===50&&v.accuracy===100&&v.n===0));assert.equal(Object.hasOwn(raw.rows[0],'in'),false);}
});
test('12 actual shipped restore merges both backup orders idempotently and refuses raw ID conflict',async()=>{
 const item=deliveredItem('accommodation','C5-T12'),legacy={records:[rec('right',[{...item,in:item.w}])],wrong:{accommodation:{sid:item.sid,index:item.index,in:'accomodation',n:4,ts:50,mastered:true}}},newer=await deliveredCommit([item],['acomodation'],{dict2_records:legacy.records,dict2_wrong:legacy.wrong}),modern={records:storedValue(newer,'dict2_records'),wrong:storedValue(newer,'dict2_wrong')};
 const restore=async(h,backup)=>{await h.click('restore');const input=h.nodes['file-input'];input.files=[{text:async()=>JSON.stringify(backup)}];await input.onchange();};
 for(const pair of [[legacy,modern],[modern,legacy]]){const h=await app();await restore(h,pair[0]);await restore(h,pair[1]);const once=JSON.stringify(h.api.currentWrong());await restore(h,pair[1]);assert.equal(JSON.stringify(h.api.currentWrong()),once);assert.equal(h.api.currentWrong().accommodation.n,2);assert.equal(storedValue(h,'dict2_wrong').accommodation.mastered,false);const before=h.memory.get('dict2_records');await restore(h,{...legacy,records:[{...legacy.records[0],ms:999}]});assert.equal(h.memory.get('dict2_records'),before);}
});

test('13 actual shipped interrupted commit preserves edited input until explicit conflict resolution',async()=>{
 const item=deliveredItem('accommodation','C5-T12');for(const stage of ['dict2_records','dict2_wrong','clear-journal']){let fail=false;const draft={id:'failure-'+stage,sid:item.sid,mode:'dictation',order:'normal',items:[item],inputs:[''],states:[''],idx:0,started:false,elapsed:0,filter:'all',marked:[]},h=await app({dict3_draft:draft},'#practice',{failWrite:(key,value)=>fail&&(key===stage||stage==='clear-journal'&&key==='dict3_evidence_pending'&&value==='null')});await h.click('start');h.input(0,'acomodation');await h.click('submit');fail=true;await h.click('finish-confirm');assert.ok(h.api.session);h.input(0,'accommodation');fail=false;await h.click('finish-confirm');assert.ok(h.api.session);assert.equal(storedValue(h,'dict3_draft').inputs[0],'accommodation');assert.match(h.modal.innerHTML,/commit-conflict-new/);await h.click('commit-conflict-new');await h.click('finish-confirm');const actual=storedValue(h,'dict2_records');assert.equal(actual.length,2);assert.deepEqual(plain(actual.map(v=>v.rows[0].in)),['acomodation','accommodation']);}
});
test('14 actual shipped history-only master export restores the new container into an empty library',async()=>{
 const item=deliveredItem('demonstration','C11-T1'),h=await app({dict2_records:[rec('history',[{...item,in:'demonstratiom'}])]});await h.click('master',{word:item.w});let backup;h.api.setDownload((name,text)=>backup=JSON.parse(text));await h.click('backup');const fresh=await app();await fresh.click('restore');const input=fresh.nodes['file-input'];input.files=[{text:async()=>JSON.stringify(backup)}];await input.onchange();assert.equal(fresh.api.currentWrong().demonstration.mastered,true);assert.equal(storedValue(fresh,'dict2_wrong').demonstration.evidenceVersion,1);
});
test('15 actual shipped all/chapter playback buttons use one original sid/index pair',async()=>{
 const items=['C11-T1','C3-T3'].map(sid=>deliveredItem('demonstration',sid)),h=await app({dict2_records:[rec('both-play',items.map(item=>({...item,in:'demonstratiom'})))]});for(const sid of ['all','C11-T1','C3-T3']){h.handlers.change({target:{id:'wrong-chapter',value:sid,dataset:{},classList:{contains(){return false;}}}});const match=h.root.innerHTML.match(/aria-label="播放 demonstration" data-act="speak" data-sid="([^"]+)" data-index="([0-9]+)"/);assert.ok(match);assert.equal(scope.DICT_DATA.words[match[1]][Number(match[2])].w,'demonstration');if(sid!=='all')assert.equal(match[1],sid);}
});

const chooseChapter=(h,sid)=>h.handlers.change({target:{id:'wrong-chapter',value:sid,dataset:{},classList:{contains(){return false;}}}});
async function restoreBackup(h,backup){await h.click('restore');const input=h.nodes['file-input'];input.files=[{text:async()=>JSON.stringify(backup)}];await input.onchange();assert.match(h.nodes['#toast'].textContent,/已合并恢复/);}
const draftFixture=(id,input,extra={})=>({id,sid:'C11-T1',mode:'dictation',order:'normal',items:[deliveredItem('demonstration','C11-T1')],inputs:[input],states:[''],idx:0,elapsed:10,...extra});

test('16 mixed pending/confirmed chapters keep status, queue, display and CSV scoped',async()=>{
 const confirmed=deliveredItem('demonstration','C11-T1'),pending=deliveredItem('demonstration','C3-T3');
 const h=await app({dict2_records:[rec('confirmed',[{...confirmed,in:'demonstratiom'}])],dict2_wrong:{demonstration:{sid:pending.sid,index:pending.index,n:5,ts:200}}});
 assert.match(h.root.innerHTML,/另有待确认旧证据/);assert.equal(h.api.filteredReviewItems().length,1);
 chooseChapter(h,pending.sid);assert.equal(h.api.filteredReviewItems().length,0);assert.match(h.root.innerHTML,/data-act="review-all" disabled/);
 await h.click('wrong-filter',{value:'uncertain'});const view=h.api.filteredWrong()[0][1];assert.equal(view.pending,true);assert.equal(view.n,0);assert.equal(view.in,undefined);
 let csv;h.api.setDownload((name,text)=>csv=text);await h.click('export-wrong');assert.match(csv,/C3-T3/);assert.ok(!csv.includes('demonstratiom'));assert.ok(!csv.includes('C11-T1'));
 await h.click('review-all');assert.equal(h.modal.innerHTML,'');assert.equal(h.api.paperItems().length,1,'all-errors paper queue only has the confirmed chapter');
 assert.equal(h.api.answerEntries('filtered').length,0);
 await h.click('paper-option',{key:'source',value:'filtered'});await h.click('paper-option',{key:'dedupe',value:'false'});assert.equal(h.api.paperItems().length,0);
 chooseChapter(h,confirmed.sid);await h.click('wrong-filter',{value:'pending'});assert.equal(h.api.filteredReviewItems()[0].sid,confirmed.sid);assert.equal(h.api.filteredWrong()[0][1].hasPending,false);assert.equal(h.api.answerEntries('filtered')[0].sid,confirmed.sid);
});

test('17 chapter latest typo, error count and export share the selected scope',async()=>{
 const a=deliveredItem('demonstration','C11-T1'),b=deliveredItem('demonstration','C3-T3');
 const h=await app({dict2_records:[rec('older',[{...a,in:'demonstratiom'}],100),rec('newer',[{...b,in:'demonstartion'}],200)]});
 chooseChapter(h,a.sid);let csv;h.api.setDownload((name,text)=>csv=text);await h.click('export-wrong');
 assert.equal(h.api.filteredWrong()[0][1].in,'demonstratiom');assert.match(h.root.innerHTML,/demonstratiom/);assert.ok(!h.root.innerHTML.includes('demonstartion'));
 assert.ok(csv.includes('demonstratiom'));assert.ok(!csv.includes('demonstartion'));assert.equal(h.api.currentWrong().demonstration.in,'demonstartion');
 await h.click('wrong-evidence',{word:a.w});assert.ok(!h.modal.innerHTML.includes('demonstartion'));
});

test('18 unresolvable vocabulary and uncertain links cannot enable an empty review',async()=>{
 const h=await app({dict2_wrong:{'removed word':{sid:'C11-T1',index:-1,n:1,in:'typo'}}});
 assert.equal(h.api.filteredWrong().length,1);assert.equal(h.api.filteredReviewItems().length,0);assert.match(h.root.innerHTML,/data-act="review-all" disabled/);
});

test('19 colliding drafts restore idempotently in both orders, from active/saved/old suffix versions',async()=>{
 const a=draftFixture('r100','local'),b=draftFixture('r100','imported'),backup=value=>({records:[],wrong:{},draft:value,drafts:[value]});
 for(const [first,second] of [[a,b],[b,a]])for(const active of [true,false]){
  const h=await app(active?{dict3_draft:first}:{dict3_saved_drafts:[first]});await restoreBackup(h,backup(second));
  const once=h.memory.get('dict3_saved_drafts');for(let i=0;i<4;i++)await restoreBackup(h,backup(second));assert.equal(h.memory.get('dict3_saved_drafts'),once);
  assert.equal(storedValue(h,'dict3_saved_drafts').length,active?1:2);if(active)assert.deepEqual(storedValue(h,'dict3_draft'),plain(first));
  const exported={records:[],wrong:{},draft:active?first:null,drafts:storedValue(h,'dict3_saved_drafts')},fresh=await app();await restoreBackup(fresh,exported);await restoreBackup(fresh,backup(second));assert.equal(storedValue(fresh,'dict3_saved_drafts').length,2);
 }
 const migrated=await app({dict3_draft:a,dict3_saved_drafts:[{...b,id:'r100-import-1'}]});await restoreBackup(migrated,backup(b));assert.equal(storedValue(migrated,'dict3_saved_drafts').length,2,'unproven old suffix must be preserved as a separate source');
 const stable=migrated.memory.get('dict3_saved_drafts');await restoreBackup(migrated,backup(b));assert.equal(migrated.memory.get('dict3_saved_drafts'),stable);
 await restoreBackup(migrated,backup({...b,id:'unrelated'}));assert.equal(storedValue(migrated,'dict3_saved_drafts').length,3,'same content with a different source is retained');
 await restoreBackup(migrated,backup({...b,order:'shuffle'}));assert.equal(storedValue(migrated,'dict3_saved_drafts').length,4,'different content is retained');
});

test('20 actual legacy import counts distinct original rows and keeps repeated restoration stable',async()=>{
 const h=await app(),item=deliveredItem('demonstration','C3-T3');h.context.DICT_LEGACY_RECORDS={[item.sid]:Array.from({length:5},()=>({w:item.w,in:'demonstartion'}))};
 await h.click('legacy');assert.equal(h.api.currentWrong().demonstration.n,5);await h.click('legacy');assert.equal(h.api.currentWrong().demonstration.n,5);
 await h.click('paper-option',{key:'dedupe',value:'false'});assert.equal(h.api.paperItems().length,5);
 const backup={records:[],wrong:storedValue(h,'dict2_wrong')};await restoreBackup(h,backup);const once=h.memory.get('dict2_wrong');await restoreBackup(h,backup);assert.equal(h.memory.get('dict2_wrong'),once);
});

const evidenceRegion=(h,name)=>{const match=h.modal.innerHTML.match(new RegExp('<section data-evidence-group="'+name+'">([\\s\\S]*?)</section>'));assert.ok(match,'missing evidence region '+name);return match[1];};
test('21 mixed evidence details separate counted errors, unresolved sources and old cumulative claims',async()=>{
 const a=deliveredItem('demonstration','C11-T1'),b=deliveredItem('demonstration','C3-T3');
 const h=await app({dict2_records:[rec('certain',[{...a,in:'demonstratiom'}])],dict2_wrong:{demonstration:{sid:b.sid,index:b.index,n:5}}});
 await h.click('wrong-evidence',{word:a.w});
 assert.match(evidenceRegion(h,'confirmed'),/原题计错 · 1 次/);assert.match(evidenceRegion(h,'confirmed'),/demonstratiom/);assert.ok(!evidenceRegion(h,'confirmed').includes(b.sid));
 assert.match(evidenceRegion(h,'unresolved'),/待核实来源 · 1 条/);assert.match(evidenceRegion(h,'unresolved'),/缺少原始输入/);assert.ok(!evidenceRegion(h,'unresolved').includes(a.sid));
 assert.match(evidenceRegion(h,'cumulative'),/5 次（未验证）/);assert.match(h.modal.innerHTML,/另有待核实证据/);assert.equal(h.api.filteredReviewItems().length,1);
 chooseChapter(h,a.sid);await h.click('wrong-evidence',{word:a.w});assert.match(evidenceRegion(h,'unresolved'),/待核实来源 · 0 条/);assert.ok(!h.modal.innerHTML.includes(b.sid));
 chooseChapter(h,b.sid);await h.click('wrong-filter',{value:'uncertain'});await h.click('wrong-evidence',{word:a.w});assert.match(evidenceRegion(h,'confirmed'),/原题计错 · 0 次/);assert.equal(h.api.filteredReviewItems().length,0);
});

test('22 genuine original suffix IDs and explicit renamed imports never consume each other',async()=>{
 const backup=draft=>({records:[],wrong:{},draft});
 for(const id of ['r100-import-1','r100-import-1-import-2'])for(const reversed of [false,true]){
  const values=[draftFixture('r100','same'),draftFixture(id,'same')];if(reversed)values.reverse();
  const h=await app({dict3_draft:values[0]});await restoreBackup(h,backup(values[1]));assert.equal(storedValue(h,'dict3_saved_drafts').length,1);assert.equal(storedValue(h,'dict3_saved_drafts')[0].id,values[1].id);
  const once=h.memory.get('dict3_saved_drafts');await restoreBackup(h,backup(values[1]));assert.equal(h.memory.get('dict3_saved_drafts'),once);
 }
 const imported=draftFixture('r100-import-1','same',{importSourceId:'r100'}),h=await app({dict3_saved_drafts:[imported]});
 await restoreBackup(h,backup(draftFixture('r100','same')));assert.equal(storedValue(h,'dict3_saved_drafts').length,1);
 await restoreBackup(h,backup(draftFixture('r100-import-1','same')));const saved=storedValue(h,'dict3_saved_drafts');assert.equal(saved.length,2);assert.equal(saved[1].importSourceId,'r100-import-1');
 const once=h.memory.get('dict3_saved_drafts');await restoreBackup(h,backup(draftFixture('r100-import-1','same')));assert.equal(h.memory.get('dict3_saved_drafts'),once);
});

test('23 stable old rows, aliases, unknown cumulative snapshots and conflicting versions obey distinct identity rules',async ()=>{
 const item=deliveredItem('demonstration','C3-T3'),snapshot=(ordinal,input='demonstartion')=>({word:item.w,sid:item.sid,index:item.index,hasInput:true,in:input,n:1,sourceId:C.stableJSON(['bundled-legacy-records',item.sid,ordinal,item.w,input])});
 const derive=snapshots=>C.deriveWrong([],{[item.w]:{...C.evidenceEntry(item.w),legacySnapshots:Object.fromEntries(snapshots.map((v,i)=>[i,v]))}},R)[item.w];
 const rows=Array.from({length:5},(_,i)=>snapshot(i));assert.equal(derive(rows).n,5);assert.equal(derive([...rows,rows[0]]).n,5);
 assert.equal(derive(rows.map((value,i)=>({...value,sourceId:'unknown-'+i,n:5}))).n,1);
 assert.equal(derive([{...rows[0],hasInput:false,in:undefined,n:5}]).n,0);
 const conflict=derive([snapshot(0),snapshot(0,'demonstratiom')]);assert.equal(conflict.n,0);assert.equal(conflict.pending,true);
 const aliased=derive([rows[0],{...rows[0],sourceId:undefined,n:5}]);assert.equal(aliased.n,1);assert.equal(aliased.hasPending,true);
});

test('24 manual, historical and pending evidence preserve mastery through restore and invalidate it only on a new error',async()=>{
 const a=deliveredItem('demonstration','C11-T1'),b=deliveredItem('demonstration','C3-T3'),history=rec('before-mastery',[{...a,in:'demonstratiom'}]);
 const initial=C.mutateWrong({[a.w]:{sid:b.sid,index:b.index,n:5}},{type:'manual',items:[b],now:100});
 const h=await app({dict2_records:[history],dict2_wrong:plain(initial)});assert.equal(h.api.filteredReviewItems().length,2);assert.equal(h.api.currentWrong()[a.w].hasPending,true);assert.equal(h.api.currentWrong()[a.w].n,1);
 await h.click('master',{word:a.w});const mastered=storedValue(h,'dict2_wrong');await restoreBackup(h,{records:[history],wrong:plain(initial)});assert.deepEqual(storedValue(h,'dict2_wrong').demonstration.mastery,mastered.demonstration.mastery);assert.equal(h.api.filteredReviewItems().length,0);
 chooseChapter(h,b.sid);await h.click('wrong-filter',{value:'mastered'});assert.equal(h.api.filteredWrong()[0][1].manual,true);await h.click('wrong-evidence',{word:a.w});assert.match(h.modal.innerHTML,/已掌握（保留）/);assert.match(evidenceRegion(h,'confirmed'),/手动标记可用于复习，不增加错误次数/);assert.match(evidenceRegion(h,'unresolved'),/缺少原始输入/);
 const changed=await deliveredCommit([a],['demonstrationn'],{dict2_records:[history],dict2_wrong:storedValue(h,'dict2_wrong')},'after-mastery');
 assert.equal(changed.api.currentWrong()[a.w].mastered,false);assert.equal(changed.api.currentWrong()[a.w].n,2);assert.equal(changed.api.currentWrong()[a.w].hasPending,true);assert.equal(Object.keys(storedValue(changed,'dict2_wrong').demonstration.manualSources).length,1);
});
