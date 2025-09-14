/* =========================================================
   party.js — BatoDice（3v3）パーティ戦
   ・HTMLのID/関数名に合わせて実装（UIは再生成しない）
   ・ソロ保存（batoDiceSaveV3）と双方向同期（3人）
   ・ガロ=ガード型(guardPower加算) / ミナ=回復型(healPower加算)
   ========================================================= */
(()=>{
// ====== 既存ユーティリティ（存在すれば再利用） ======
const $  = window.$  || (s=>document.querySelector(s));
const $$ = window.$$ || (s=>[...document.querySelectorAll(s)]);
const wait   = window.wait   || (ms=>new Promise(r=>setTimeout(r,ms)));
const clamp  = window.clamp  || ((n,min,max)=>Math.max(min,Math.min(max,n)));
const pct    = window.pct    || ((v,tot)=>Math.round((v/tot)*100));
const SPEEDS = window.SPEEDS || {
  fast:   { dice:450, pause:320, enemyPause:420 },
  normal: { dice:700, pause:420, enemyPause:520 },
  slow:   { dice:950, pause:520, enemyPause:620 }
};
let ptTiming = { ...SPEEDS.normal };

// ====== 定数・セーブキー ======
const PARTY_SAVE_KEY='batoDicePartyV1';
const SOLO_SAVE_KEY ='batoDiceSaveV3';
const PARTY_MAX_LEVEL = 20;

// ====== レベルテーブル（パーティ用：HP/ATK/guard/heal） ======
const ATK_UP_LEON = [2,4,7,10,13,16,19];
const ATK_UP_GARO = [4,8,12,16,20];
const ATK_UP_MINA = [3,6,10,14,18];

const GUARD_UP_GARO = [4,8,12,16,20];
const HEAL_UP_MINA  = [3,6,10,14,18];

function buildLevelTable(atkUp, guardUp=[], healUp=[]){
  const T={}; for(let lv=2; lv<=PARTY_MAX_LEVEL; lv++){
    T[lv]={ xp:lv*lv, hp:2, atk:atkUp.includes(lv)?1:0, guard:guardUp.includes(lv)?1:0, heal:healUp.includes(lv)?1:0 };
  } return T;
}
const PT_LEVEL = {
  leon: buildLevelTable(ATK_UP_LEON),
  garo: buildLevelTable(ATK_UP_GARO, GUARD_UP_GARO, []),
  mina: buildLevelTable(ATK_UP_MINA, [], HEAL_UP_MINA),
};
const PT_XP_NEED={}; for(let lv=1; lv<PARTY_MAX_LEVEL; lv++){ PT_XP_NEED[lv]=(lv+1)*(lv+1) }

// ====== 役割・基本プリセット（フォールバック） ======
const ROLES = { ATK:'アタッカー', TANK:'タンク', SUP:'サポート' };
// ソロと同等の技構成
const SKILLS_LEON = {
  1:{name:'一閃',dmg:2}, 2:{name:'連撃',dmg:3}, 3:{name:'強斬',dmg:4},
  4:{name:'急所突き',dmg:5}, 5:{name:'全力斬り',dmg:6}, 6:{name:'昇天斬',dmg:7}
};
const SKILLS_GARO = {
  1:{name:'盾打ち',dmg:1},
  2:{name:'防御の構え',guard:2},
  3:{name:'挑発',guard:2},
  4:{name:'全体挑発',guard:2, aoeGuard:true}, // 表示用フラグ（ロジックは単体スタック）
  5:{name:'鉄壁',guard:3},
  6:{name:'不屈の護り',guard:4}
};
const SKILLS_MINA = {
  1:{name:'癒しのさざめき',heal:2},
  2:{name:'小癒し',heal:3},
  3:{name:'祝福',heal:3,buffAtk:1},
  4:{name:'全体小回復',heal:2,aoe:true},
  5:{name:'大回復',heal:6},
  6:{name:'天啓',heal:4,aoe:true,buffAtk:2}
};
const PRESETS = {
  leon:{ id:'leon', name:'剣士レオン', role:ROLES.ATK, baseMax:22, atk:1, guardPower:0, healPower:0,
    passive:{ label:'猛攻：ゾロ目で+2' }, skills:SKILLS_LEON },
  garo:{ id:'garo', name:'盾騎士ガロ', role:ROLES.TANK, baseMax:28, atk:0, guardPower:0, healPower:0,
    passive:{ label:'守護：被ダメ-1（最低1）', harden:1 }, skills:SKILLS_GARO },
  mina:{ id:'mina', name:'僧侶ミナ',   role:ROLES.SUP,  baseMax:20, atk:0, guardPower:0, healPower:0,
    passive:{ label:'清澄：回復+1', healPlus:1 }, skills:SKILLS_MINA },
};
const CHAR_ASSETS = {
  leon: '勇者.jpg',
  garo: 'ガロ.png',
  mina: 'ミナ.png',
};

// ====== 敵図鑑（3v3） ======
const ENEMIES = {
  slime:{ key:'slime', name:'スライム', img:'スライム.png', max:10,
    skills:{1:{name:'ぺち',dmg:1},2:{name:'ぺち',dmg:1},3:{name:'のし',dmg:2},4:{name:'のし',dmg:2},5:{name:'どろ弾',dmg:2},6:{name:'どろ弾・強',dmg:3}}, xp:1 },
  mutant:{ key:'mutant',name:'変異スライム', img:'スライム1.png', max:12,
    skills:{1:{name:'硬化打',dmg:1},2:{name:'硬化打',dmg:2},3:{name:'のし',dmg:2},4:{name:'のし',dmg:3},5:{name:'硬化',dmg:0},6:{name:'硬化(強)',dmg:0}}, passive:{harden:1,label:'被ダメ-1'}, xp:2 },
  frog:{ key:'frog', name:'カエル', img:'カエル.png', max:14,
    skills:{1:{name:'舌',dmg:2},2:{name:'舌',dmg:2},3:{name:'跳び蹴り',dmg:3},4:{name:'跳び蹴り',dmg:3},5:{name:'毒舌',dmg:3},6:{name:'体当たり',dmg:4}}, xp:2, passive:{poisonOnHit:2,label:'毒2T'} },
  bat:{ key:'bat', name:'コウモリ', img:'コウモリ.png', max:12,
    skills:{1:{name:'噛みつき',dmg:2},2:{name:'噛みつき',dmg:2},3:{name:'急降下',dmg:2},4:{name:'急降下',dmg:3},5:{name:'超音波',dmg:3},6:{name:'連撃',dmg:4}}, xp:2 },
  smallGolem:{ key:'smallGolem', name:'小ゴーレム', img:'小ゴーレム.png', max:18,
    skills:{1:{name:'岩拳',dmg:2},2:{name:'岩拳',dmg:2},3:{name:'瓦礫',dmg:3},4:{name:'瓦礫',dmg:3},5:{name:'地響き',dmg:4},6:{name:'地割れ',dmg:5}}, passive:{harden:1,label:'被ダメ-1'}, xp:3 },
  fireLizard:{ key:'fireLizard', name:'火トカゲ', img:'火トカゲ.png', max:20,
    skills:{1:{name:'噛み裂き',dmg:2},2:{name:'尻尾',dmg:3},3:{name:'火花',dmg:3},4:{name:'火花',dmg:3},5:{name:'火炎',dmg:4},6:{name:'火炎(強)',dmg:5}}, xp:3 },
  magmaGolem:{ key:'magmaGolem', name:'マグマG', img:'マグマゴーレム.png', max:24,
    skills:{1:{name:'溶岩拳',dmg:2},2:{name:'溶岩拳',dmg:3},3:{name:'岩塊',dmg:3},4:{name:'岩塊',dmg:4},5:{name:'灼熱',dmg:5},6:{name:'噴火',dmg:6}}, xp:4 },
  angelSoldier:{ key:'angelSoldier', name:'天使兵', img:'天使兵.png', max:26,
    skills:{1:{name:'斬撃',dmg:3},2:{name:'斬撃',dmg:3},3:{name:'光弾',dmg:4},4:{name:'光弾',dmg:4},5:{name:'裁き',dmg:5},6:{name:'聖光',dmg:6}}, xp:4 },
  gargoyle:{ key:'gargoyle', name:'ガーゴイル', img:'ガーゴイル.png', max:28,
    skills:{1:{name:'爪',dmg:3},2:{name:'爪',dmg:3},3:{name:'尾',dmg:4},4:{name:'尾',dmg:4},5:{name:'石化打',dmg:5},6:{name:'怒涛',dmg:6}}, passive:{harden:1,label:'被ダメ-1'}, xp:4 },
  dragon:{ key:'dragon', name:'ドラゴン', img:'ドラゴン.png', max:60,
    skills:{1:{name:'爪',dmg:4},2:{name:'尾',dmg:4},3:{name:'咆哮',dmg:5},4:{name:'ブレス',dmg:6},5:{name:'紅蓮',dmg:7},6:{name:'滅炎',dmg:8}},
    passive:{geirin:true,harden:1,label:'逆鱗＆被ダメ-1'}, xp:12 }
};

// ====== ステージ構成（HTMLは pst1〜pst10 を呼び出し） ======
const STAGE = {
  pst1:{ key:'pst1', name:'草原(パ)', bg:'stage1.png', battles:3, squads:[
    ['slime','slime','slime'],
    ['slime','mutant','slime'],
    ['slime','frog','slime']
  ], xp:2 },
  pst2:{ key:'pst2', name:'森(パ)', bg:'stage2.png', battles:3, squads:[
    ['slime','frog','slime'],
    ['mutant','frog','mutant'],
    ['frog','bat','frog']
  ], xp:3 },
  pst3:{ key:'pst3', name:'湖畔(パ)', bg:'stage3.png', battles:3, squads:[
    ['slime','frog','slime'],
    ['frog','bat','frog'],
    ['frog','frog','bat']
  ], xp:4 },
  pst4:{ key:'pst4', name:'洞窟(パ)', bg:'stage4.png', battles:3, squads:[
    ['bat','bat','slime'],
    ['bat','smallGolem','bat'],
    ['smallGolem','bat','smallGolem']
  ], xp:5 },
  pst5:{ key:'pst5', name:'廃墟(パ)', bg:'stage5.png', battles:2, squads:[
    ['bat','smallGolem','bat'],
    ['smallGolem','smallGolem','bat']
  ], xp:6 },
  pst6:{ key:'pst6', name:'火山(パ)', bg:'stage6.png', battles:3, squads:[
    ['fireLizard','fireLizard','bat'],
    ['magmaGolem','fireLizard','magmaGolem'],
    ['magmaGolem','fireLizard','magmaGolem']
  ], xp:7 },
  pst7:{ key:'pst7', name:'氷の洞窟(パ)', bg:'stage7.png', battles:3, squads:[
    ['bat','smallGolem','bat'],
    ['smallGolem','smallGolem','bat'],
    ['smallGolem','smallGolem','smallGolem']
  ], xp:8 },
  pst8:{ key:'pst8', name:'砂漠(パ)', bg:'stage8.png', battles:3, squads:[
    ['fireLizard','magmaGolem','fireLizard'],
    ['magmaGolem','magmaGolem','gargoyle'],
    ['fireLizard','gargoyle','magmaGolem']
  ], xp:9 },
  pst9:{ key:'pst9', name:'天空城(パ)', bg:'stage9.png', battles:3, squads:[
    ['angelSoldier','gargoyle','angelSoldier'],
    ['gargoyle','angelSoldier','gargoyle'],
    ['gargoyle','gargoyle','angelSoldier']
  ], xp:10 },
  pst10:{ key:'pst10', name:'竜の間(パ)', bg:'stage10.png', battles:1, squads:[
    ['gargoyle','dragon','gargoyle']
  ], boss:'dragon', xp:12 }
};
// パネルの進捗IDは HTMLが `pprog_stX` なので変換表を用意
const PROG_ID = { pst1:'pprog_st1', pst2:'pprog_st2', pst3:'pprog_st3', pst4:'pprog_st4', pst5:'pprog_st5',
                  pst6:'pprog_st6', pst7:'pprog_st7', pst8:'pprog_st8', pst9:'pprog_st9', pst10:'pprog_st10' };

// ====== セーブ ======
let Party = {
  settings:{ speed:'normal' },
  equip:{ ironSword:0, ironShield:0, blueSword:0, blueShield:0, dragonSword:0, sol:0, regalia:0 },
  items:{}, // 今回は未使用（UIだけ表示）
  roster:[ mkChar(PRESETS.leon), mkChar(PRESETS.garo), mkChar(PRESETS.mina) ],
  progress:{ clears:{}, kills:{} },
  currentStage:null
};
function mkChar(p){ return {
  id:p.id, name:p.name, role:p.role, lvl:1, xp:1,
  baseMax:p.baseMax, max:p.baseMax, hp:p.baseMax,
  atk:p.atk, guardPower:p.guardPower||0, healPower:p.healPower||0,
  skills:JSON.parse(JSON.stringify(p.skills)), passive:p.passive||null
}}
function saveParty(){ try{ localStorage.setItem(PARTY_SAVE_KEY, JSON.stringify(Party)) }catch(e){} }
function loadParty(){
  try{ const raw=localStorage.getItem(PARTY_SAVE_KEY);
    if(raw){ const p=JSON.parse(raw); if(p?.roster&&p?.equip) Party=p; }
  }catch(e){}
}

// ====== ソロ ⇄ パーティ 同期（3人） ======
function readSolo(){ try{ const r=localStorage.getItem(SOLO_SAVE_KEY); return r?JSON.parse(r):null }catch(e){ return null } }
function writeSolo(g){ try{ localStorage.setItem(SOLO_SAVE_KEY, JSON.stringify(g)) }catch(e){} }

// ソロ→パーティ 取り込み
function syncFromSolo(){
  const g=readSolo(); if(!g) return;
  // Leon
  const L = Party.roster[0];
  L.name = g.player?.name ?? L.name;
  L.lvl  = g.player?.lvl  ?? L.lvl;
  L.xp   = g.player?.xp   ?? L.xp;
  L.baseMax = g.player?.baseMax ?? L.baseMax;
  L.max  = g.player?.max ?? L.max;
  L.hp   = clamp(g.player?.hp ?? L.max, 0, L.max);
  L.atk  = g.player?.atk ?? L.atk;
  L.guardPower = g.player?.guardPower ?? 0;
  L.healPower  = g.player?.healPower  ?? 0;
  L.skills = JSON.parse(JSON.stringify(g.player?.skills || L.skills));

  // Garo
  const G = Party.roster[1];
  const gs=g.party?.garo||{};
  G.name=gs.name??G.name; G.lvl=gs.lvl??G.lvl; G.xp=gs.xp??G.xp;
  G.baseMax=gs.baseMax??G.baseMax; G.max=gs.max??G.max; G.hp=clamp(gs.hp??G.max,0,G.max);
  G.atk=gs.atk??G.atk; G.guardPower=gs.guardPower??0; G.healPower=gs.healPower??0;
  G.skills=JSON.parse(JSON.stringify(gs.skills||G.skills));

  // Mina
  const M = Party.roster[2];
  const ms=g.party?.mina||{};
  M.name=ms.name??M.name; M.lvl=ms.lvl??M.lvl; M.xp=ms.xp??M.xp;
  M.baseMax=ms.baseMax??M.baseMax; M.max=ms.max??M.max; M.hp=clamp(ms.hp??M.max,0,M.max);
  M.atk=ms.atk??M.atk; M.guardPower=ms.guardPower??0; M.healPower=ms.healPower??0;
  M.skills=JSON.parse(JSON.stringify(ms.skills||M.skills));
}
// パーティ→ソロ 反映
function syncToSolo(){
  const g = readSolo() || { player:{}, party:{}, progress:{}, unlock:{} };
  const L=Party.roster[0], G=Party.roster[1], M=Party.roster[2];
  g.player.name=L.name; g.player.lvl=L.lvl; g.player.xp=L.xp;
  g.player.baseMax=L.baseMax; g.player.max=L.max; g.player.hp=L.hp;
  g.player.atk=L.atk; g.player.skills=JSON.parse(JSON.stringify(L.skills));
  g.player.guardPower=L.guardPower||0; g.player.healPower=L.healPower||0;

  g.party=g.party||{};
  g.party.garo={ name:G.name,lvl:G.lvl,xp:G.xp, baseMax:G.baseMax,max:G.max,hp:G.hp, atk:G.atk,
                 guardPower:G.guardPower||0, healPower:G.healPower||0,
                 skills:JSON.parse(JSON.stringify(G.skills)) };
  g.party.mina={ name:M.name,lvl:M.lvl,xp:M.xp, baseMax:M.baseMax,max:M.max,hp:M.hp, atk:M.atk,
                 guardPower:M.guardPower||0, healPower:M.healPower||0,
                 skills:JSON.parse(JSON.stringify(M.skills)) };
  writeSolo(g);
}

// ====== 進行・状態 ======
let PStage=null;        // { id, remain, idx }
let PSquad=null;        // 敵配列
let PReward=null;       // { xp, chests:[] }
let pState=null;        // ランタイム

// ====== UI ヘルパ ======
function setHpBar(selPctEl, hp, max){
  const el=$(selPctEl); if(!el) return;
  el.style.width=`${pct(hp,max)}%`;
  const bar=el.parentElement; bar?.classList.toggle('warn', hp/max<=.4);
}
function refreshAllyCards(){
  const A=Party.roster;
  $('#pName1').textContent=A[0].name; $('#pName2').textContent=A[1].name; $('#pName3').textContent=A[2].name;
  setHpBar('#pHp1',A[0].hp,A[0].max); setHpBar('#pHp2',A[1].hp,A[1].max); setHpBar('#pHp3',A[2].hp,A[2].max);
 // 画像反映（#pImg1〜3 がHTMLにある前提）
 const img1 = $('#pImg1'), img2 = $('#pImg2'), img3 = $('#pImg3');
 if (img1) img1.src = CHAR_ASSETS[A[0].id] || CHAR_ASSETS.leon;
 if (img2) img2.src = CHAR_ASSETS[A[1].id] || CHAR_ASSETS.garo;
 if (img3) img3.src = CHAR_ASSETS[A[2].id] || CHAR_ASSETS.mina;

}
function refreshEnemyCards(){
  if(!PSquad) return;
  for(let i=0;i<3;i++){
    const e=PSquad[i];
    $(`#eName${i+1}`).textContent = e? e.name : '-';
    setHpBar(`#eHp${i+1}`, e?.hp||0, e?.max||1);
    const img=$(`#eImg${i+1}`); if(img && e) img.src = e.img;
  }
}
function clearPartyLog(){ const pre=$('#partyLog'); if(pre) pre.textContent=''; }
function appendPartyLog(side,msg){
  const pre=$('#partyLog'); if(!pre) return;
  pre.insertAdjacentHTML('beforeend', `\n${side}：${msg}`);
  pre.scrollTop = pre.scrollHeight;
}

// ====== ステージ進行 ======
function gotoPartyStage(key){
  const st = STAGE[key]; if(!st) return;
  Party.currentStage=key;
  PStage={ id:key, remain:st.battles, idx:0, cleared:false };
  PReward={ xp:0, chests:[] };
  Party.roster.forEach(c=> c.hp=c.max);
  applyPartyBG(st.bg);
  startPartyBattle();
  goto('party-battle');
}
 window.gotoPartyStage = gotoPartyStage;
 window.leavePartyBattle = leavePartyBattle;
 window.partyOpenAllChests = openAllPartyChests;
 window.finishPartyResult  = finishPartyResult;

function nextPartyBattle(){
  const st=STAGE[PStage.id];
  const squadKeys = st.squads[Math.min(PStage.idx, st.squads.length-1)];
  PSquad = squadKeys.map(k=>{
    const b=ENEMIES[k];
    return { key:b.key,name:b.name,img:b.img,max:b.max,hp:b.max,
             skills:JSON.parse(JSON.stringify(b.skills)), passive:b.passive||null, enraged:false };
  });
  startPartyBattle();
}

function startPartyBattle(){
  pState = { phase:'ready', busy:false, actorIdx:0, turnOrder:[], turnCursor:0, allyHist:[], enemyHist:[], taunt:0 };
  buildTurnOrder();
  // UI
  refreshAllyCards();
  // 敵3体をUIに反映
  if(!PSquad) nextPartyBattle(); else refreshEnemyCards();
  // スキル一覧をモーダルに反映
  fillSkillLists();
  // 速度
  const sp=$('#speedSel'); if(sp){ sp.addEventListener('change',(e)=>{ ptTiming={ ...SPEEDS[e.target.value||'normal'] } }); }
  // ボタン
  $('#btnPartyRoll')?.addEventListener('click', onPartyRoll);
  $('#btnPartyAct') ?.addEventListener('click', onPartyAct);
  $('#btnPartyItem')?.addEventListener('click', openPartyItems);
  setPartyButtons(true,false);
  clearPartyLog(); appendPartyLog('システム','敵が現れた！');
}

function buildTurnOrder(){
  pState.turnOrder = Party.roster.map((c,i)=> c.hp>0? i : -1).filter(i=>i>=0);
  pState.turnCursor=0;
  pState.actorIdx  = pState.turnOrder[0] ?? 0;
}

// ====== サイコロ（パーティ） ======
let rotX=0, rotY=0;
function spinPartyDice(n){
  const dice=$('#partyDice'); if(!dice) return;
  const FACE={1:{x:0,y:0},2:{x:90,y:0},3:{x:0,y:-90},4:{x:0,y:90},5:{x:-90,y:0},6:{x:0,y:180}};
  rotX += 360*(2+Math.floor(Math.random()*2));
  rotY += 360*(2+Math.floor(Math.random()*2));
  const base=FACE[n];
  dice.style.transform=`rotateX(${rotX+base.x}deg) rotateY(${rotY+base.y}deg)`;
}
function pushChip(containerSel,n,cls){
  const box=$(containerSel); if(!box) return;
  const kids=[...box.children]; kids.forEach(c=>c.classList.remove('last'));
  if(kids.length>=3) box.removeChild(kids[0]);
  const el=document.createElement('div'); el.className='chip '+cls+' last'; el.textContent=n; box.appendChild(el);
}

// ====== コンボ（味方3ロール履歴） ======
function checkPartyCombo(){
  const h=pState.allyHist;
  if(h.length<3) return null;
  const last=h.slice(-3);
  if(last[0]===last[1] && last[1]===last[2]) return {type:'triple', label:'ゾロ目', bonus:2};
  if([4,5,6].every(v=>last.includes(v))) return {type:'456', label:'4-5-6', bonus:1};
  return null;
}

// ====== 行動UI ======
function setPartyButtons(rollOk, actOk){
  const r=$('#btnPartyRoll'), a=$('#btnPartyAct');
  if(r) r.disabled=!rollOk; if(a) a.disabled=!actOk;
}
function showRibbon(idPrefix, idx, text){
  const rib=$(`#${idPrefix}Ribbon${idx}`), t=$(`#${idPrefix}RibbonText${idx}`);
  if(!rib||!t) return; t.textContent=text; rib.style.display='flex';
  rib.classList.remove('show'); void rib.offsetWidth; rib.classList.add('show');
  setTimeout(()=>{ rib.style.display='none' }, 900);
}

// ====== 出目・実行 ======
let pRolled=null;
async function onPartyRoll(){
  if(pState.busy || pState.phase!=='ready') return;
  pState.busy=true; setPartyButtons(false,false);

  // アクター（次の生存味方）
  const aIdx = nextAliveAllyIndex(pState.actorIdx);
  if(aIdx<0){ await partyLose(); return; }
  const actor = Party.roster[aIdx];

  // DOT
  await applyDotsToChar(actor, aIdx+1);

  const n = roll1to6(); pRolled=n; spinPartyDice(n);
  pState.allyHist.push(n); if(pState.allyHist.length>60) pState.allyHist.shift();
  setTimeout(()=> pushChip('#partyAllyChips', n, 'ally'), 900);

  const combo=checkPartyCombo();
  const bossAlive = PSquad.some(e=>e?.key==='dragon' && e.hp>0);
  if(combo && !bossAlive) showRibbon('p', aIdx+1, `コンボ！ ${combo.label}`);

  // ラベル更新
  const skill = actor.skills[n] || {name:`技${n}`,dmg:1};
  const shown = previewValue(actor, skill, (combo && !bossAlive)? combo.bonus : 0);
  $('#partyActLabel').textContent = `${actor.name}：${skill.name}（${shown}）`;
  showRibbon('p', aIdx+1, `技${n}：${skill.name}`);

  await wait(ptTiming.pause);
  pState.phase='rolled'; setPartyButtons(false,true); pState.busy=false;
}
async function onPartyAct(){
  if(pState.busy || pState.phase!=='rolled') return;
  pState.busy=true; setPartyButtons(false,false);

  const aIdx = nextAliveAllyIndex(pState.actorIdx), actor=Party.roster[aIdx];
  const skill = actor.skills[pRolled] || {name:`技${pRolled}`,dmg:1};
  const combo = checkPartyCombo();
  const bossAlive = PSquad.some(e=>e?.key==='dragon' && e.hp>0);
  const comboBonus = (combo && !bossAlive)? combo.bonus : 0;

  await execAllyAction(actor, aIdx, skill, comboBonus);

  // 敵全滅？
  if(PSquad.every(e=>e.hp<=0)){ await wait(350); await partyWin(); return; }
  if(!existsAliveAlly()){ await partyLose(); return; }

  // 味方ターンの残り
  pState.turnCursor++;
  if(pState.turnCursor < pState.turnOrder.length){
    const nextIdx = pState.turnOrder[pState.turnCursor];
    pState.actorIdx = nextAliveAllyIndex(nextIdx);
    pState.phase='ready'; setPartyButtons(true,false); pState.busy=false; return;
  }

  // 敵ターン
  await enemyTurnPhase();
  if(!existsAliveAlly()){ await partyLose(); return; }

  // 次ラウンド
  buildTurnOrder();
  pState.phase='ready'; setPartyButtons(true,false); pState.busy=false;
}

function previewValue(actor, skill, comboBonus){
  if(skill.dmg!=null){
    const add = actor.atk + comboBonus + equipAtkBonus(actor);
    return Math.max(0, (skill.dmg||0) + add);
  }
  if(skill.heal!=null){
    return (skill.heal||0) + (actor.healPower||0) + (actor.passive?.healPlus||0) + equipHealBonus(actor);
  }
  if(skill.guard!=null){
    return (skill.guard||0) + (actor.guardPower||0) + equipGuardBonus(actor);
  }
  return 0;
}

// ====== 装備ボーナス（簡易） ======
function equipAtkBonus(a){ return a.role===ROLES.ATK ? ((Party.equip.ironSword||0)*1 + (Party.equip.blueSword||0)*2 + (Party.equip.dragonSword||0)*3 + (Party.equip.sol||0)*3) : 0 }
function equipGuardBonus(a){ return a.role===ROLES.TANK? ((Party.equip.ironShield||0)*1 + (Party.equip.blueShield||0)*2 + (Party.equip.regalia||0)*3) : 0 }
function equipHealBonus(a){ return a.role===ROLES.SUP ? ((Party.equip.regalia>0?1:0) + (Party.equip.sol>0?1:0)) : 0 }

// ====== 味方アクション本体 ======
async function execAllyAction(actor, aIdx, skill, comboBonus){
  const pid=aIdx+1;

  if(skill.dmg!=null){
    const targets = skill.aoe ? aliveEnemies() : [chooseEnemyTarget()];
    for(const e of targets){
      if(!e) continue;
      let dmg = Math.max(0, (skill.dmg||0) + actor.atk + comboBonus + equipAtkBonus(actor));
      const hard = e.passive?.harden||0;
      dmg = Math.max(1, dmg - hard);
      e.hp = clamp(e.hp - dmg, 0, e.max);
      hitFXEnemy(e, dmg);
      setHpBar(`#eHp${PSquad.indexOf(e)+1}`, e.hp, e.max);
      appendPartyLog(actor.name, `${skill.name} → ${e.name} に -${dmg}（残${e.hp}/${e.max}）`);
    }
    showRibbon('p', pid, skill.name);
  }
  else if(skill.heal!=null){
    const heal = (skill.heal||0) + (actor.healPower||0) + (actor.passive?.healPlus||0) + equipHealBonus(actor);
    const tgts = skill.aoe ? aliveAllies() : [chooseAllyLow()];
    for(const t of tgts){
      const before=t.hp; t.hp=clamp(t.hp+heal,0,t.max);
      const delta=t.hp-before;
      healFXAlly(t, delta);
      setHpBar(`#pHp${Party.roster.indexOf(t)+1}`, t.hp, t.max);
      appendPartyLog(actor.name, `${skill.name} → ${t.name} を +${delta} 回復（${t.hp}/${t.max}）`);
    }
    if(skill.buffAtk){ pState._teamAtkBuff=(pState._teamAtkBuff||0) + skill.buffAtk; appendPartyLog('システム',`次の味方攻撃に +${skill.buffAtk}`); }
    showRibbon('p', pid, skill.name);
  }
  else if(skill.guard!=null){
    const add = (skill.guard||0) + (actor.guardPower||0) + equipGuardBonus(actor);
    actor._guard = (actor._guard||0) + add;
    if(/挑発/.test(skill.name)) pState.taunt = Math.min(5, pState.taunt+2); else pState.taunt = Math.min(5, pState.taunt+1);
    appendPartyLog(actor.name, `${skill.name}（ガード${actor._guard||0} / 挑発${pState.taunt}）`);
    showRibbon('p', pid, skill.name);
  }

  await wait(240);
}
function hitFXEnemy(e, dmg){
  const idx=PSquad.indexOf(e)+1;
  const card=$(`#eCard${idx}`); if(!card) return;
  const f=document.createElement('div'); f.className='flash'; card.appendChild(f); setTimeout(()=>f.remove(),350);
  const d=document.createElement('div'); d.className='dmg'; d.textContent='-'+dmg; card.appendChild(d); setTimeout(()=>d.remove(),820);
  card.classList.remove('hitShake'); void card.offsetWidth; card.classList.add('hitShake');
}
function healFXAlly(t, val){
  const idx=Party.roster.indexOf(t)+1;
  const card=$(`#pCard${idx}`); if(!card) return;
  const d=document.createElement('div'); d.className='dmg'; d.style.color='#9fffb0'; d.style.textShadow='0 0 14px rgba(80,255,120,.85),0 0 3px #000'; d.textContent='+'+val;
  card.appendChild(d); setTimeout(()=>d.remove(),820);
}

// ====== 敵ターン ======
async function enemyTurnPhase(){
  for(let i=0;i<PSquad.length;i++){
    const e=PSquad[i];
    if(!e || e.hp<=0) continue;

    await wait(ptTiming.enemyPause);
    const n=roll1to6(); spinPartyDice(n);
    setTimeout(()=> pushChip('#partyEnemyChips', n, 'enemy'), 900);
    await wait(ptTiming.pause+300);
    showRibbon('e', i+1, `技${n}：${e.skills[n].name}`);
    await wait(ptTiming.pause+300);

    const target = chooseAllyTargetWithTaunt();

    let dmg = Math.max(0, (e.skills[n].dmg||0));
    // 味方ガード＆ガロ硬化
    const hardP = (target.id==='garo' ? (PRESETS.garo.passive?.harden||0) : 0);
    let guard = target._guard||0;
    let final = Math.max(1, Math.max(0, dmg - guard) - hardP);
    target._guard = 0;

    target.hp = clamp(target.hp - final, 0, target.max);
    hitFXAlly(target, final);
    setHpBar(`#pHp${Party.roster.indexOf(target)+1}`, target.hp, target.max);
    appendPartyLog(e.name, `${e.skills[n].name} → ${target.name} に -${final}（残${target.hp}/${target.max}）`);

    if(e.passive?.poisonOnHit && final>0){ target._poison = Math.max(target._poison||0, e.passive.poisonOnHit); appendPartyLog('システム',`${target.name} は毒(${target._poison})！`); }

    if(!existsAliveAlly()) return;
  }
}
function hitFXAlly(t, dmg){
  const idx=Party.roster.indexOf(t)+1;
  const card=$(`#pCard${idx}`); if(!card) return;
  const f=document.createElement('div'); f.className='flash'; card.appendChild(f); setTimeout(()=>f.remove(),350);
  const d=document.createElement('div'); d.className='dmg'; d.textContent='-'+dmg; card.appendChild(d); setTimeout(()=>d.remove(),820);
  card.classList.remove('hitShake'); void card.offsetWidth; card.classList.add('hitShake');
}

// ====== ターゲット/生存 ======
function aliveEnemies(){ return PSquad.filter(e=>e&&e.hp>0) }
function aliveAllies(){ return Party.roster.filter(c=>c&&c.hp>0) }
function existsAliveAlly(){ return aliveAllies().length>0 }
function chooseEnemyTarget(){
  const al=aliveEnemies(); if(al.length===0) return null;
  return al.reduce((a,b)=> (a.hp<=b.hp? a : b));
}
function chooseAllyLow(){
  const al=aliveAllies(); return al.reduce((a,b)=> (a.hp/a.max <= b.hp/b.max ? a : b));
}
function chooseAllyTargetWithTaunt(){
  const tank=Party.roster.find(c=>c.id==='garo'&&c.hp>0);
  if(!tank || Math.random()>(0.5+0.1*pState.taunt)){
    const list=aliveAllies(); return list[Math.floor(Math.random()*list.length)];
  }
  return tank;
}
function nextAliveAllyIndex(startIdx){
  const n=Party.roster.length;
  for(let k=0;k<n;k++){ const idx=(startIdx+k)%n; if(Party.roster[idx].hp>0) return idx; }
  return -1;
}

// ====== DOT ======
async function applyDotsToChar(ch, idx1){
  let total=0;
  if(ch._poison>0){ total+=1; ch._poison--; }
  if(total>0){
    ch.hp = clamp(ch.hp-total, 0, ch.max);
    hitFXAlly(ch, total);
    setHpBar(`#pHp${idx1}`, ch.hp, ch.max);
    appendPartyLog('システム',`${ch.name} に継続ダメージ(${total})`);
    await wait(220);
  }
}

// ====== 勝敗 ======
async function partyWin(){
  const st=STAGE[PStage.id];
  let gain=0; PSquad.forEach(e=> gain+=(ENEMIES[e.key]?.xp||1));
  PReward.xp += gain;

  // 箱（ドラゴン戦はキラ青）
  const chest = (st.boss==='dragon')? 'blueSparkle' : rollChest();
  if(chest) PReward.chests.push(chest);
  appendPartyLog('システム',`勝利！ 経験値+${gain}${chest? ' / 宝箱！':''}`);

  PStage.remain--; PStage.idx++;
  if(PStage.remain>0){ nextPartyBattle(); return; }

  // ステージクリア：3人へXP配布＆LvUp（HP/ATK/guard/heal）
  Party.roster.forEach(c=>{
    c.xp = Math.max(1, c.xp) + PReward.xp;
    let up=false;
    const table=PT_LEVEL[c.id]||{};
    for(let t=c.lvl+1;t<=PARTY_MAX_LEVEL;t++){
      const req=table[t]; if(!req) break;
      if(c.xp>=req.xp){
        c.lvl=t; c.baseMax+=(req.hp||0); c.atk+=(req.atk||0);
        c.guardPower=(c.guardPower||0)+(req.guard||0);
        c.healPower =(c.healPower ||0)+(req.heal ||0);
        c.max=c.baseMax; c.hp=c.max; up=true;
      }
    }
    if(!up){ c.hp=Math.min(c.hp+3,c.max) }
  });
  saveParty(); syncToSolo(); // ← ソロへ反映

  showPartyResultScreen(PStage.id);
}
async function partyLose(){
  const w=$('#partyWinOverlay'); if(w){ w.querySelector('span').textContent='LOSE'; w.hidden=false; w.classList.add('show'); }
  Party.roster.forEach(c=> c.hp=c.max);
  Party.currentStage=null; saveParty();
  await wait(900);
  clearPartyBG(); goto('party-select'); refreshPartySelect();
}

// ====== 背景 ======
function applyPartyBG(bg){ const sec=$('#party-battle'); if(sec) sec.style.background=`#000 url('${bg}') center/cover no-repeat` }
function clearPartyBG(){ const sec=$('#party-battle'); if(sec) sec.style.background='' }

// ====== 退場 ======
function leavePartyBattle(){
  Party.roster.forEach(c=> c.hp=c.max);
  Party.currentStage=null; saveParty();
  clearPartyBG(); goto('party-select'); refreshPartySelect();
}

// ====== 進捗UI ======
function refreshPartySelect(){
  Object.values(STAGE).forEach(st=>{
    const el=$(`#${PROG_ID[st.key]}`); if(el) el.textContent = `0/${st.battles}`;
  });
  // 右ペインの簡易情報（必要ならここで拡張）
}

// ====== 宝箱 ======
function rollChest(){
  const r=Math.random();
  if(r<0.6) return 'white';
  if(r<0.8) return 'blue';
  if(r<0.9) return 'yellow';
  return null;
}
function showPartyResultScreen(stageKey){
  goto('party-result');
  const st=STAGE[stageKey];
  $('#partyResultStageName').textContent = `${st.name} クリア！（パーティ）`;
  $('#partyResultXp').textContent       = `経験値 +${PReward.xp}`;

  const area=$('#partyChestArea'); if(area) area.innerHTML='';
  PReward.chests.forEach(type=>{
    const img=document.createElement('img');
    img.className='result-chest'; img.dataset.type=type; img.dataset.opened='false';
    img.src = type==='white' ? 'white_chest_closed.png'
          : type==='blueSparkle' ? 'blue_sparkle_closed.png'
          : type==='yellow' ? 'yellow_chest_closed.png'
          : 'blue_chest_closed.png';
    if(type==='blueSparkle') img.classList.add('sparkle');
    img.onclick=()=> openPartyChest(img,type);
    area?.appendChild(img);
  });
  const list=$('#partyRewardList'); if(list) list.innerHTML='';
}
function openPartyChest(el,type){
  if(el.dataset.opened==='true') return;
  el.dataset.opened='true';
  el.src = (type==='white') ? 'white_chest_open.png'
        : (type==='blueSparkle') ? 'blue_sparkle_open.png'
        : (type==='yellow') ? 'yellow_chest_open.png'
        : 'blue_chest_open.png';
  const { label } = partyChestContent(type);
  const li=document.createElement('li'); li.textContent=label; $('#partyRewardList')?.appendChild(li);
  saveParty();
}
function openAllPartyChests(){ $$('#partyChestArea img').forEach(img=>{ if(img.dataset.opened==='false') openPartyChest(img, img.dataset.type) }) }
function finishPartyResult(){
  Party.currentStage=null; saveParty();
  clearPartyBG(); goto('party-select'); refreshPartySelect();
  PStage=null; PSquad=null; PReward=null;
}

// 黄色まで（パーティ専用装備インベントリに加算）
function partyChestContent(type){
  const e=Party.equip; const r=Math.random()*100;
  if(type==='white'){
    if(r<50){ e.ironSword++; return {label:'鉄の剣（パーティ）'}; }
    if(r<90){ e.ironShield++; return {label:'鉄の盾（パーティ）'}; }
    e.ironSword++; return {label:'鉄の剣（パーティ）'};
  }
  if(type==='blue'){
    if(r<50){ e.blueSword++; return {label:'蒼鉄の剣'}; }
    if(r<90){ e.blueShield++; return {label:'蒼鉄の盾'}; }
    e.blueShield++; return {label:'蒼鉄の盾'};
  }
  if(type==='blueSparkle'){
    if(r<70){ e.dragonSword++; return {label:'ドラゴンの剣'}; }
    else { e.blueShield++; return {label:'蒼鉄の盾'}; }
  }
  if(type==='yellow'){
    if(r<50){ e.sol++; return {label:'ソル'}; }
    else { e.regalia++; return {label:'レガリア'}; }
  }
  return {label:'何もなし'};
}

// ====== スキル一覧（モーダル） ======
function fillSkillLists(){
  const A=Party.roster;
  const lists=[['#p1SkillList',A[0]], ['#p2SkillList',A[1]], ['#p3SkillList',A[2]]];
  for(const [sel, ch] of lists){
    const box=$(sel); if(!box) continue; box.innerHTML='';
    for(let i=1;i<=6;i++){
      const s=ch.skills[i];
      const item=document.createElement('div'); item.className='item';
      const desc = (s.heal!=null) ? `回復 ${s.heal} + 役割補正`
                 : (s.guard!=null)? `ガード ${s.guard} + 役割/装備`
                 : `ダメージ ${s.dmg} + 攻撃`;
      item.innerHTML=`<span>${i}：${s.name}</span><span>${desc}</span>`;
      box.appendChild(item);
    }
  }
  // 敵（参考）
  const ebox=$('#partyEnemySkillList'); if(ebox){ ebox.innerHTML='';
    if(PSquad){
      const unique = {}; // 重複名は1回だけ表示
      for(const e of PSquad){
        for(let i=1;i<=6;i++){
          const s=e.skills[i]; const key=e.name+'_'+s.name+'_'+i;
          if(unique[key]) continue; unique[key]=1;
          const item=document.createElement('div'); item.className='item';
          item.innerHTML=`<span>${e.name}：${i} ${s.name}</span><span>ダメージ ${s.dmg}</span>`;
          ebox.appendChild(item);
        }
      }
    }
  }
}

// ====== アイテム（今回は閲覧のみ） ======
function openPartyItems(){
  const list=$('#partyItemList'); if(list){
    list.innerHTML='';
    if(!Party.items || Object.keys(Party.items).length===0){
      const div=document.createElement('div'); div.className='item';
      div.innerHTML='<span>（所持アイテムなし）</span><span>-</span>'; list.appendChild(div);
    }else{
      for(const [k,v] of Object.entries(Party.items)){
        const div=document.createElement('div'); div.className='item';
        div.innerHTML=`<span>${k}</span><span>残り ${v}</span>`;
        list.appendChild(div);
      }
    }
  }
  const m=$('#partyItemModal'); if(m){ m.hidden=false; m.classList.add('show'); }
}

// ====== ユーティリティ ======
function roll1to6(){ return Math.floor(Math.random()*6)+1 }

// ====== 初期化 ======
function partyInit(){
  loadParty(); syncFromSolo(); refreshPartySelect();
  // 速度はソロと共通UI（#speedSel）を利用
  const sp=$('#speedSel'); if(sp){ sp.addEventListener('change',(e)=>{ ptTiming={...SPEEDS[e.target.value||'normal']}; Party.settings.speed=e.target.value; saveParty(); }) }
}
partyInit();

})(); 
