'use strict';
// Same script is delivered as tests/review-regression.test.cjs in the release repository.
// Execute the shipped modules, not a copied implementation. Node standard library only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const filename=process.env.RELEASE_HTML||process.argv[2]||[path.resolve(__dirname,'../index.html'),path.resolve(__dirname,'../_scratch/tmp/ielts-target-reference/index.html')].find(file=>fs.existsSync(file));
assert.ok(filename,'Pass the generated index.html path or set RELEASE_HTML');
const html=fs.readFileSync(filename,'utf8');
function moduleCode(name){const escaped=name.replace(/[.*+?${}()|[\]\\]/g,'\\$&'),match=html.match(new RegExp('<!-- Inlined: '+escaped+' -->\\s*<script>\\s*([\\s\\S]*?)<\\/script>'));assert.ok(match,'Missing delivered module '+name);return match[1];}
function environment(){const context={console,URL,URLSearchParams};context.window=context;vm.createContext(context);for(const name of ['data/words.js','data/rules.js','core.js','wrong-frequency.js','dictation-features.js','learning-insights.js'])vm.runInContext(moduleCode(name),context,{filename:name});return context;}
const scope=environment(),C=scope.DictationCore,W=scope.DictationWrongFrequency,R=scope.DICT_RULES,S={ignoreCase:true,looseRules:true},plain=value=>JSON.parse(JSON.stringify(value));
const row=(w,input,index=0)=>({w,in:input,sid:'C3-T1',index}),rec=(id,rows,ts=100)=>({id,sid:'C3-T1',mode:'dictation',ts,ms:1,rows});
function app(storage={},hash='#wrong'){
 const context=environment(),memory=new Map(Object.entries(storage).map(([key,value])=>[key,JSON.stringify(value)])),handlers={},events={};
 const classes={add(){},remove(){},toggle(){},contains(){return false;}},element=()=>({innerHTML:'',textContent:'',dataset:{},classList:classes,style:{},setAttribute(){},focus(){},querySelector(){return null;},querySelectorAll(){return [];},insertAdjacentHTML(){}}),root=element(),modal=element(),toast=element(),close=element();
 const nodes={'#app':root,'#modal-root':modal,'#toast':toast,'#modal-root .icon-btn':close};
 context.document={documentElement:{...element(),style:{setProperty(){},removeProperty(){}}},body:{classList:classes,appendChild(){}},querySelector:key=>nodes[key]||null,querySelectorAll:()=>[],activeElement:null,addEventListener:(name,fn)=>handlers[name]=fn};
 context.location={hash,search:'',protocol:'file:',href:'file:///review/index.html',hostname:''};context.Audio=class{setAttribute(){}pause(){}load(){}addEventListener(){}removeEventListener(){}play(){return Promise.resolve();}};
 context.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};context.setTimeout=()=>1;context.clearTimeout=()=>{};context.setInterval=()=>1;context.clearInterval=()=>{};context.addEventListener=(name,fn)=>events[name]=fn;context.scrollTo=()=>{};
 const hooks='window.__review={paperItems,currentWrong,currentRecords,setDownload(callback){download=callback;}};';
 vm.runInContext(moduleCode('app.js').replace('  settings = sanitizeSettings(settings);',hooks+'\n  settings = sanitizeSettings(settings);'),context,{filename:'delivered-app.js'});
 const click=async(act,extra={})=>{const target={dataset:{act,...extra},classList:classes,closest(){return this;}};await handlers.click({target});};return {context,root,modal,memory,click,events,api:context.__review};
}
test('1 independent legacy error survives correct history, while known question evidence is counted once',()=>{
 const history=[rec('correct',[row('accommodation','accommodation')])],stored={accommodation:{sid:'C3-T1',index:0,in:'accomodation',n:4,ts:50,mastered:true}},before=JSON.stringify({history,stored});const actual=C.deriveWrong(history,stored,R);assert.equal(actual.accommodation.n,1);assert.equal(actual.accommodation.mastered,true);assert.equal(actual.accommodation.legacyCount,4);
 const made=C.makeRecord({id:'made',sid:'C3-T1',mode:'dictation',items:[{w:'accommodation',sid:'C3-T1',index:0}],inputs:['accomodation']},S,R,'made',200),saved=C.updateWrong({},made);for(let i=0;i<3;i++){const view=C.deriveWrong([made,made],saved,R);assert.equal(view.accommodation.n,1);assert.equal(view.accommodation.provenance.legacy,'matched');}assert.equal(JSON.stringify({history,stored}),before);
 const unresolved=C.deriveWrong([made],stored,R).accommodation;assert.equal(unresolved.n,1);assert.equal(unresolved.legacyEvidence.state,'unresolved-link');
});
test('2 pending never replaces latest effective error or breaks effective consecutive correct',()=>{
 const pending=rec('p',[row('survey survey','survey')],200),correct=W.profiles([rec('c',[row('survey','survey'),row('survey','survey')]),pending],R).find(v=>v.word==='survey');assert.equal(correct.shortTerm.correctStreak,2);assert.equal(correct.pending,2);assert.equal(correct.shortTerm.latestRound,'c');const wrong=W.profiles([rec('bad',[row('survey','servey')]),pending],R).find(v=>v.word==='survey');assert.ok(wrong.observations.some(v=>v.code==='latest-error'));
});
test('3 delivered CSV keeps original live feedback, derived learning, strict and format columns separate',async()=>{
 const record={...rec('csv',[{...row('full-time','full time'),liveCorrect:false,correct:false},{...row('survey','servey'),liveCorrect:true}]),grading:'book'},h=app({dict2_records:[record],dict3_last_result:'csv'},'#result');let output;h.api.setDownload((name,text)=>output=text);await h.click('export-result');
 const cells=line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(v=>v[1]),lines=output.split('\r\n'),header=cells(lines[0]),values=cells(lines[1]);assert.equal(values[header.indexOf('原始即时判定')],'错');assert.equal(values[header.indexOf('新版学习判定')],'对');assert.equal(values[header.indexOf('严格判定')],'错');assert.ok(values[header.indexOf('格式说明')]);await h.click('result-filter',{value:'wrong'});await h.click('export-result');const selected=cells(output.split('\r\n')[1]);assert.equal(selected[header.indexOf('原始即时判定')],'对');assert.equal(selected[header.indexOf('正确率(%)')],'50');
});
test('4 pending entries have a separate consistent group and preserve mastery',async()=>{
 const h=app({dict2_wrong:{ability:{sid:'C3-T1',index:0,n:9,mastered:true},survey:{sid:'C11-T1',in:'servey',n:4}}});assert.match(h.root.innerHTML,/data-wrong-count="pending">1/);assert.match(h.root.innerHTML,/data-wrong-count="uncertain">1/);assert.match(h.root.innerHTML,/data-wrong-count="mastered">0/);assert.ok(!h.root.innerHTML.includes('data-act="wrong-evidence" data-word="ability"'));await h.click('wrong-filter',{value:'uncertain'});assert.match(h.root.innerHTML,/data-act="review-all" disabled/);assert.ok(h.root.innerHTML.includes('data-act="wrong-evidence" data-word="ability"'));await h.click('wrong-evidence',{word:'ability'});assert.match(h.modal.innerHTML,/缺少原始输入/);assert.match(h.modal.innerHTML,/已掌握（保留）/);assert.equal(h.api.currentWrong().ability.pending,true);
});
test('5 trend describes current derived learning rules, not original grading policy',()=>{const h=app({},'#library');assert.match(h.root.innerHTML,/历史正确率按当前统一学习规则派生/);assert.ok(!h.root.innerHTML.includes('正确率沿用每次练习的判分设置'));});
test('6 corpus-based hyphen practice needs no history and retains original audio identities',async()=>{
 const h=app();await h.click('paper-setup');assert.match(h.modal.innerHTML,/连字符专项/);assert.match(h.modal.innerHTML,/当前章节/);await h.click('paper-option',{key:'source',value:'hyphen'});const items=h.api.paperItems();assert.ok(items.length>90);for(const item of items)assert.equal(h.context.DICT_DATA.words[item.sid][item.index].w,item.w);const expected=Object.values(h.context.DICT_DATA.words).flat().filter(v=>C.normalize(v.w).includes('-')).length;assert.equal(items.length,expected);
});
test('7 accepted whole-answer formats never manufacture token errors in either direction or context',()=>{
 const rules={...R,learningFormats:[...R.learningFormats,['check-in','check in']]};for(const [a,b]of [['full-time','full time'],['brother-in-law','brother in law'],['mother-in-law','mother in law'],['check-in','check in']])for(const [answer,input]of [[a,b],[b,a],['a '+a+' student','a '+b+' student'],['a '+b+' student','a '+a+' student']]){assert.equal(C.scoreGrade(input,answer,S,rules).correct,true);assert.ok(W.occurrencesForRow(input,answer,S,rules).every(v=>!['incorrect','omission'].includes(v.verdict)));assert.ok(W.profiles([rec(answer,[row(answer,input)])],rules).every(v=>v.n===0));}
 for(const [input,answer]of [['fulltime','full-time'],['checkin','check-in'],['invisible','in visible'],['lisense','licence']])assert.equal(C.scoreGrade(input,answer,S,rules).correct,false);
});
test('8 raw history and saved wrong evidence remain unchanged in delivered JSON backup',async()=>{
 const record={...rec('backup',[{...row('full-time','full time'),correct:false,liveCorrect:false}]),pct:0},stored={'full-time':{sid:'C3-T1',index:0,in:'full time',n:4,mastered:true}},h=app({dict2_records:[record],dict2_wrong:stored,dict3_last_result:'backup'},'#result');assert.ok(!h.api.currentWrong()['full-time']);let backup;h.api.setDownload((name,text)=>backup=JSON.parse(text));await h.click('backup');assert.deepEqual(plain(backup.records),[record]);assert.deepEqual(plain(backup.wrong),stored);
});
