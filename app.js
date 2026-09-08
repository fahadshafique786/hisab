const STORAGE_KEY = 'hisab_v1_state';
const APP_VERSION = '1.0.0';
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const clone = obj => JSON.parse(JSON.stringify(obj));
const isoToday = () => new Date().toISOString().slice(0,10);
const thisMonth = () => new Date().toISOString().slice(0,7);
const fmt = n => `PKR ${Math.round(Number(n || 0)).toLocaleString('en-PK')}`;
const number = v => Number(v || 0);
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const prettyDate = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}) : 'No due date';
const prettyMonth = m => m ? new Date(`${m}-01T12:00:00`).toLocaleDateString('en-PK',{month:'long',year:'numeric'}) : 'Month';

function blankState(){
  return {
    meta:{version:APP_VERSION,createdAt:new Date().toISOString(),activeMonth:thisMonth(),onboarded:false},
    settings:{currency:'PKR',salary:0,sadqaPercent:2.5},
    accounts:[{id:'cash',name:'Cash',type:'cash',balance:0}],
    transactions:[],plans:[],goals:[],cards:[],loans:[],committees:[],investments:[],recurring:[],snapshots:[]
  };
}

function normalizeState(s){
  const b=blankState();
  const out={...b,...s};
  out.meta={...b.meta,...(s.meta||{}),version:APP_VERSION};
  out.settings={...b.settings,...(s.settings||{})};
  for(const k of ['accounts','transactions','plans','goals','cards','loans','committees','investments','recurring','snapshots']) out[k]=Array.isArray(s[k])?s[k]:[];
  if(!out.accounts.length) out.accounts=[{id:'cash',name:'Cash',type:'cash',balance:0}];
  return out;
}

function load(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    return raw?normalizeState(JSON.parse(raw)):blankState();
  }catch{return blankState()}
}
let state=load();

function save(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  render();
}

function totalBalance(){return state.accounts.reduce((s,a)=>s+number(a.balance),0)}
function investmentValue(){return state.investments.reduce((s,i)=>s+number(i.value),0)}
function loanLiability(){return state.loans.reduce((s,l)=>s+number(l.installment)*number(l.remainingCount),0)}
function cardLiability(){return state.cards.reduce((s,c)=>s+number(c.currentBill),0)}
function netWorth(){return totalBalance()+investmentValue()-loanLiability()-cardLiability()}
function plansFor(month=state.meta.activeMonth){return state.plans.filter(p=>p.budgetMonth===month)}
function pendingPlans(month=state.meta.activeMonth){return plansFor(month).filter(p=>p.status!=='completed')}
function pendingSum(direction,month=state.meta.activeMonth){return pendingPlans(month).filter(p=>p.direction===direction).reduce((s,p)=>s+number(p.amount),0)}
function reservedOut(month=state.meta.activeMonth){return pendingPlans(month).filter(p=>p.direction==='out'&&p.essential).reduce((s,p)=>s+number(p.amount),0)}
function afterPlan(month=state.meta.activeMonth){return totalBalance()+pendingSum('in',month)-pendingSum('out',month)}
function accountById(id){return state.accounts.find(a=>a.id===id)}
function planById(id){return state.plans.find(p=>p.id===id)}

function setView(name){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`${name}View`));
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});
}

