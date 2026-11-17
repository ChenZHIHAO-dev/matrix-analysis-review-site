/* Pure grading and selection logic, shared with the offline checks. */
(function(root){
  'use strict';
  const validAnswer = a => a==='T'||a==='F'||a==='U';
  function verdict(q,answer){
    if(!validAnswer(answer)) return 'unanswered';
    if(answer==='U') return 'unsure';
    return (answer==='T')===q.answer ? 'correct' : 'wrong';
  }
  function grade(questions,answers={}){
    const result={correct:0,wrong:0,unsure:0,unanswered:0,total:questions.length,records:[]};
    for(const q of questions){const state=verdict(q,answers[q.id]);result[state]++;result.records.push({id:q.id,state});}
    result.rate=result.total?result.correct/result.total:0;
    result.knownRate=result.correct+result.wrong?result.correct/(result.correct+result.wrong):null;
    return result;
  }
  function shuffled(items,rng=Math.random){
    const a=[...items];
    for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
    return a;
  }
  function sampleExam(questions,includeOptional=false,rng=Math.random){
    const quotas=[2,2,2,2,2,3,3,4];
    const seen=new Set();
    const candidates=shuffled(questions.filter(q=>includeOptional||q.scope!=='课堂待确认'),rng).filter(q=>{
      if(!q.duplicateGroup) return true;
      if(seen.has(q.duplicateGroup)) return false;
      seen.add(q.duplicateGroup);return true;
    });
    const picked=[];
    quotas.forEach((n,i)=>picked.push(...candidates.filter(q=>q.chapter===i+1).slice(0,n)));
    if(picked.length!==20) throw new Error('题库不足以按章抽取20题');
    return shuffled(picked,rng).map(q=>q.id);
  }
  function reviewItems(questions,state){
    const map=new Map();
    function add(q,reason){if(!map.has(q.id))map.set(q.id,{id:q.id,reasons:new Set()});map.get(q.id).reasons.add(reason);}
    for(const q of questions){if(q.prior&&verdict(q,q.prior)!=='correct')add(q,q.prior==='U'?'原作答不确定':'原作答错误');}
    const byId=new Map(questions.map(q=>[q.id,q]));
    for(const session of [...Object.values(state.sessions||{}),...(state.exam?[state.exam]:[])]){
      const checked=session.ids.filter(id=>session.submittedAt||session.checkedAt?.[id]);
      for(const id of checked){const q=byId.get(id);if(!q)continue;const v=verdict(q,session.answers[id]);if(v!=='correct')add(q,{wrong:'练习错误',unsure:'练习不确定',unanswered:session.submittedAt?'提交时未答':'查看解析前未答'}[v]);if(session.flags?.includes(id))add(q,'作答时存疑');}
    }
    // Only individually checked items or a submitted sheet enter the queue.
    // Merely selecting or flagging an unchecked draft item does not grade it.
    for(const id of state.manualFlags||[]){const q=byId.get(id);if(q&&map.has(id))add(q,'主动标记存疑');}
    return [...map.values()].map(x=>({...x,reasons:[...x.reasons],mastered:(state.mastered||[]).includes(x.id)})).sort((a,b)=>a.id-b.id);
  }
  function scoreExam(correct,calcScores,config={}){
    const cfg={judgmentCount:20,judgmentTotal:30,calculationCount:4,calculationTotal:70,noteMax:15,...config};
    const scores=calcScores.slice(0,cfg.calculationCount),done=scores.filter(Number.isFinite).length;
    const sum=scores.reduce((total,x)=>total+(Number.isFinite(x)?Math.max(0,Math.min(cfg.noteMax,x)):0),0);
    const judgmentScore=correct/cfg.judgmentCount*cfg.judgmentTotal;
    const calculationScore=sum/(cfg.noteMax*cfg.calculationCount)*cfg.calculationTotal;
    return {judgmentScore,calculationScore,done,total:done===cfg.calculationCount?judgmentScore+calculationScore:null};
  }
  const api={validAnswer,verdict,grade,shuffled,sampleExam,reviewItems,scoreExam};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.ReviewCore=api;
})(typeof window!=='undefined'?window:globalThis);
