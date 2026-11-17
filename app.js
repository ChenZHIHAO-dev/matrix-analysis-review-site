(function(){
  'use strict';
  const D=window.REVIEW_DATA,C=window.ReviewCore;
  const SC=D?.examScoring;
  const main=document.querySelector('#main');
  if(!D||!C){main.textContent='题库未成功加载。请把本文件与 bank.js、core.js、app.js 保持在同一文件夹后重新打开。';return;}
  const KEY='ucas.matrix.review.public.v1';
  const qMap=new Map(D.questions.map(q=>[q.id,q])),calcMap=new Map([...D.calculations,...(D.pastPapers?.problems||[]),...(D.extraCalculations||[]),...(D.recallCalculations||[])].map(c=>[c.id,c]));
  const navItems=[['dashboard','◫','复习总览'],['practice','✎','判断题'],['calculations','∑','计算题']];
  const VIEW_NAMES=new Set(['dashboard','practice','calculations','guides','review','history','roadmap']);
  const viewLabels={dashboard:'复习总览',practice:'判断题',calculations:'计算题',guides:'知识点讲解',review:'错题与存疑',history:'历史作答'};
  const normalizeNav=n=>n==='roadmap'||n==='exam'?'dashboard':n==='history'&&D.publicShare?'practice':n;
  const labels={correct:'答对',wrong:'答错',unsure:'不确定',unanswered:'未作答'};
  const answerLabels={T:'对',F:'错',U:'不确定'};
  let storageOK=true,toastTimer=null;
  const defaults=()=>({version:1,nav:'dashboard',chapter:1,pool:'original',historyChapter:1,reviewFilter:'pending',sessions:{},manualFlags:[],mastered:[],calcNotes:{},exam:null});
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Preserve a formula as one text node: inserting <br> inside TeX prevents
  // auto-render from finding its closing delimiter, even when the TeX is valid.
  const mathParts=s=>String(s??'').split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$|\\\([\s\S]*?\\\))/g);
  const html=s=>mathParts(s).map((part,i)=>i%2?escape(part):escape(part).replace(/\n/g,'<br>')).join('');
  const pct=n=>(n*100).toFixed(1)+'%';
  const number=n=>Number(n).toLocaleString('zh-CN',{useGrouping:false,maximumSignificantDigits:6});
  const safeIds=ids=>Array.isArray(ids)?[...new Set(ids.filter(id=>Number.isInteger(id)&&qMap.has(id)))]:[];
  function safeSession(x){
    if(!x||typeof x!=='object'||!Array.isArray(x.ids))return null;
    const ids=safeIds(x.ids),answers={};
    for(const id of ids)if(C.validAnswer(x.answers?.[id]))answers[id]=x.answers[id];
    const checkedAt={};
    for(const id of ids){const at=x.checkedAt?.[id];if(typeof at==='string'&&Number.isFinite(Date.parse(at)))checkedAt[id]=at;}
    return {ids,answers,checkedAt,collapsed:safeIds(x.collapsed).filter(id=>checkedAt[id]),flags:safeIds(x.flags).filter(id=>ids.includes(id)),submittedAt:typeof x.submittedAt==='string'&&Number.isFinite(Date.parse(x.submittedAt))?x.submittedAt:null};
  }
  function safeCalc(x={}){return {text:typeof x.text==='string'?x.text.slice(0,30000):'',score:Number.isFinite(x.score)?Math.min(15,Math.max(0,x.score)):null,reveal:!!x.reveal};}
  function sanitize(x){
    if(!x||typeof x!=='object'||x.version!==1)throw new Error('不支持的进度版本');
    const out=defaults();
    if(VIEW_NAMES.has(x.nav))out.nav=normalizeNav(x.nav);
    if(Number.isInteger(x.chapter)&&x.chapter>=1&&x.chapter<=8)out.chapter=x.chapter;
    if(['all','original','new'].includes(x.pool))out.pool=x.pool;
    if([1,2,3].includes(x.historyChapter))out.historyChapter=x.historyChapter;
    if(['pending','all','mastered'].includes(x.reviewFilter))out.reviewFilter=x.reviewFilter;
    out.manualFlags=safeIds(x.manualFlags);out.mastered=safeIds(x.mastered);
    for(const [key,value]of Object.entries(x.sessions||{})){if(!/^ch-[1-8]-(all|original|new)$/.test(key))continue;const s=safeSession(value);if(s)out.sessions[key]=s;}
    for(const id of calcMap.keys())if(x.calcNotes?.[id])out.calcNotes[id]=safeCalc(x.calcNotes[id]);
    const e=safeSession(x.exam);
    if(e&&e.ids.length===20){
      const cids=Array.isArray(x.exam.calculationIds)?[...new Set(x.exam.calculationIds.filter(id=>calcMap.has(id)))]:[];
      if(cids.length===4){out.exam={...e,checkedAt:{},collapsed:[],calculationIds:cids,calc:{},startedAt:typeof x.exam.startedAt==='string'?x.exam.startedAt:new Date().toISOString(),includeOptional:!!x.exam.includeOptional};for(const id of cids)out.exam.calc[id]=safeCalc(x.exam.calc?.[id]);}
    }
    return out;
  }
  let state=defaults();
  try{const raw=localStorage.getItem(KEY);if(raw)state=sanitize(JSON.parse(raw));}catch(e){storageOK=false;}
  // View-only selections need not mutate the historical answer record.
  let guideId=null,guideOrigin=null,guideCalculationOrigin=null,calculationId=null,calcMode='core',calcMethod='householder',historyFilter='all',expandAll=false,referenceQuestionId=null;
  function routeView(){return {nav:state.nav,chapter:state.chapter,pool:state.pool,historyChapter:state.historyChapter,reviewFilter:state.reviewFilter,guideId,guideOrigin,guideCalculationOrigin,calculationId,calcMethod,referenceQuestionId};}
  function routeHash(view){
    const params=new URLSearchParams({view:view.nav});
    if(view.nav==='calculations'){params.set('case',view.calculationId||'C49');if(view.calcMethod!=='householder')params.set('method',view.calcMethod);}
    if(view.nav==='guides'&&view.guideId)params.set('guide',view.guideId);
    if(view.nav==='guides'&&view.referenceQuestionId)params.set('question',view.referenceQuestionId);
    if(view.nav==='practice'){params.set('chapter',view.chapter);params.set('pool',view.pool);}
    return '#'+params.toString();
  }
  function rememberRoute(replace=false){
    const view=routeView(),url=routeHash(view);
    const previous=window.history.state?.matrixView;
    if(!replace&&previous)window.history.replaceState({matrixView:previous,scrollY:window.scrollY},'',window.location.href);
    if(replace||window.location.hash===url)window.history.replaceState({matrixView:view,scrollY:0},'',url);
    else window.history.pushState({matrixView:view,scrollY:0},'',url);
  }
  function applyRoute(view){
    if(!view||(!VIEW_NAMES.has(view.nav)&&view.nav!=='exam'))return false;
    state.nav=normalizeNav(view.nav);
    if(Number.isInteger(view.chapter)&&view.chapter>=1&&view.chapter<=8)state.chapter=view.chapter;
    if(['all','original','new'].includes(view.pool))state.pool=view.pool;
    if([1,2,3].includes(view.historyChapter))state.historyChapter=view.historyChapter;
    if(['pending','all','mastered'].includes(view.reviewFilter))state.reviewFilter=view.reviewFilter;
    guideId=D.guides.some(g=>g.id===view.guideId)?view.guideId:null;
    guideOrigin=view.guideOrigin||null;guideCalculationOrigin=view.guideCalculationOrigin||null;
    calculationId=calcMap.has(view.calculationId)?view.calculationId:null;
    calcMethod=['householder','qr-givens','qr-gram-schmidt'].includes(view.calcMethod)?view.calcMethod:'householder';
    referenceQuestionId=qMap.has(+view.referenceQuestionId)?+view.referenceQuestionId:null;
    return true;
  }
  function hashView(){
    const p=new URLSearchParams(window.location.hash.slice(1));if(!p.has('view'))return null;
    return {nav:p.get('view'),chapter:+p.get('chapter'),pool:p.get('pool'),guideId:p.get('guide'),calculationId:p.get('case'),calcMethod:p.get('method'),referenceQuestionId:+p.get('question')};
  }
  window.addEventListener('popstate',e=>{
    if(!applyRoute(e.state?.matrixView||hashView()))return;
    expandAll=false;render();save();window.scrollTo(0,e.state?.scrollY||0);
  });
  function save(){
    try{localStorage.setItem(KEY,JSON.stringify(state));storageOK=true;}catch(e){storageOK=false;}
    const el=document.querySelector('#saveState');
    el.classList.toggle('bad',!storageOK);
    el.textContent=storageOK?'● 进度已保存在此浏览器':'未能持久保存 · 请导出进度备份';
  }
  function toast(text){clearTimeout(toastTimer);const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),3200);}
  async function confirmAction(title,text){
    const dialog=document.querySelector('#confirmDialog');
    document.querySelector('#dialogTitle').textContent=title;document.querySelector('#dialogText').textContent=text;
    return new Promise(resolve=>{dialog.returnValue='cancel';dialog.addEventListener('close',()=>resolve(dialog.returnValue==='ok'),{once:true});dialog.showModal();});
  }
  function math(root=main){
    root.querySelectorAll('table').forEach(table=>{if(!table.parentElement.classList.contains('table-wrap')){const wrap=document.createElement('div');wrap.className='table-wrap';table.before(wrap);wrap.append(table);}});
    if(window.renderMathInElement){renderMathInElement(root,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],throwOnError:false,strict:'ignore',trust:false,ignoredTags:['script','noscript','style','textarea','pre','code','option']});}
  }
  function sourceLink(id){const s=D.sections[id];return `<span class="source-link">§${id} ${escape(s.title)} · 书稿 p.${s.bookPage} / PDF ${s.pdfPage}</span>`;}
  function topicLinks(q){return (q.guideIds||[]).map(id=>{const g=D.guides.find(g=>g.id===id);return `<button class="text-button" data-guide="${id}">讲解：${escape(g.title)}</button>`;}).join('');}
  function theoremLink(id){const t=D.theorems[id];return t?`<span class="source-link">定理${id} · 书稿 p.${t.bookPage} / PDF ${t.pdfPage}</span>`:'';}
  function guideButtons(ids){return (ids||[]).map(id=>{const g=D.guides.find(g=>g.id===id);return g?`<button class="text-button" data-guide="${id}">${escape(g.title)} →</button>`:'';}).join('');}
  function conceptCards(q){return (q.conceptIds||[]).map(id=>{const c=D.concepts[id];return `<details class="concept-review"><summary>知识联系：${escape(c.title)}</summary><div class="concept-body">${c.body}<div class="source-links">${c.theorems.map(theoremLink).join('')}</div>${guideButtons([c.guideId])}</div></details>`;}).join('');}
  const tag=q=>`<span class="tag ${q.scope==='课堂待确认'?'optional':''}">${q.scope}</span>`;
  function head(eyebrow,title,intro,actions=''){return `<div class="page-head"><div><div class="overline">${eyebrow}</div><h1>${title}</h1>${intro?`<p class="intro">${intro}</p>`:''}</div>${actions?`<div class="button-row">${actions}</div>`:''}</div>`;}
  function go(nav){nav=normalizeNav(nav);if(!VIEW_NAMES.has(nav))return;state.nav=nav;if(nav!=='guides'){guideOrigin=null;guideCalculationOrigin=null;referenceQuestionId=null;}expandAll=false;rememberRoute();render();save();window.scrollTo(0,0);}
  function primaryNav(){
    if(['practice','review','history'].includes(state.nav))return 'practice';
    if(state.nav==='calculations'||state.nav==='guides'&&guideCalculationOrigin)return 'calculations';
    if(state.nav==='guides'&&guideOrigin)return 'practice';
    return 'dashboard';
  }
  function renderNav(){
    const active=primaryNav();
    document.querySelector('#nav').innerHTML=navItems.map(([id,icon,label])=>`<button data-nav="${id}" class="${active===id?'active':''}" ${active===id?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join('');
    document.querySelector('#breadcrumb').textContent=viewLabels[state.nav]||'复习总览';
  }
  function render(){
    renderNav();
    const views={dashboard,practice,history,review,guides,calculations};
    main.innerHTML=(views[state.nav]||dashboard)();math();
    if(state.nav==='guides'&&guideId==='condition')updateLab();
    document.title=(viewLabels[state.nav]||'复习总览')+' · 矩阵复习';
  }
  function reviewFocus(){
    return `<section class="review-focus" aria-labelledby="review-focus-heading"><div class="section-heading"><div><h2 id="review-focus-heading">复习重点</h2><p class="small muted">先看要解决的问题，再进入例题与知识解释。</p></div><button class="text-button" data-guides-home>知识点索引 ›</button></div><div class="focus-grid">${(D.reviewFocus||[]).map((item,i)=>`<article class="focus-card"><div class="focus-title"><span>${String(i+1).padStart(2,'0')}</span><h3>${escape(item.title)}</h3></div><p>${escape(item.summary)}</p><ul>${item.skills.map(skill=>`<li>${escape(skill)}</li>`).join('')}</ul><div class="focus-actions"><button class="button secondary small" data-calc="${item.calcIds[0]}">进入例题 ›</button><button class="text-button" data-guide="${item.guideIds[0]}">知识解释</button></div></article>`).join('')}</div></section>`;
  }
  function courseOverview(){
    return `<details class="overview-map"><summary><strong>全书知识脉络</strong><span>展开查看八章之间的联系</span></summary><div class="overview-map-body"><p>消元与秩零度解释核和像；选基将线性变换写成矩阵；正交工具连接QR、SVD和对称谱分解。</p><ol class="logic-lines"><li>消元 → 自由变量 → 秩与零空间 → 特征空间维数。</li><li>线性变换 → 输入、输出基 → 表示矩阵 → 换坐标与相似。</li><li>内积与正交 → Gram矩阵 → QR、SVD与四个空间。</li><li>特征向量基 → 谱投影与矩阵幂；对称消元 → 主元、LDLᵀ与正定性。</li></ol>${D.chapterMap.map(ch=>`<div class="map-chapter"><strong>第${ch.chapter}章 · ${escape(D.chapters.find(c=>c.id===ch.chapter).title)}</strong><p>${escape(ch.connection)}</p><p class="small muted">本章重点：${escape(ch.core)}</p>${guideButtons(ch.guideIds.slice(0,2))}</div>`).join('')}</div></details>`;
  }
  function dashboard(){
    const prior=D.questions.filter(q=>q.prior),r=C.grade(prior,Object.fromEntries(prior.map(q=>[q.id,q.prior])));
    const pending=C.reviewItems(D.questions,state).filter(x=>!x.mastered).length;
    const checked=new Set(Object.values(state.sessions).flatMap(session=>Object.keys(session.checkedAt||{})));
    return `<section class="hero"><div><div class="overline">MATRIX REVIEW</div><h1>理解概念，<br>掌握计算。</h1><p>${D.publicShare?'每位使用者从自己的练习记录开始。':'原有作答与笔记已保留。'}按章自测判断题，按题型学习计算步骤，再把相关知识联系起来。</p><div class="button-row"><button class="button" data-chapter="${state.chapter}">开始判断题 ›</button><button class="button secondary" data-calc="C49">学习计算题 ›</button></div></div><div class="hero-math" aria-hidden="true">A = UΣV*<br>P⁻¹AP = D<small>UNDERSTAND &amp; PRACTISE</small></div></section><section class="stat-grid" aria-label="复习概览"><div class="stat"><div class="stat-label">八章判断题</div><div class="stat-value">${D.questions.length}<span>道</span></div><div class="stat-foot">逐题作答与解析</div></div><div class="stat"><div class="stat-label">${D.publicShare?'我已核对':'原作答已批改'}</div><div class="stat-value">${D.publicShare?checked.size:r.total}<span>道</span></div><div class="stat-foot">练习记录分别保存</div></div><div class="stat"><div class="stat-label">待复习</div><div class="stat-value">${pending}<span>道</span></div><div class="stat-foot">在判断题中查看</div></div><div class="stat"><div class="stat-label">计算题型</div><div class="stat-value">${D.calculationTopics.length-1}<span>类</span></div><div class="stat-foot">另有考后回忆资料</div></div></section>${reviewFocus()}<section class="overview-chapters" aria-labelledby="overview-chapters-title"><div class="section-heading"><h2 id="overview-chapters-title">按章自测</h2><button class="text-button" data-nav="review">错题与存疑 ›</button></div><div class="overview-chapter-grid">${D.chapters.map(ch=>`<button class="overview-chapter" data-chapter="${ch.id}"><span class="chapter-number">${String(ch.id).padStart(2,'0')}</span><span><strong>${escape(ch.title)}</strong><small>${D.questions.filter(q=>q.chapter===ch.id).length}道判断题</small></span><span aria-hidden="true">›</span></button>`).join('')}</div></section>${courseOverview()}<section class="recall-entry"><div><h2>考题回忆</h2><p>考后整理的题目与解答，缺失数据和不确定分值已注明。</p></div><button class="button secondary" data-calc="R26-01">查看考题回忆 ›</button></section>`;
  }
  function judgmentNav(){
    const entries=[['practice','按章练习'],['review','错题与存疑'],...(!D.publicShare?[['history','历史作答']]:[])];
    return `<nav class="judgment-nav" aria-label="判断题栏目">${entries.map(([id,label])=>`<button class="${state.nav===id?'active':''}" data-nav="${id}" ${state.nav===id?'aria-current="page"':''}>${label}${id==='review'?`<span>${C.reviewItems(D.questions,state).filter(x=>!x.mastered).length}</span>`:''}</button>`).join('')}</nav>`;
  }
  function chapterQuestions(){return D.questions.filter(q=>q.chapter===state.chapter&&(state.pool==='all'||(state.pool==='original'?q.origin==='原题':q.origin!=='原题')));}
  function sessionKey(){return `ch-${state.chapter}-${state.pool}`;}
  function getSession(){
    const key=sessionKey();if(!state.sessions[key])state.sessions[key]={ids:chapterQuestions().map(q=>q.id),answers:{},flags:[],checkedAt:{},collapsed:[],submittedAt:null};
    const session=state.sessions[key];
    // A later bank update appends new items only to an unsubmitted draft.
    if(!session.submittedAt)session.ids=chapterQuestions().map(q=>q.id);
    return session;
  }
  function practiceOptions(q,s){return {answer:s.answers[q.id],submitted:!!s.submittedAt,context:'chapter',flagged:s.flags.includes(q.id),checked:!!s.checkedAt[q.id],solutionOpen:!s.submittedAt?!!s.checkedAt[q.id]&&!s.collapsed.includes(q.id):null};}
  function question(q,{answer,submitted=false,context='',flagged=false,checked=false,solutionOpen=null,forceOpen=false,reviewEntry=null}={}){
    const v=C.verdict(q,answer),read=submitted||checked,perQuestion=context==='chapter'&&!submitted;
    const open=read&&(solutionOpen??(forceOpen||expandAll||v!=='correct'||flagged));
    const cls=read?(v==='wrong'?'is-wrong':['unsure','unanswered'].includes(v)||flagged?'is-unsure':''):'';
    return `<article id="q-${q.id}" class="question ${cls}"><div class="q-meta"><span class="q-id">NO. ${String(q.id).padStart(3,'0')}</span><span>${escape(q.topic)}</span>${tag(q)}<span class="q-origin">第${q.chapter}章 · ${q.origin}</span></div><div class="q-text" id="q-label-${q.id}">${html(q.text)}</div>${context?`<fieldset><legend class="sr-only">第${q.id}题：判断对错</legend><div class="choices">${['T','F','U'].map(a=>`<label class="choice ${answer===a?'selected':''}"><input type="radio" name="${context}-${q.id}" value="${a}" data-answer="${q.id}" data-context="${context}" ${answer===a?'checked':''} ${read?'disabled':''}><span>${a==='T'?'✓':a==='F'?'×':'?'} ${answerLabels[a]}</span></label>`).join('')}<button class="flag-button ${flagged?'flagged':''}" data-flag="${q.id}" data-context="${context}" aria-pressed="${flagged}">${flagged?'★ 已标记存疑':'☆ 这题仍存疑'}</button></div></fieldset>`:''}
    ${perQuestion||read?`<details class="explanation" ${open?'open':''}><summary ${perQuestion?`data-q-reveal="${q.id}" aria-controls="answer-${q.id}"`:''}>${open?'收起答案与解析':'查看答案与解析'}</summary><div class="exp-body" id="answer-${q.id}">${read?`<div class="q-verdict"><span class="pill ${v==='wrong'?'wrong':v==='correct'?'':'unsure'}">${labels[v]}</span><span>你的答案：${answerLabels[answer]||'未作答'}；正确答案：<strong>${q.answer?'对':'错'}</strong></span>${reviewEntry?`<span class="muted small">${reviewEntry.reasons.map(escape).join(' · ')}</span>`:''}</div><section class="answer-reasoning"><h3>这道题为什么${q.answer?'对':'错'}</h3>${stepBody(q.explanation)}</section><div class="takeaway"><strong>记住这一点：</strong>${html(q.takeaway)}</div>${q.note?`<div class="source-note"><strong>题目审校：</strong>${html(q.note)}${q.originalText&&q.originalText!==q.text?`<br>原题：${html(q.originalText)}`:''}</div>`:''}${q.guideIds?.length?`<section class="question-deep-links"><h3>相关知识，展开讲清楚</h3><p>定义、定理条件、例子与相近概念放在专题中。读完可返回本题。</p><div class="source-links">${topicLinks(q)}</div></section>`:''}${conceptCards(q)}<div class="source-links">${sourceLink(q.section)}</div>${perQuestion?`<div class="question-retry"><span>本题已核对并保存；可重新作答。</span><button class="text-button" data-q-retry="${q.id}">重新作答本题</button></div>`:''}`:''}</div></details>`:''}
    ${reviewEntry?`<div class="button-row" style="margin-top:14px"><button class="button secondary small" data-mastered="${q.id}">${reviewEntry.mastered?'重新列入待复习':'已理解，移出待复习'}</button></div>`:''}</article>`;
  }
  function groupedQuestions(qs,optionsFor){
    const chapter=qs[0]?.chapter,order=D.chapterGroupOrder[chapter]||D.questionGroups.map(g=>g.id);
    return order.map(id=>D.questionGroups.find(g=>g.id===id)).map(group=>{
      const items=qs.filter(q=>q.groupId===group.id);if(!items.length)return '';
      const options=items.map(optionsFor),submitted=options.every(o=>o.submitted),focus=items.some((q,i)=>C.verdict(q,options[i].answer)!=='correct');
      return `<section class="question-group"><div class="question-group-head"><div class="overline">同类自测 · ${items.length}题</div><h2>${escape(group.title)}</h2><p class="small muted">逐题看条件，再看本组共同归纳。 全书同组题来自第${group.chapters.join('、')}章。</p></div>${items.map((q,i)=>question(q,options[i])).join('')}<details class="group-summary" ${submitted&&focus?'open':''}><summary>把这一组题连起来理解</summary><div class="concept-body">${group.summary}<div class="source-links">${guideButtons(group.guideIds)}</div></div></details></section>`;
    }).join('');
  }
  function refreshQuestion(id){
    const old=document.querySelector('#q-'+id);if(!old)return;
    old.outerHTML=question(qMap.get(id),practiceOptions(qMap.get(id),getSession()));
    const card=document.querySelector('#q-'+id);math(card);card.querySelector('summary[data-q-reveal]')?.focus({preventScroll:true});
  }
  function resultBlock(qs,session,examMode=false){
    const r=C.grade(qs,session.answers);
    return `<section class="result" aria-label="提交结果"><div class="overline">CHAPTER REVIEW</div><h2>${examMode?`判断题得分：${number(r.correct/SC.judgmentCount*SC.judgmentTotal)} / ${SC.judgmentTotal}`:`已完成批改 · ${r.correct} / ${r.total} 题答对`}</h2><p>正确数／总数 ${pct(r.rate)}${r.knownRate!==null?`；明确作答（对／错）的正确率 ${pct(r.knownRate)}`:''}。“不确定”和“未作答”单列统计，均进入待复习。</p><div class="result-numbers">${['correct','wrong','unsure','unanswered'].map(v=>`<div><strong>${r[v]}</strong><span>${labels[v]}</span></div>`).join('')}</div><div class="button-row"><button class="button secondary small" data-expand>${expandAll?'收起答对题的解析':'展开全部解析'}</button><button class="button secondary small" data-nav="review">去错题与存疑</button>${!examMode?'<button class="text-button" data-retry>重新练习此题组</button>':''}</div><div class="jump-grid">${r.records.map(rec=>`<a href="#q-${rec.id}" class="${rec.state==='wrong'?'wrong':rec.state==='correct'?'':'unsure'}" aria-label="第${rec.id}题，${labels[rec.state]}">${rec.id}</a>`).join('')}</div></section>`;
  }
  function practice(){
    const ch=D.chapters.find(ch=>ch.id===state.chapter),s=getSession(),link=D.chapterMap.find(x=>x.chapter===state.chapter);
    const qs=s.ids.map(id=>qMap.get(id)).filter(Boolean),count=Object.keys(s.answers).filter(id=>s.ids.includes(+id)).length,added=chapterQuestions().filter(q=>!s.ids.includes(q.id));
    return judgmentNav()+head('CHAPTER PRACTICE',`第${ch.id}章 · ${ch.title}`,'每题先选择“对”“错”或“不确定”，再点题后的“查看答案与解析”。逐题核对会保存结果，也可跳转知识点详解；整章提交用于集中统计。')+
      `<div class="chapter-context"><strong>本章主线：${escape(link.question)}</strong><p>${escape(link.connection)}</p><button class="text-button" data-nav="roadmap">放回全书看 →</button></div><div class="chapter-tabs" aria-label="章节">${D.chapters.map(ch=>`<button data-chapter="${ch.id}" class="${ch.id===state.chapter?'active':''}">第${ch.id}章<span>${D.questions.filter(q=>q.chapter===ch.id).length}题</span></button>`).join('')}</div><div class="toolbar"><label>题目范围 <select id="pool"><option value="all" ${state.pool==='all'?'selected':''}>本章全部题目</option><option value="original" ${state.pool==='original'?'selected':''}>只练原题（保留编号）</option><option value="new" ${state.pool==='new'?'selected':''}>只练新增题</option></select></label><span class="small muted">不同题组分别保存作答</span></div>${s.submittedAt&&added.length?`<div class="banner">这次提交后，本题组新增${added.length}题（${added.map(q=>q.id).join('、')}）。已有批改保留；可重练本题组纳入新题。<button class="text-button" data-retry>重练并加入新增题 →</button></div>`:''}${!qs.length?'<div class="empty"><h2>本章没有原题</h2><p>请选择“本章全部题目”或“只练新增题”。</p></div>':`${s.submittedAt?resultBlock(qs,s):`<div class="practice-sticky"><div><strong>本章作答</strong> <small id="answerCount">${count} / ${qs.length}</small><small id="checkedCount">已核对 ${Object.keys(s.checkedAt).length} 题</small></div><button class="button" data-submit="chapter">提交本章答案</button></div><div class="progress-line"><span id="answerProgress" style="width:${count/qs.length*100}%"></span></div>`}${groupedQuestions(qs,q=>practiceOptions(q,s))}${!s.submittedAt?'<div class="button-row"><button class="button" data-submit="chapter">提交本章答案</button><span class="small muted">作答自动保存，可以随时离开。</span></div>':''}`}`;
  }
  function history(){return head('PRACTICE','我的练习','请在按章练习中开始作答。');}
  function latestAnswer(id){
    const at=s=>s.checkedAt?.[id]||s.submittedAt;
    const sessions=[...Object.values(state.sessions),...(state.exam?[state.exam]:[])].filter(s=>s.ids.includes(id)&&at(s)).sort((a,b)=>Date.parse(at(b))-Date.parse(at(a)));
    return sessions.length?sessions[0].answers[id]:qMap.get(id).prior;
  }
  function review(){
    const items=C.reviewItems(D.questions,state),shown=items.filter(i=>state.reviewFilter==='all'||(state.reviewFilter==='mastered'?i.mastered:!i.mastered));
    return judgmentNav()+head('REVISIT & UNDERSTAND','错题与存疑','原作答、逐题核对和整章提交中的错误、不确定、未答及存疑题会归到这里。理解后可移出待复习，历史批改仍保留。')+
      `<div class="toolbar"><div class="filter-pills">${[['pending','待复习'],['mastered','已理解'],['all','全部记录']].map(([id,label])=>`<button data-review-filter="${id}" class="${state.reviewFilter===id?'active':''}">${label} ${items.filter(i=>id==='all'||(id==='mastered'?i.mastered:!i.mastered)).length}</button>`).join('')}</div><button class="button secondary small" data-expand>${expandAll?'恢复重点展开':'展开全部解析'}</button></div>${shown.length?shown.map(entry=>question(qMap.get(entry.id),{answer:latestAnswer(entry.id),submitted:true,forceOpen:true,reviewEntry:entry})).join(''):'<div class="empty"><h2>这里暂时没有题目</h2><p>继续练习，或到“全部记录”中查看已理解的题。</p></div>'}`;
  }
  function conditionLab(){return `<div class="condition-lab"><h3>动手看一次：同样的输入误差，会放大多少？</h3><p class="small">A＝diag(1, ε)，b＝(1,0)ᵀ，δb＝(0,δ)ᵀ。只改变右端的第二个分量，按二范数计算。</p><div class="lab-controls"><label>压缩系数 ε＝10<sup>−k</sup>，k＝<span id="epsilonLabel">2</span><input id="epsilonRange" type="range" min="0" max="6" value="2" step="1" aria-label="压缩系数的负十进制指数"></label><label>输入扰动 δ＝10<sup>−m</sup>，m＝<span id="deltaLabel">3</span><input id="deltaRange" type="range" min="1" max="8" value="3" step="1" aria-label="输入扰动的负十进制指数"></label></div><div class="mini-bars"><div><span>第一方向</span><i style="width:70%"></i></div><div><span>第二方向</span><i id="epsilonBar" style="width:.7%"></i></div></div><div class="lab-result"><div><small>条件数 κ₂</small><strong id="labKappa"></strong></div><div><small>相对输入误差</small><strong id="labInput"></strong></div><div><small>相对解误差</small><strong id="labOutput"></strong></div></div><p id="labSentence" class="small" style="margin:17px 0 0" aria-live="polite"></p></div>`;}
  function updateLab(){const e=document.querySelector('#epsilonRange'),d=document.querySelector('#deltaRange');if(!e||!d)return;const k=+e.value,m=+d.value,eps=10**-k,delta=10**-m;document.querySelector('#epsilonLabel').textContent=k;document.querySelector('#deltaLabel').textContent=m;document.querySelector('#labKappa').textContent=number(1/eps);document.querySelector('#labInput').textContent=delta.toExponential(1);document.querySelector('#labOutput').textContent=(delta/eps).toExponential(1);document.querySelector('#epsilonBar').style.width=70*eps+'%';document.querySelector('#labSentence').textContent=`原解为(1,0)，新解为(1,${number(delta/eps)})。沿这个最不利方向，误差恰好放大 ${number(1/eps)} 倍；若沿第一方向扰动，就不会出现这倍数。`;}
  function methodSwitcher(p,active){
    if(!p?.methodChoices?.length)return '';
    return `<div class="selector-heading"><strong>选择解法</strong><span>同题可切换，草稿共用</span></div><nav class="method-switcher" role="tablist" aria-label="同题解法">${p.methodChoices.map(method=>{
      const content=`<span class="method-priority">${escape(method.priority)}</span><strong>${escape(method.label)}</strong><small>${escape(method.detail)}</small><span class="selection-state">${method.id===active?'✓ 当前解法':'点击切换解法 ›'}</span>`;
      return `<button class="method-choice ${method.id===active?'current':''}" role="tab" aria-selected="${method.id===active}" tabindex="${method.id===active?'0':'-1'}" data-calc-method="${method.id}" data-method-case="${p.id}">${content}</button>`;
    }).join('')}</nav>`;
  }
  function solutionExtras(p){
    return (p.solutionExtras||[]).map(item=>`<details class="solution-extra"><summary>${html(item.title)}</summary><div class="solution-extra-body">${item.bodyHtml||stepBody(item.body||'')}</div></details>`).join('');
  }
  function basisPlan(p){
    return p.basisAdvice?'<aside class="basis-plan" aria-label="本题的正交化与单位化要求"><h3>这题何时正交化、单位化</h3>'+stepBody(p.basisAdvice)+'</aside>':'';
  }
  function basisStepNote(p,number){
    const note=p.stepNotes?.[number];
    return note?'<aside class="basis-step-note"><strong>'+html(note.title)+'</strong>'+stepBody(note.body)+'</aside>':'';
  }
  function topicCalculations(){
    const topics=D.calculationTopics||[],lookup=id=>topics.find(t=>t.cases.some(c=>c.calcId===id));
    const topic=lookup(calculationId)||topics[0],caseId=topic.cases.some(c=>c.calcId===calculationId)?calculationId:topic.cases[0].calcId;
    calculationId=caseId;
    const base=calcMap.get(caseId),selected=topic.cases.find(c=>c.calcId===caseId);
    let p=base;
    if(base.methodChoices?.length&&calcMethod!=='householder'){
      const guide=D.guides.find(g=>g.id===calcMethod),example=guide?.workedExample;
      if(example)p={...base,...example,id:base.id,methodChoices:base.methodChoices,sourceNote:base.sourceNote,solutionExtras:guide.solutionExtras||[],preflight:calcMethod==='qr-givens'?'<h3>Givens旋转</h3><p>从当前两行求参数，再将两整行一起更新。</p>':'<h3>施密特正交化</h3><p>先减投影得到正交残差，再单位化，最后按列读出R。</p>'};
    }
    const selector=`<div class="calculation-selector"><label for="calculationTopic"><span>选择题型</span><select id="calculationTopic" aria-label="选择计算题型">${D.calculationGroups.map(group=>`<optgroup label="${escape(group.title)}">${group.topicIds.map(id=>{const item=topics.find(t=>t.id===id);return `<option value="${id}" ${id===topic.id?'selected':''}>${escape(item.label)}</option>`;}).join('')}</optgroup>`).join('')}</select></label><p class="selection-description">${escape(topic.description)}</p></div>`;
    const caseTabs=`<div class="selector-heading"><strong>选择例题</strong><span>点击下方标签切换，共${topic.cases.length}道</span></div><nav class="case-tabs" role="tablist" aria-label="选择例题">${topic.cases.map(c=>`<button role="tab" id="case-tab-${c.calcId}" aria-controls="calculation-case-panel" aria-selected="${c.calcId===caseId}" tabindex="${c.calcId===caseId?'0':'-1'}" data-calc="${c.calcId}" class="case-tab ${c.calcId===caseId?'active':''}"><span class="case-option-top"><strong>${escape(c.label)}</strong><span class="choice-indicator" aria-hidden="true">${c.calcId===caseId?'✓':'›'}</span></span><span class="case-source">${escape(c.source)}</span><span class="selection-state">${c.calcId===caseId?'当前例题':'点击查看'}</span></button>`).join('')}</nav>`;
    const references=(D.pastPapers?.covered||[]).filter(row=>row.calcIds.includes(caseId)).map(row=>'<p class="small muted case-reference">同型参考：'+escape(row.evidence)+'。'+escape(row.note)+'</p>').join('');
    const sourceAudit=`<details class="source-audit"><summary>参考材料与年份说明</summary><div class="solution-extra-body"><p>参考题按题型归类，年份按来源文件名；回忆题缺失的数据及自拟演示在题内分别标明。</p>${(D.pastPapers?.sources||[]).map(source=>`<p><a href="${escape(source.url)}" target="_blank" rel="noopener">${source.year}.pdf</a>：${escape(source.kind)}</p>`).join('')}</div></details>`;
    const isRecall=topic.id===D.examRecall2026?.id;
    const recallOverview=isRecall?`<aside class="recall-overview" aria-label="考后回忆资料说明"><strong>考后回忆整理</strong><p>${escape(D.examRecall2026.sourceNote)}</p><details><summary>分值与资料完整程度</summary><p>${escape(D.examRecall2026.scoringNote)}</p></details></aside>`:'';
    return head('计算练习','计算题','选择题型，再选择例题；同一道题有多种算法时，可以切换解法。')+selector+`<section class="calculation-topic" id="calculation-topic-panel"><div class="section-heading"><h2>${escape(topic.title)}</h2><span class="small muted">${isRecall?'考后回忆':'分步解答与知识联系'}</span></div>${recallOverview}${caseTabs}<div id="calculation-case-panel" role="tabpanel" aria-labelledby="case-tab-${caseId}" tabindex="0"><h3 class="case-title">${escape(base.title)}</h3><p class="small muted case-caption">${escape(selected.source)}</p>${references}${calcNote(p)}</div></section>`+(isRecall?'':sourceAudit);
  }
  function selectCalculation(id,method='householder',kind='case'){
    if(!calcMap.has(id))return;
    const within=state.nav==='calculations',scroll=window.scrollY;
    calculationId=id;calcMethod=method;go('calculations');
    if(kind==='method'&&within)window.scrollTo(0,scroll);
    else if(within)document.querySelector('#calculation-case-panel')?.scrollIntoView({block:'start'});
  }
  function guideBody(g){
    const entries=[];
    const anchors=content=>content.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g,(_,level,attrs,title)=>{
      const id=`guide-${g.id}-section-${entries.length+1}`;
      entries.push({id,title});return `<h${level} id="${id}" class="guide-anchor">${title}</h${level}>`;
    });
    let body=anchors(g.body);
    if(g.workedExample){
      const p=g.workedExample;
      body+=anchors(`<h2>${escape(p.title)}</h2>`)+`<section class="calc-solution method-solution" aria-label="${escape(p.title)}"><p class="solution-intro">按本页方法逐步跟算；题目只求QR时，可在第${p.stopAt||16}步结束，后面为方程加问。</p>${basisPlan(p)}<nav class="solution-jumps" aria-label="本方法路线">${p.stepGroups.map(part=>`<a href="#calc-${p.id}-part-${part.start}">${escape(part.title)}</a>`).join('')}</nav>${solutionSteps(p)}<div class="takeaway"><strong>结果：</strong>${html(p.answer)}</div><aside class="pitfalls" aria-label="${p.id}易错点"><h3>本题易错点</h3><ul>${p.pitfalls.map(t=>`<li>${html(t)}</li>`).join('')}</ul></aside><section class="exam-checklist"><h3>遇到同类题，按这个顺序</h3><ol>${p.checklist.map(text=>`<li>${html(text)}</li>`).join('')}</ol></section></section>`;
    }
    body+=solutionExtras(g)+anchors(g.afterword||'');
    return (entries.length>1?`<nav class="guide-toc" aria-label="本页知识点"><strong>本页知识点</strong><div>${entries.map(item=>`<a href="#${item.id}">${item.title}</a>`).join('')}</div></nav>`:'')+body;
  }
  function guides(){
    const g=D.guides.find(g=>g.id===guideId);
    if(referenceQuestionId&&g){
      const q=qMap.get(referenceQuestionId);
      return head('QUESTION REFERENCE',`第${q.id}题 · 知识点查阅`,'查阅解析不会计入练习成绩。','<button class="button secondary small" data-back-guide>返回专题</button>')+question(q,{answer:q.prior,submitted:true,forceOpen:true});
    }
    if(!g)return head('CONCEPT NOTES','知识点讲解','把同类题放在一起理解：先把定义、定理条件和反例串起来，再回到逐题解析。',guideCalculationOrigin?'<button class="button secondary small" data-back-calculation>返回计算题</button>':guideOrigin?`<button class="button secondary small" data-back-question>返回第${guideOrigin.questionId}题</button>`:'<button class="button secondary small" data-nav="dashboard">返回总览</button>')+`<div class="banner"><strong>先把这条主线接起来：</strong><div class="source-links">${guideButtons(['orthogonal-similarity','eigen-basis','spectral','methods'])}</div></div><div class="guide-grid">${D.guides.map((g,i)=>`<button class="guide-tile" data-guide="${g.id}"><span class="overline">NOTE ${String(i+1).padStart(2,'0')}</span><h3>${g.title}</h3><p>${g.ids.length}道关联题 · ${g.sections.map(s=>'§'+s).join(' / ')}</p><span>阅读讲解 ${g.id==='condition'?'· 含交互数值实验':''} →</span></button>`).join('')}</div><div class="banner">统一记号：R(A)＝列空间；本书标准复内积对第一变量线性；换基时 P 的列为新基的旧坐标。具体题目仍需逐一检查数域、尺寸与非零条件。</div>`;
    const back=guideOrigin?`<button class="button secondary small" data-back-question>返回第${guideOrigin.questionId}题</button>`:'';
    const calculationBack=guideCalculationOrigin?'<button class="button secondary small" data-back-calculation>返回计算题</button>':g.relatedCalculationId?`<button class="button secondary small" data-calc="${g.relatedCalculationId}">返回课程主解：Householder QR</button>`:'';
    return head('CONCEPT NOTE',g.title,g.subtitle||'逐段理解后，再用反例检查自己是否真正掌握了条件。',back+calculationBack+'<button class="button secondary small" data-nav="dashboard">返回总览</button>'+'<button class="button secondary small" data-guides-home>所有专题</button>')+methodSwitcher(calcMap.get(g.relatedCalculationId),g.id)+`<article class="reading guide-reading">${guideBody(g)}${g.id==='condition'?conditionLab():''}<div class="source-links">${g.sections.map(sourceLink).join('')}${(g.theoremIds||[]).map(theoremLink).join('')}</div><div class="lesson-connections">${D.studyPlan.filter(p=>p.guideIds.includes(g.id)).map(p=>`<button class="text-button" data-calc="${p.calcId}">接着跟算：${escape(p.title)} →</button>`).join('')}</div><div class="banner small">关联题：${g.ids.map(id=>`<a href="#" data-open-question="${id}">${id}</a>`).join(' · ')}。点击题号进入已显示解析的知识点查阅，不计作一次练习提交。</div>${back?`<div class="guide-return">${back}</div>`:''}</article>`;
  }
  function stepBody(body){
    const paragraphs=[''];
    mathParts(body).forEach((part,i)=>{
      if(i%2){paragraphs[paragraphs.length-1]+=part;return;}
      const lines=part.split(/\n\s*\n/);paragraphs[paragraphs.length-1]+=lines[0];paragraphs.push(...lines.slice(1));
    });
    return paragraphs.map(part=>part.trim()).filter(Boolean).map(text=>{
      const subheading=/^####\s+([^\n]+)$/.exec(text);
      if(subheading)return '<h4 class="solution-subheading">'+html(subheading[1])+'</h4>';
      const rows=text.split('\n').map(row=>row.trim());
      if(rows.length>=3&&rows[0].startsWith('|')&&/^\|(?:\s*:?-+:?\s*\|)+$/.test(rows[1])&&rows.every(row=>row.startsWith('|')&&row.endsWith('|'))){
        const cells=row=>row.slice(1,-1).split('|').map(cell=>cell.trim());
        return '<div class="table-wrap solution-table"><table><thead><tr>'+cells(rows[0]).map(cell=>'<th scope="col">'+html(cell)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(2).map(row=>'<tr>'+cells(row).map(cell=>'<td>'+html(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
      }
      const kind=/^(易错|提醒|注意)[：:]/.test(text)?'mistake-note':/^(目的|关键)[：:]/.test(text)?'operation-note':'';
      return `<p${kind?` class="${kind}"`:''}>${html(text)}</p>`;
    }).join('');
  }
  function solutionSteps(p){
    return p.steps.map(([title,body],i)=>{
      const part=(p.stepGroups||[]).find(g=>g.start===i+1);
      return `${part?`<h2 class="solution-part" id="calc-${p.id}-part-${part.start}">${escape(part.title)}</h2>`:''}<div class="step"><header class="step-heading"><span class="step-number" aria-label="第${i+1}步">${String(i+1).padStart(2,'0')}</span><h3>${html(title)}</h3></header>${basisStepNote(p,i+1)}<div class="step-content">${stepBody(body)}</div></div>`;
    }).join('');
  }
  function calcNote(p,mode='training'){
    const store=mode==='exam'?state.exam.calc:state.calcNotes;
    if(!store[p.id])store[p.id]={text:'',score:null,reveal:false};
    const n=store[p.id],examHidden=mode==='exam'&&!state.exam.submittedAt;
    const reveal=n.reveal&&!examHidden,lesson=[...D.studyPlan,...D.followupPlan].find(x=>x.calcId===p.id);
    const related=lesson?.guideIds||p.guideIds||[];
    const methodNav=mode!=='exam'?methodSwitcher(p,calcMethod):'';
    const pastSource=p.pastPaper?`<aside class="past-source ${/缺失|自拟/.test(p.dataStatus)?'partial':''}"><strong>${escape(p.dataStatus)}</strong><p>${escape(p.sourceNote)}</p><a href="${escape(p.sourceUrl)}" target="_blank" rel="noopener">查看仓库原文件 →</a></aside>`:'';
    const recallSource=p.examRecall?`<aside class="recall-source" aria-label="本题回忆完整程度与分值"><strong>${escape(p.dataStatus)}</strong><p>${escape(p.scoreNote)}</p><p class="small">按计算环节学习与自查，不据此生成实际考试分数。</p></aside>`:'';
    const scoreInput=reveal&&!p.examRecall?`<label class="small">自评完成度 <input type="number" min="0" max="100" step="any" value="${n.score==null?'':number(n.score/SC.noteMax*100)}" data-score="${p.id}" data-mode="${mode}" aria-label="${p.id}自评完成度百分比"> %</label>`:'';
    const noteControls=examHidden?'<p class="small muted" style="margin-top:12px">提交整份模拟卷后，才能打开本题步骤解答。</p>':`<div class="button-row" style="margin-top:15px"><button class="button secondary small" data-reveal="${p.id}" data-mode="${mode}">${reveal?'收起分步解答':'查看完整分步解答'}</button>${scoreInput}</div>`;
    const recallReview=p.recallReviewHtml?`<section class="recall-review" aria-label="作答对照"><h2>作答对照 · 按记清的环节核对</h2>${p.recallReviewHtml}<p class="small muted">实际得分以原卷、你的完整作答及教师评分细则为准；这里不推算扣分。</p></section>`:'';
    return `<section class="${mode==='exam'?'panel panel-pad calc-exam-block':'reading'}" id="calc-${p.id}">
      <div class="q-meta"><span class="q-id">${p.id}</span><span>${p.group}</span><span class="tag ${p.priority==='课堂待确认'?'optional':''}">${p.priority}</span><span class="tag">${escape(p.sourceKind||'原创训练')}</span><span class="q-origin">${p.examRecall?'回忆卷 · 按小问整理':'计算训练 · 约'+p.minutes+'分钟'}</span></div>
      ${mode!=='exam'?`<div class="banner small"><strong>${p.purpose?'这题要解决什么：':'遇到这种题，先想：'}</strong>${html(p.purpose||p.recognition||'先独立分析，再对照步骤。')}</div>`:''}
      ${mode!=='exam'&&p.prerequisite?`<div class="prerequisite"><strong>${escape(p.prerequisite.title)}</strong><button class="text-button" data-calc="${p.prerequisite.calcId}">特征向量基、换坐标与矩阵幂 →</button></div>`:''}
      ${recallSource}<div class="calc-prompt">${html(p.prompt)}</div>
      ${p.pastPaper||p.examRecall?'':`<p class="small muted">${html(p.sourceNote||'依据所列书稿章节组织的训练题。')}</p>`}
      ${mode!=='exam'&&p.preflight?`<aside class="calc-preflight" aria-label="计算前的变换提示">${p.preflight}${guideButtons([p.preflightGuideId])}</aside>`:''}${methodNav}${pastSource}
      <label class="note-label" for="note-${mode}-${p.id}">${p.examRecall?'记录你记得的卷面步骤，打开解答后逐项对照':'先在纸上计算；这里可记录结果、步骤或卡住的位置'}</label>
      <textarea id="note-${mode}-${p.id}" data-note="${p.id}" data-mode="${mode}" placeholder="记录你的计算结果与思路（自动保存）">${escape(n.text)}</textarea>${noteControls}
      ${reveal?`<div class="calc-solution"><p class="solution-intro">${p.examRecall?'按小问展示应写的计算环节；原题缺失信息已在上方标明。':'按卷面结构跟算：关键推导与同类运算集中展示；额外验算可在下方展开。'}</p>
        ${basisPlan(p)}${p.stepGroups?`<nav class="solution-jumps" aria-label="本题路线">${p.stepGroups.map(part=>`<a href="#calc-${p.id}-part-${part.start}">${escape(part.title)}</a>`).join('')}</nav>`:''}
        ${solutionSteps(p)}<div class="takeaway"><strong>结果：</strong>${html(p.answer)}</div>${recallReview}
        <aside class="pitfalls" aria-label="${p.id}易错点"><h3>本题易错点</h3><ul>${p.pitfalls.map(t=>`<li>${html(t)}</li>`).join('')}</ul></aside>
        ${p.checklist?`<section class="exam-checklist"><h3>${p.examRecall?'同类题应写的得分步骤':'遇到同类题，按这个顺序'}</h3><ol>${p.checklist.map(text=>`<li>${html(text)}</li>`).join('')}</ol></section>`:''}
        ${p.summary?`<section class="lesson-summary"><h3>这题结束后，把知识连起来</h3>${p.summary}</section>`:''}${solutionExtras(p)}
        ${p.matrixNotes?`<section class="matrix-notes"><h2>矩阵论知识：这些操作是什么、能做什么</h2>${p.matrixNotes}</section>`:''}
        ${related.length?`<div class="lesson-connections"><h3>把这一题放回课本</h3>${guideButtons(related)}</div>`:''}<div class="source-links">${p.sections.map(sourceLink).join('')}</div>
        ${p.advancedSteps?`<details class="advanced-work"><summary>较后内容：合同与LDLᵀ，主练结束再看</summary>${p.advancedSteps.map(([title,body],i)=>`<div class="step"><h3>延伸${i+1}　${escape(title)}</h3><div>${html(body)}</div></div>`).join('')}</details>`:''}</div>`:''}</section>`;
  }
  function lessonNav(lesson){
    const follow=D.followupPlan.includes(lesson),plan=follow?D.followupPlan:D.studyPlan,index=plan.indexOf(lesson),prev=plan[index-1],next=plan[index+1];
    return `<div class="lesson-nav"><span class="small muted">${follow?'补读':'主练'} ${lesson.order} / ${plan.length}${lesson.tier?' · '+escape(lesson.tier):''}</span><div class="button-row">${prev?`<button class="button secondary small" data-calc="${prev.calcId}">← 上一题</button>`:''}${next?`<button class="button secondary small" data-calc="${next.calcId}">下一题：${escape(next.title)} →</button>`:`<button class="button secondary small" data-calc-mode="${follow?'core':'followup'}">${follow?'回到六类必做':'主练结束，查看基础与工具'} →</button>`}</div></div>`;
  }
  function calculations(){return topicCalculations();}
  function activeSession(context){return context==='chapter'?getSession():null;}
  function updateProgress(context){const session=activeSession(context);if(!session)return;const count=session.ids.filter(id=>C.validAnswer(session.answers[id])).length;const checked=document.querySelector('#checkedCount');if(checked)checked.textContent=`已核对 ${Object.keys(session.checkedAt||{}).length} 题`;const total=document.querySelector('#answerCount');if(total)total.textContent=`${count} / ${session.ids.length}`;const bar=document.querySelector('#answerProgress');if(bar)bar.style.width=count/session.ids.length*100+'%';}
  async function submit(context){
    const s=activeSession(context);if(!s||s.submittedAt)return;
    const unanswered=s.ids.filter(id=>!C.validAnswer(s.answers[id])).length;
    if(unanswered&&!await confirmAction('还有未作答的判断题',`还有${unanswered}题未作答。继续提交后，未答题单列统计并加入待复习；你可以先返回检查。`))return;
    s.submittedAt=new Date().toISOString();
    const revisit=s.ids.filter(id=>C.verdict(qMap.get(id),s.answers[id])!=='correct'||s.flags.includes(id));
    state.mastered=state.mastered.filter(id=>!revisit.includes(id));save();render();window.scrollTo(0,0);toast('已批改。错题与存疑题的解析已展开。');
  }
  document.querySelector('#nav').addEventListener('click',e=>{const el=e.target.closest('[data-nav]');if(el){if(el.dataset.nav==='guides'){guideId=null;guideOrigin=null;referenceQuestionId=null;}go(el.dataset.nav);}});
  main.addEventListener('click',async e=>{
    const b=e.target.closest('button,a[data-open-question],summary[data-q-reveal]');if(!b)return;
    if(b.dataset.nav){go(b.dataset.nav);return;}
    if(b.hasAttribute('data-continue')){state.chapter=4;state.pool='original';go('practice');return;}
    if(b.dataset.chapter){state.chapter=+b.dataset.chapter;const qs=D.questions.filter(q=>q.chapter===state.chapter);if(state.pool==='original'&&!qs.some(q=>q.origin==='原题'))state.pool='all';go('practice');return;}
    if(b.dataset.guide){
      referenceQuestionId=null;
      const card=b.closest('.question');
      if(state.nav!=='guides'){
        guideCalculationOrigin=state.nav==='calculations'?{id:calculationId,method:calcMethod}:null;
        guideOrigin=card?{nav:state.nav,chapter:state.chapter,pool:state.pool,historyChapter:state.historyChapter,questionId:+card.id.replace('q-','')}:null;
      }
      guideId=b.dataset.guide;go('guides');return;
    }
    if(b.hasAttribute('data-back-question')&&guideOrigin){
      const origin=guideOrigin;state.chapter=origin.chapter;state.pool=origin.pool;state.historyChapter=origin.historyChapter;go(origin.nav);
      document.querySelector('#q-'+origin.questionId)?.scrollIntoView({block:'start'});return;
    }
    if(b.dataset.qReveal){
      e.preventDefault();if(state.nav!=='practice')return;
      const id=+b.dataset.qReveal,s=getSession();if(s.submittedAt||!s.ids.includes(id))return;
      if(s.checkedAt[id])s.collapsed=s.collapsed.includes(id)?s.collapsed.filter(x=>x!==id):[...s.collapsed,id];
      else{s.checkedAt[id]=new Date().toISOString();if(C.verdict(qMap.get(id),s.answers[id])!=='correct'||s.flags.includes(id))state.mastered=state.mastered.filter(x=>x!==id);}
      save();refreshQuestion(id);renderNav();updateProgress('chapter');return;
    }
    if(b.dataset.qRetry){
      if(state.nav!=='practice')return;const id=+b.dataset.qRetry,s=getSession();if(s.submittedAt||!s.ids.includes(id))return;
      delete s.checkedAt[id];delete s.answers[id];s.collapsed=s.collapsed.filter(x=>x!==id);
      save();refreshQuestion(id);renderNav();updateProgress('chapter');return;
    }
    if(b.hasAttribute('data-back-calculation')&&guideCalculationOrigin){const origin=guideCalculationOrigin;selectCalculation(origin.id,origin.method);return;}
    if(b.hasAttribute('data-guides-home')){if(state.nav!=='guides'){guideOrigin=null;guideCalculationOrigin=null;}guideId=null;referenceQuestionId=null;go('guides');return;}
    if(b.dataset.openQuestion){e.preventDefault();if(qMap.has(+b.dataset.openQuestion)){referenceQuestionId=+b.dataset.openQuestion;go('guides');}return;}
    if(b.hasAttribute('data-back-guide')){referenceQuestionId=null;go('guides');return;}
    if(b.dataset.submit){await submit(b.dataset.submit);return;}
    if(b.hasAttribute('data-retry')){if(await confirmAction('重新练习此题组','这将清空当前题组的本轮作答；历史批改保留。需要时可先导出进度备份。')){delete state.sessions[sessionKey()];save();render();window.scrollTo(0,0);}return;}
    if(b.dataset.flag){const id=+b.dataset.flag,s=activeSession(b.dataset.context);if(!s)return;const had=s.flags.includes(id);s.flags=had?s.flags.filter(x=>x!==id):[...s.flags,id];state.manualFlags=had?state.manualFlags.filter(x=>x!==id):[...new Set([...state.manualFlags,id])];if(!had)state.mastered=state.mastered.filter(x=>x!==id);b.classList.toggle('flagged',!had);b.setAttribute('aria-pressed',String(!had));b.textContent=had?'☆ 这题仍存疑':'★ 已标记存疑';save();renderNav();return;}
    if(b.hasAttribute('data-expand')){expandAll=!expandAll;document.querySelectorAll('details.explanation').forEach(el=>{const card=el.closest('.question'),id=+card.id.replace('q-','');const s=state.nav==='practice'?getSession():state.nav==='exam'?state.exam:null;const answer=s?s.answers[id]:state.nav==='history'?qMap.get(id).prior:latestAnswer(id);el.open=expandAll||C.verdict(qMap.get(id),answer)!=='correct'||!!s?.flags.includes(id)||state.nav==='review';});b.textContent=expandAll?'恢复重点展开':'展开全部解析';return;}
    if(b.dataset.historyCh){state.historyChapter=+b.dataset.historyCh;expandAll=false;save();render();return;}
    if(b.dataset.reviewFilter){state.reviewFilter=b.dataset.reviewFilter;save();render();return;}
    if(b.dataset.mastered){const id=+b.dataset.mastered,had=state.mastered.includes(id);state.mastered=had?state.mastered.filter(x=>x!==id):[...state.mastered,id];save();render();toast(had?'已重新列入待复习':'已记录为理解。历史批改仍保留。');return;}
    if(b.dataset.calcMethod){selectCalculation(b.dataset.methodCase||'C53',b.dataset.calcMethod,'method');return;}
    if(b.dataset.calc){selectCalculation(b.dataset.calc);return;}
    if(b.hasAttribute('data-calcs-home')){calculationId='C49';calcMode='core';calcMethod='householder';go('calculations');return;}
    if(b.dataset.calcMode){calcMode=b.dataset.calcMode;calculationId=b.dataset.calcMode==='past'?'P25-LU':b.dataset.calcMode==='followup'?'C54':'C49';calcMethod='householder';go('calculations');return;}
    if(b.dataset.reveal){const id=b.dataset.reveal,mode=b.dataset.mode;if(mode==='exam'&&!state.exam?.submittedAt)return;const store=mode==='exam'?state.exam.calc:state.calcNotes;if(!store[id])store[id]=safeCalc();store[id].reveal=!store[id].reveal;save();const scroll=window.scrollY;render();window.scrollTo(0,scroll);return;}
  });
  main.addEventListener('keydown',e=>{
    const tab=e.target.closest('[role="tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    const list=tab.closest('[role="tablist"]'),tabs=[...list.querySelectorAll('[role="tab"]')];
    const index=tabs.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    const data=tabs[next].dataset,selector=data.calcTopic?'[data-calc-topic="'+data.calcTopic+'"]':data.calcMethod?'[data-calc-method="'+data.calcMethod+'"]':'[data-calc="'+data.calc+'"]';
    e.preventDefault();tabs[next].click();main.querySelector(selector)?.focus();
  });
  main.addEventListener('click',e=>{
    const a=e.target.closest('a[href^="#"]');if(!a||a.dataset.openQuestion)return;
    const id=a.getAttribute('href').slice(1),target=document.getElementById(id);if(!target)return;
    e.preventDefault();target.scrollIntoView({block:'start'});
  });
  main.addEventListener('toggle',e=>{
    if(e.target.matches('details.explanation')){const summary=e.target.querySelector('summary');if(summary&&!summary.dataset.qReveal)summary.textContent=e.target.open?'收起答案与解析':'查看答案与解析';}
  },true);
  main.addEventListener('change',e=>{
    if(e.target.id==='calculationTopic'){const topic=D.calculationTopics.find(item=>item.id===e.target.value);if(topic)selectCalculation(topic.cases[0].calcId);return;}
    const el=e.target;
    if(el.dataset.answer){const id=+el.dataset.answer,s=activeSession(el.dataset.context);if(!s||s.submittedAt||s.checkedAt?.[id]||!s.ids.includes(id)||!C.validAnswer(el.value))return;s.answers[id]=el.value;el.closest('.choices').querySelectorAll('.choice').forEach(label=>label.classList.toggle('selected',label.querySelector('input').checked));save();updateProgress(el.dataset.context);return;}
    if(el.id==='pool'){state.pool=el.value;save();render();return;}
    if(el.id==='historyFilter'){historyFilter=el.value;render();return;}
  });
  main.addEventListener('input',e=>{
    const el=e.target;
    if(el.id==='epsilonRange'||el.id==='deltaRange'){updateLab();return;}
    if(el.dataset.note||el.dataset.score){const id=el.dataset.note||el.dataset.score,mode=el.dataset.mode;if(!calcMap.has(id))return;const store=mode==='exam'?state.exam.calc:state.calcNotes;if(!store[id])store[id]=safeCalc();if(el.dataset.note)store[id].text=el.value.slice(0,30000);else{const value=el.value===''?null:Number(el.value),bounded=value===null||!Number.isFinite(value)?null:Math.min(100,Math.max(0,value));store[id].score=bounded===null?null:bounded/100*SC.noteMax;if(bounded!==null&&bounded!==value)el.value=bounded;const box=document.querySelector('#examScore');if(mode==='exam'&&box)box.outerHTML=examScore();}save();}
  });
  document.querySelector('#export').addEventListener('click',()=>{
    const payload={app:'ucas-matrix-review',exportedAt:new Date().toISOString(),bankVersion:D.version,state};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='矩阵分析复习进度.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('进度备份已导出。题库本身保存在本地文件夹中。');
  });
  document.querySelector('#import').addEventListener('click',()=>document.querySelector('#importFile').click());
  document.querySelector('#importFile').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>8e6)throw new Error('备份文件过大');const payload=JSON.parse(await file.text());if(payload.app!=='ucas-matrix-review')throw new Error('这不是本练习室的进度备份');const next=sanitize(payload.state);if(!await confirmAction('导入进度备份','这会用备份中的练习记录替换当前浏览器进度。题库和原始历史答案不会改变。'))return;state=next;guideId=null;calculationId=null;save();render();toast('已导入进度备份。');}catch(err){toast('导入失败：'+err.message);}finally{e.target.value='';}
  });
  const themeControl=document.querySelector('#themeToggle');
  themeControl.checked=document.documentElement.dataset.theme==='dark';
  themeControl.addEventListener('change',()=>{const theme=themeControl.checked?'dark':'light';document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#111714':'#f5f7f8';try{localStorage.setItem('matrix-review.theme',theme);}catch(e){toast('外观已切换，当前浏览器暂时无法保存外观设置。');}});
  applyRoute(hashView());rememberRoute(true);render();save();
})();