function empty(msg){return `<div class="empty">${esc(msg)}</div>`}
function statusPill(p){
  if(p.status==='completed') return '<span class="pill good">Completed</span>';
  if(p.essential) return '<span class="pill warn">Reserved</span>';
  return '<span class="pill">Planned</span>';
}
function planCard(p,withActions=true){
  const cls=p.direction==='in'?'amount-in':'amount-out';
  const sign=p.direction==='in'?'+':'−';
  return `<article class="item-card">
    <div class="item-top">
      <div><div class="item-title">${esc(p.title)}</div><div class="item-sub">${prettyDate(p.dueDate)}${p.note?` • ${esc(p.note)}`:''}</div><div class="badge-row">${statusPill(p)}</div></div>
      <div class="item-amount ${cls}">${sign}${fmt(p.status==='completed'&&p.actualAmount!=null?p.actualAmount:p.amount)}</div>
    </div>
    ${withActions?`<div class="item-actions">
      ${p.status!=='completed'?`<button class="tiny-btn primary" data-plan-complete="${p.id}">${p.direction==='in'?'Receive':'Pay'}</button><button class="tiny-btn" data-plan-edit="${p.id}">Edit</button><button class="tiny-btn danger" data-plan-delete="${p.id}">Delete</button>`:`<span class="subtle">Completed ${p.completedDate?prettyDate(p.completedDate):''}</span>`}
    </div>`:''}
  </article>`;
}
function txnCard(t){
  const cls=t.type==='income'?'amount-in':t.type==='expense'?'amount-out':'amount-neutral';
  const sign=t.type==='income'?'+':t.type==='expense'?'−':'';
  const account=accountById(t.accountId);
  return `<article class="item-card">
    <div class="item-top">
      <div><div class="item-title">${esc(t.category||'Transaction')}</div><div class="item-sub">${prettyDate(t.date)} • ${esc(account?.name||'Account')}${t.note?` • ${esc(t.note)}`:''}</div></div>
      <div class="item-amount ${cls}">${sign}${fmt(Math.abs(number(t.amount)))}</div>
    </div>
    <div class="item-actions"><button class="tiny-btn danger" data-txn-delete="${t.id}">Delete</button></div>
  </article>`;
}
function goalCard(g,actions=true){
  const target=Math.max(1,number(g.target)), saved=Math.max(0,number(g.saved));
  const pct=Math.min(100,(saved/target)*100);
  return `<article class="goal-card">
    <div class="goal-row"><div><div class="item-title">${esc(g.name)}</div><small>${g.targetDate?`Target ${prettyDate(g.targetDate)}`:'No target date'}</small></div><b>${fmt(saved)} / ${fmt(target)}</b></div>
    <div class="progress"><span style="width:${pct.toFixed(1)}%"></span></div>
    <div class="subtle">${pct.toFixed(0)}% complete${g.note?` • ${esc(g.note)}`:''}</div>
    ${actions?`<div class="item-actions"><button class="tiny-btn" data-goal-edit="${g.id}">Edit</button><button class="tiny-btn danger" data-goal-delete="${g.id}">Delete</button></div>`:''}
  </article>`;
}

function renderDashboard(){
  $('#currentBalance').textContent=fmt(totalBalance());
  $('#reservedAmount').textContent=fmt(reservedOut());
  $('#expectedIn').textContent=fmt(pendingSum('in'));
  const ap=afterPlan(); $('#afterPlan').textContent=fmt(ap); $('#afterPlan').classList.toggle('negative',ap<0); $('#afterPlan').classList.toggle('positive',ap>=0);
  $('#netWorth').textContent=fmt(loanLiability()+cardLiability());
  $('#dashboardMonthTitle').textContent=prettyMonth(state.meta.activeMonth);
  const health=ap>=0?`Plan leaves ${fmt(ap)} after all planned items.`:`Plan has a funding gap of ${fmt(Math.abs(ap))}.`;
  $('#planHealth').textContent=health;
  const upcoming=pendingPlans().sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,6);
  $('#upcomingList').innerHTML=upcoming.length?upcoming.map(p=>planCard(p,false)).join(''):empty('No pending items in this month.');
  $('#goalCards').innerHTML=state.goals.length?state.goals.slice(0,2).map(g=>goalCard(g,false)).join(''):empty('No goals yet.');
}

function renderTransactions(){
  const filter=$('#txnFilter').value||'all';
  let tx=[...state.transactions].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));
  if(filter!=='all') tx=tx.filter(t=>t.type===filter);
  $('#transactionsList').innerHTML=tx.length?tx.map(txnCard).join(''):empty('No transactions yet. Add your first income or expense.');
}

function renderPlan(){
  const month=$('#planMonth').value||state.meta.activeMonth;
  const items=plansFor(month).sort((a,b)=>((a.status==='completed')-(b.status==='completed'))||(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  $('#pendingOut').textContent=fmt(pendingSum('out',month));
  $('#pendingIn').textContent=fmt(pendingSum('in',month));
  $('#plansList').innerHTML=items.length?items.map(p=>planCard(p,true)).join(''):empty('No planned items for this month.');
}

function renderGoals(){
  $('#goalsList').innerHTML=state.goals.length?state.goals.map(g=>goalCard(g,true)).join(''):empty('No goals yet.');
}

function renderMore(){
  $('#accountsList').innerHTML=state.accounts.length?state.accounts.map(a=>`<article class="item-card"><div class="item-top"><div><div class="item-title">${esc(a.name)}</div><div class="item-sub">${esc(a.type||'account')}</div></div><div class="item-amount">${fmt(a.balance)}</div></div><div class="item-actions"><button class="tiny-btn" data-account-edit="${a.id}">Edit / Reconcile</button>${state.accounts.length>1?`<button class="tiny-btn danger" data-account-delete="${a.id}">Delete</button>`:''}</div></article>`).join(''):empty('No accounts.');
  $('#cardsList').innerHTML=state.cards.length?state.cards.map(c=>`<article class="item-card"><div class="item-top"><div><div class="item-title">${esc(c.name)}</div><div class="item-sub">Statement day ${esc(c.statementDay||'—')} • Due day ${esc(c.dueDay||'—')}${c.note?` • ${esc(c.note)}`:''}</div></div><div class="item-amount amount-out">${fmt(c.currentBill)}</div></div><div class="badge-row">${number(c.minimumDue)?`<span class="pill">Min ${fmt(c.minimumDue)}</span>`:''}${number(c.emi)?`<span class="pill">EMI ${fmt(c.emi)}</span>`:''}</div><div class="item-actions"><button class="tiny-btn" data-card-edit="${c.id}">Edit</button><button class="tiny-btn danger" data-card-delete="${c.id}">Delete</button></div></article>`).join(''):empty('No credit cards tracked.');
  $('#loansList').innerHTML=state.loans.length?state.loans.map(l=>`<article class="item-card"><div class="item-top"><div><div class="item-title">${esc(l.name)}</div><div class="item-sub">Next ${prettyDate(l.nextDue)}${l.note?` • ${esc(l.note)}`:''}</div></div><div class="item-amount amount-out">${fmt(number(l.installment)*number(l.remainingCount))}</div></div><div class="badge-row"><span class="pill">${number(l.remainingCount)} installments</span><span class="pill">${fmt(l.installment)} each</span></div><div class="item-actions"><button class="tiny-btn" data-loan-edit="${l.id}">Edit</button><button class="tiny-btn danger" data-loan-delete="${l.id}">Delete</button></div></article>`).join(''):empty('No loans or debts tracked.');
  $('#committeesList').innerHTML=state.committees.length?state.committees.map(c=>`<article class="item-card"><div class="item-top"><div><div class="item-title">${esc(c.name)}</div><div class="item-sub">${esc(c.ends||'End date not set')}${c.note?` • ${esc(c.note)}`:''}</div></div><div class="item-amount">${fmt(c.monthly)}/mo</div></div>${number(c.payout)?`<div class="badge-row"><span class="pill good">Payout ${fmt(c.payout)}</span></div>`:''}<div class="item-actions"><button class="tiny-btn" data-committee-edit="${c.id}">Edit</button><button class="tiny-btn danger" data-committee-delete="${c.id}">Delete</button></div></article>`).join(''):empty('No committees tracked.');
  $('#investmentsList').innerHTML=state.investments.length?state.investments.map(i=>`<article class="item-card"><div class="item-top"><div><div class="item-title">${esc(i.name)}</div><div class="item-sub">${esc(i.category||'Investment')}${i.note?` • ${esc(i.note)}`:''}</div></div><div class="item-amount amount-in">${fmt(i.value)}</div></div><div class="badge-row">${i.shariah?'<span class="pill good">Provider-marked Shariah-compliant</span>':''}</div><div class="item-actions"><button class="tiny-btn" data-investment-edit="${i.id}">Edit</button><button class="tiny-btn danger" data-investment-delete="${i.id}">Delete</button></div></article>`).join(''):empty('No investments tracked yet.');
  $('#recurringList').innerHTML=state.recurring.length?state.recurring.map(r=>`<article class="item-card"><div class="item-top"><div><div class="item-title">${esc(r.title)}</div><div class="item-sub">Day ${r.dueDay} • ${esc(r.startMonth||'')}${r.endMonth?` to ${esc(r.endMonth)}`:' onward'}${r.note?` • ${esc(r.note)}`:''}</div></div><div class="item-amount ${r.direction==='in'?'amount-in':'amount-out'}">${r.direction==='in'?'+':'−'}${fmt(r.amount)}</div></div><div class="item-actions"><button class="tiny-btn" data-recurring-edit="${r.id}">Edit</button><button class="tiny-btn danger" data-recurring-delete="${r.id}">Delete</button></div></article>`).join(''):empty('No recurring rules.');
  $('#settingsForm').elements.salary.value=state.settings.salary||0;
  $('#settingsForm').elements.sadqaPercent.value=state.settings.sadqaPercent??2.5;
}

function render(){
  renderDashboard();renderTransactions();renderPlan();renderGoals();renderMore();
  refreshAccountSelects();
}

function refreshAccountSelects(){
  const opts=state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} — ${fmt(a.balance)}</option>`).join('');
  $$('select[name="accountId"]').forEach(s=>{const old=s.value;s.innerHTML=opts;if(state.accounts.some(a=>a.id===old))s.value=old;});
}

function openTxn(type='expense'){
  const f=$('#txnForm');f.reset();f.elements.id.value='';f.elements.type.value=type;f.elements.date.value=isoToday();refreshAccountSelects();$('#txnDialog').showModal();
}
function openPlan(idValue=''){
  const f=$('#planForm');f.reset();f.elements.id.value='';f.elements.budgetMonth.value=$('#planMonth').value||state.meta.activeMonth;$('#planDialogTitle').textContent='Add Planned Item';
  if(idValue){const p=planById(idValue);if(!p)return;$('#planDialogTitle').textContent='Edit Planned Item';for(const k of ['id','direction','title','amount','budgetMonth','dueDate','note']) if(f.elements[k]) f.elements[k].value=p[k]??'';f.elements.essential.checked=!!p.essential;}
  $('#planDialog').showModal();
}
function openCompletePlan(idValue){
  const p=planById(idValue);if(!p)return;const f=$('#completePlanForm');f.reset();f.elements.planId.value=p.id;f.elements.amount.value=p.amount;f.elements.date.value=isoToday();$('#completePlanSummary').innerHTML=`<strong>${esc(p.title)}</strong><br><span class="subtle">Planned ${fmt(p.amount)} • ${p.direction==='in'?'Money in':'Money out'}</span>`;refreshAccountSelects();$('#completePlanDialog').showModal();
}
function openGoal(idValue=''){const f=$('#goalForm');f.reset();f.elements.id.value='';$('#goalDialogTitle').textContent=idValue?'Edit Goal':'Add Goal';if(idValue){const g=state.goals.find(x=>x.id===idValue);for(const k of ['id','name','target','saved','targetDate','note'])f.elements[k].value=g?.[k]??'';}$('#goalDialog').showModal();}
function openAccount(idValue=''){const f=$('#accountForm');f.reset();f.elements.id.value='';$('#accountDialogTitle').textContent=idValue?'Edit / Reconcile Account':'Add Account';if(idValue){const a=accountById(idValue);for(const k of ['id','name','type','balance'])f.elements[k].value=a?.[k]??'';}$('#accountDialog').showModal();}
function openCard(idValue=''){const f=$('#cardForm');f.reset();f.elements.id.value='';if(idValue){const c=state.cards.find(x=>x.id===idValue);for(const k of ['id','name','currentBill','minimumDue','emi','statementDay','dueDay','note'])f.elements[k].value=c?.[k]??'';}$('#cardDialog').showModal();}
function openLoan(idValue=''){const f=$('#loanForm');f.reset();f.elements.id.value='';if(idValue){const l=state.loans.find(x=>x.id===idValue);for(const k of ['id','name','installment','remainingCount','nextDue','note'])f.elements[k].value=l?.[k]??'';}$('#loanDialog').showModal();}
function openCommittee(idValue=''){const f=$('#committeeForm');f.reset();f.elements.id.value='';if(idValue){const c=state.committees.find(x=>x.id===idValue);for(const k of ['id','name','monthly','ends','payout','note'])f.elements[k].value=c?.[k]??'';}$('#committeeDialog').showModal();}
function openInvestment(idValue=''){const f=$('#investmentForm');f.reset();f.elements.id.value='';if(idValue){const i=state.investments.find(x=>x.id===idValue);for(const k of ['id','name','value','category','note'])f.elements[k].value=i?.[k]??'';f.elements.shariah.checked=!!i?.shariah;}$('#investmentDialog').showModal();}
function openRecurring(idValue=''){const f=$('#recurringForm');f.reset();f.elements.id.value='';f.elements.startMonth.value=state.meta.activeMonth;if(idValue){const r=state.recurring.find(x=>x.id===idValue);for(const k of ['id','direction','title','amount','dueDay','startMonth','endMonth','note'])f.elements[k].value=r?.[k]??'';f.elements.essential.checked=!!r?.essential;}$('#recurringDialog').showModal();}

function applyTxnToAccount(t,multiplier=1){
  const a=accountById(t.accountId);if(!a)return;
  const amount=number(t.amount)*multiplier;
  if(t.type==='income')a.balance=number(a.balance)+amount;
  else if(t.type==='expense')a.balance=number(a.balance)-amount;
  else if(t.type==='adjustment')a.balance=number(a.balance)+amount;
}

function exportBlob(filename,content,type='application/json'){
  const blob=new Blob([content],{type});const file=new File([blob],filename,{type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){navigator.share({files:[file],title:filename}).catch(()=>downloadBlob(blob,filename));}
  else downloadBlob(blob,filename);
}
function downloadBlob(blob,filename){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}

function generateMonth(month){
  let added=0;
  for(const r of state.recurring){
    if(r.startMonth&&month<r.startMonth)continue;if(r.endMonth&&month>r.endMonth)continue;
    if(state.plans.some(p=>p.recurringId===r.id&&p.budgetMonth===month))continue;
    const [y,m]=month.split('-').map(Number);const last=new Date(y,m,0).getDate();const day=Math.min(last,Math.max(1,number(r.dueDay)||1));
    state.plans.push({id:uid(),recurringId:r.id,title:r.title,amount:number(r.amount),direction:r.direction,budgetMonth:month,dueDate:`${month}-${String(day).padStart(2,'0')}`,essential:!!r.essential,status:'pending',note:r.note||''});added++;
  }
  if(!added) alert('No new recurring items were generated for this month.'); else {state.meta.activeMonth=month;save();alert(`${added} recurring item${added===1?'':'s'} added.`)}
}

// Global navigation and actions
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.go)));
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.close).close()));
$$('[data-quick]').forEach(b=>b.addEventListener('click',()=>{const q=b.dataset.quick;if(q==='plan')openPlan();else openTxn(q)}));
$('#addTxnBtn').onclick=()=>openTxn('expense');$('#addPlanBtn').onclick=()=>openPlan();$('#addGoalBtn').onclick=()=>openGoal();$('#addAccountBtn').onclick=()=>openAccount();$('#addCardBtn').onclick=()=>openCard();$('#addLoanBtn').onclick=()=>openLoan();$('#addCommitteeBtn').onclick=()=>openCommittee();$('#addInvestmentBtn').onclick=()=>openInvestment();$('#addRecurringBtn').onclick=()=>openRecurring();
$('#installHelpBtn').onclick=()=>$('#installDialog').showModal();
$('#dismissInstallCard').onclick=()=>$('#iosInstallCard').classList.add('hidden');

$('#txnFilter').addEventListener('change',renderTransactions);
$('#planMonth').addEventListener('change',e=>{state.meta.activeMonth=e.target.value||state.meta.activeMonth;save()});
$('#generateMonthBtn').onclick=()=>generateMonth($('#planMonth').value||state.meta.activeMonth);

$('#txnForm').addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);
  const t={id:uid(),type:f.get('type'),accountId:f.get('accountId'),amount:number(f.get('amount')),category:f.get('category'),note:f.get('note')||'',date:f.get('date'),createdAt:new Date().toISOString()};
  if(!accountById(t.accountId)){alert('Please add an account first.');return}
  applyTxnToAccount(t,1);state.transactions.push(t);e.currentTarget.reset();$('#txnDialog').close();save();
});

$('#planForm').addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.currentTarget), existing=planById(f.get('id'));
  const data={title:f.get('title'),amount:number(f.get('amount')),direction:f.get('direction'),budgetMonth:f.get('budgetMonth'),dueDate:f.get('dueDate')||'',essential:f.get('essential')==='on',note:f.get('note')||''};
  if(existing)Object.assign(existing,data);else state.plans.push({id:uid(),...data,status:'pending'});
  state.meta.activeMonth=data.budgetMonth;e.currentTarget.reset();$('#planDialog').close();save();
});

$('#completePlanForm').addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.currentTarget),p=planById(f.get('planId'));if(!p)return;
  const amount=number(f.get('amount')),accountId=f.get('accountId'),date=f.get('date');const a=accountById(accountId);if(!a)return;
  if(p.direction==='out'&&number(a.balance)<amount&&!confirm(`${a.name} has ${fmt(a.balance)}. Record a ${fmt(amount)} payment anyway?`))return;
  const t={id:uid(),type:p.direction==='in'?'income':'expense',accountId,amount,category:p.title,note:'Completed from Monthly Plan',date,createdAt:new Date().toISOString(),planId:p.id};
  applyTxnToAccount(t,1);state.transactions.push(t);p.status='completed';p.actualAmount=amount;p.completedDate=date;p.transactionId=t.id;e.currentTarget.reset();$('#completePlanDialog').close();save();
});

$('#goalForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),idv=f.get('id'),data={name:f.get('name'),target:number(f.get('target')),saved:number(f.get('saved')),targetDate:f.get('targetDate')||'',note:f.get('note')||''};const x=state.goals.find(g=>g.id===idv);if(x)Object.assign(x,data);else state.goals.push({id:uid(),...data});$('#goalDialog').close();save();});

$('#accountForm').addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.currentTarget),idv=f.get('id'),data={name:f.get('name'),type:f.get('type'),balance:number(f.get('balance'))},x=accountById(idv);
  if(x){const diff=data.balance-number(x.balance);Object.assign(x,data);if(Math.abs(diff)>.0001)state.transactions.push({id:uid(),type:'adjustment',accountId:x.id,amount:diff,category:'Balance reconciliation',note:'Manual account balance adjustment',date:isoToday(),createdAt:new Date().toISOString()});}
  else state.accounts.push({id:uid(),...data});$('#accountDialog').close();save();
});

$('#cardForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),idv=f.get('id'),data={name:f.get('name'),currentBill:number(f.get('currentBill')),minimumDue:number(f.get('minimumDue')),emi:number(f.get('emi')),statementDay:f.get('statementDay')||'',dueDay:f.get('dueDay')||'',note:f.get('note')||''},x=state.cards.find(c=>c.id===idv);if(x)Object.assign(x,data);else state.cards.push({id:uid(),...data});$('#cardDialog').close();save();});
$('#loanForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),idv=f.get('id'),data={name:f.get('name'),installment:number(f.get('installment')),remainingCount:number(f.get('remainingCount')),nextDue:f.get('nextDue')||'',note:f.get('note')||''},x=state.loans.find(l=>l.id===idv);if(x)Object.assign(x,data);else state.loans.push({id:uid(),...data});$('#loanDialog').close();save();});
$('#committeeForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),idv=f.get('id'),data={name:f.get('name'),monthly:number(f.get('monthly')),ends:f.get('ends')||'',payout:number(f.get('payout')),note:f.get('note')||''},x=state.committees.find(c=>c.id===idv);if(x)Object.assign(x,data);else state.committees.push({id:uid(),...data});$('#committeeDialog').close();save();});
$('#investmentForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),idv=f.get('id'),data={name:f.get('name'),value:number(f.get('value')),category:f.get('category')||'',shariah:f.get('shariah')==='on',note:f.get('note')||''},x=state.investments.find(i=>i.id===idv);if(x)Object.assign(x,data);else state.investments.push({id:uid(),...data});$('#investmentDialog').close();save();});
$('#recurringForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),idv=f.get('id'),data={direction:f.get('direction'),title:f.get('title'),amount:number(f.get('amount')),dueDay:number(f.get('dueDay')),startMonth:f.get('startMonth'),endMonth:f.get('endMonth')||'',essential:f.get('essential')==='on',note:f.get('note')||''},x=state.recurring.find(r=>r.id===idv);if(x)Object.assign(x,data);else state.recurring.push({id:uid(),...data});$('#recurringDialog').close();save();});
$('#settingsForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);state.settings.salary=number(f.get('salary'));state.settings.sadqaPercent=number(f.get('sadqaPercent'));save();alert('Monthly defaults saved.');});

// Delegated item actions
 document.addEventListener('click',e=>{
  const el=e.target.closest('button');if(!el)return;
  const get=(name)=>el.dataset[name];
  if(get('planComplete'))openCompletePlan(get('planComplete'));
  if(get('planEdit'))openPlan(get('planEdit'));
  if(get('planDelete')){const idv=get('planDelete');if(confirm('Delete this planned item?')){state.plans=state.plans.filter(p=>p.id!==idv);save()}}
  if(get('txnDelete')){const idv=get('txnDelete'),t=state.transactions.find(x=>x.id===idv);if(t&&confirm('Delete this transaction and reverse its account effect?')){applyTxnToAccount(t,-1);if(t.planId){const p=planById(t.planId);if(p){p.status='pending';delete p.actualAmount;delete p.completedDate;delete p.transactionId}}state.transactions=state.transactions.filter(x=>x.id!==idv);save()}}
  if(get('goalEdit'))openGoal(get('goalEdit'));if(get('goalDelete')&&confirm('Delete this goal?')){state.goals=state.goals.filter(x=>x.id!==get('goalDelete'));save()}
  if(get('accountEdit'))openAccount(get('accountEdit'));if(get('accountDelete')&&confirm('Delete this account?')){state.accounts=state.accounts.filter(x=>x.id!==get('accountDelete'));save()}
  if(get('cardEdit'))openCard(get('cardEdit'));if(get('cardDelete')&&confirm('Delete this card?')){state.cards=state.cards.filter(x=>x.id!==get('cardDelete'));save()}
  if(get('loanEdit'))openLoan(get('loanEdit'));if(get('loanDelete')&&confirm('Delete this loan/debt?')){state.loans=state.loans.filter(x=>x.id!==get('loanDelete'));save()}
  if(get('committeeEdit'))openCommittee(get('committeeEdit'));if(get('committeeDelete')&&confirm('Delete this committee?')){state.committees=state.committees.filter(x=>x.id!==get('committeeDelete'));save()}
  if(get('investmentEdit'))openInvestment(get('investmentEdit'));if(get('investmentDelete')&&confirm('Delete this investment?')){state.investments=state.investments.filter(x=>x.id!==get('investmentDelete'));save()}
  if(get('recurringEdit'))openRecurring(get('recurringEdit'));if(get('recurringDelete')&&confirm('Delete this recurring rule?')){state.recurring=state.recurring.filter(x=>x.id!==get('recurringDelete'));save()}
 });

$('#backupBtn').onclick=()=>exportBlob(`hisab-private-backup-${isoToday()}.json`,JSON.stringify(state,null,2),'application/json');
$('#exportCsvBtn').onclick=()=>{const rows=[['Date','Type','Account','Amount','Category','Note'],...state.transactions.map(t=>[t.date,t.type,accountById(t.accountId)?.name||'',t.amount,t.category||'',t.note||''])];const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');exportBlob(`hisab-transactions-${isoToday()}.csv`,csv,'text/csv');};
$('#restoreInput').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{const parsed=normalizeState(JSON.parse(await file.text()));if(!parsed.accounts||!parsed.meta)throw new Error('Invalid');state=parsed;state.meta.onboarded=true;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));$('#onboardingDialog').close();render();alert('Private data imported successfully.');}
  catch{alert('This file could not be imported as a Hisab backup.');}
  e.target.value='';
});
$('#persistBtn').onclick=async()=>{if(navigator.storage?.persist){const granted=await navigator.storage.persist();alert(granted?'Offline storage protection requested successfully. Keep backups too.':'This browser did not grant persistent storage. Keep regular backups.');}else alert('Persistent storage request is not supported here. Keep regular backups.');};
$('#resetBtn').onclick=()=>{if(confirm('This will erase Hisab data from this browser. Export a backup first. Continue?')){localStorage.removeItem(STORAGE_KEY);state=blankState();state.meta.onboarded=true;save();}};

$('#startFreshBtn').onclick=()=>{state.meta.onboarded=true;save();$('#onboardingDialog').close();};

function isStandalone(){return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true}
function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent)}
if(isIOS()&&!isStandalone())$('#iosInstallCard').classList.remove('hidden');
if(!state.meta.onboarded)setTimeout(()=>$('#onboardingDialog').showModal(),150);
$('#planMonth').value=state.meta.activeMonth||thisMonth();

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
render();
