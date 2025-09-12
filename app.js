// =====================================================
// BatoDice – app.js（Lv20 / St10 / Dragon実装）
// 画像想定：stage1〜10.png、各敵png、white_chest_*、blue_chest_*、blue_sparkle_*、1.png〜6.png ほか
// =====================================================

// ------------------ 定数・ユーティリティ ------------------
const MAX_LEVEL = 20; // ← Lv20まで
const SPEEDS = {
  fast:   { dice:450, pause:320, enemyPause:420 },
  normal: { dice:700, pause:420, enemyPause:520 },
  slow:   { dice:950, pause:520, enemyPause:620 }
};
let timing = { ...SPEEDS.normal };

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const pct=(v,tot)=>Math.round((v/tot)*100);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const $ = s=>document.querySelector(s);

// ------------------ レベルテーブル（自動生成：二乗成長） ------------------
// 累計XPしきい値： (次Lv)^2 をUI用に、到達しきい値： Lv^2 をLEVEL_TABLEに
const ATK_UP_LEVELS = [2,4,7,10,13,16,19]; // 既存傾向を継続
const LEVEL_TABLE = {}; // { L: {xp: 累計到達しきい値(=L^2), hp:+2, atk:0/1} }
const XP_TABLE = {};    // UI表示用：{ 現在Lv: 次Lvに必要な累計(=(Lv+1)^2) }

for (let lv=2; lv<=MAX_LEVEL; lv++){
  LEVEL_TABLE[lv] = {
    xp: lv*lv,
    hp: 2,
    atk: ATK_UP_LEVELS.includes(lv) ? 1 : 0
  };
}
for (let lv=1; lv<MAX_LEVEL; lv++){
  XP_TABLE[lv] = (lv+1)*(lv+1);
}

// ------------------ 装備 ------------------
const EQUIP_BOOK = {
  ironSword:   {slot:'weapon', name:'鉄の剣',     atk:1},
  leatherArmor:{slot:'armor',  name:'革の鎧',     hp:5},
  dragonSword: {slot:'weapon', name:'ドラゴンの剣', atk:3} // ★ドラゴン専用級
};

// ------------------ デフォ技 ------------------
const DEFAULT_SKILLS = {
  1:{name:'つつき',dmg:1}, 2:{name:'つつき',dmg:1},
  3:{name:'きりさく',dmg:2}, 4:{name:'きりさく',dmg:2},
  5:{name:'スラッシュ',dmg:3}, 6:{name:'スラッシュ',dmg:3}
};

// ------------------ 敵図鑑 ------------------
const ENEMY_BOOK = {
  // st1 草原：入門
  slime: { key:'slime', name:'スライム', img:'スライム.png', max:8,
    skills:{1:{name:'ぺちぺち',dmg:1},2:{name:'ぺちぺち',dmg:1},3:{name:'ぺちぺち',dmg:1},4:{name:'のしかかり',dmg:2},5:{name:'のしかかり',dmg:2},6:{name:'どろ弾（強）',dmg:2}},
    xp:1, chest:{ rate:0.35, white:0.95 }
  },
  mutant: { key:'mutant', name:'変異スライム', img:'スライム1.png', max:12,
    skills:{1:{name:'ぽよん防御',dmg:1},2:{name:'ぽよん防御',dmg:1},3:{name:'のしかかり',dmg:2},4:{name:'のしかかり',dmg:2},5:{name:'硬化',dmg:2},6:{name:'硬化（強）',dmg:2}},
    xp:2, chest:{ rate:0.40, white:0.70 }
  },
  // st2 森
  mushroom: { key:'mushroom', name:'キノコ', img:'キノコ.png', max:13,
    skills:{1:{name:'胞子',dmg:1},2:{name:'胞子',dmg:1},3:{name:'柄打ち',dmg:2},4:{name:'柄打ち',dmg:2},5:{name:'毒胞子',dmg:2},6:{name:'毒胞子（強）',dmg:3}},
    xp:2, chest:{ rate:0.45, white:0.80 }
  },
  // st3 湖畔
  waterSlime: { key:'waterSlime', name:'水スライム', img:'水スライム.png', max:12,
    skills:{1:{name:'水しぶき',dmg:1},2:{name:'水しぶき',dmg:1},3:{name:'水弾',dmg:2},4:{name:'水弾',dmg:2},5:{name:'水流タックル',dmg:2},6:{name:'渦打ち',dmg:3}},
    xp:2, chest:{ rate:0.50, white:0.75 }
  },
  frog: { key:'frog', name:'カエル', img:'カエル.png', max:14,
    skills:{1:{name:'舌ペチ',dmg:2},2:{name:'舌ペチ',dmg:2},3:{name:'跳び蹴り',dmg:2},4:{name:'跳び蹴り',dmg:3},5:{name:'毒舌',dmg:3},6:{name:'体当たり',dmg:4}},
    xp:3, chest:{ rate:0.60, white:0.70 }
  },
  // st4 洞窟
  bat: { key:'bat', name:'コウモリ', img:'コウモリ.png', max:16,
    skills:{1:{name:'噛みつき',dmg:2},2:{name:'噛みつき',dmg:2},3:{name:'急降下',dmg:2},4:{name:'急降下',dmg:3},5:{name:'超音波',dmg:3},6:{name:'狂乱連撃',dmg:4}},
    xp:3, chest:{ rate:0.55, white:0.65 }
  },
  smallGolem: { key:'smallGolem', name:'小ゴーレム', img:'小ゴーレム.png', max:20,
    skills:{1:{name:'岩拳',dmg:2},2:{name:'岩拳',dmg:2},3:{name:'瓦礫投げ',dmg:3},4:{name:'瓦礫投げ',dmg:3},5:{name:'地響き',dmg:4},6:{name:'地割れ',dmg:5}},
    xp:4, chest:{ rate:0.60, white:0.60 }
  },
  // st5 廃墟（中ボス）
  ruinsGuardian: {
    key:'ruinsGuardian', name:'廃墟守護者', img:'廃墟守護者.png', max:30,
    skills:{1:{name:'斬撃',dmg:3},2:{name:'盾打ち',dmg:3},3:{name:'呪詛紋',dmg:4},4:{name:'魔力砲',dmg:5},5:{name:'魔力砲・強',dmg:6},6:{name:'粛清光',dmg:7}},
    passive:{ name:'鉄壁の守り', desc:'被ダメージ-1（最低1保証）' },
    xp:7, chest:{ rate:1.00, white:0.30 } // 何かは確定
  },

  // ===== 新規：st6〜st9 =====
  // st6 火山
  fireLizard: { key:'fireLizard', name:'火トカゲ', img:'火トカゲ.png', max:22,
    skills:{1:{name:'噛みつき',dmg:2},2:{name:'尻尾打ち',dmg:2},3:{name:'火花',dmg:3},4:{name:'火花',dmg:3},5:{name:'火炎吐き',dmg:4},6:{name:'火炎吐き・強',dmg:5}},
    xp:4, chest:{ rate:0.65, white:0.55 }
  },
  magmaGolem: { key:'magmaGolem', name:'マグマゴーレム', img:'マグマゴーレム.png', max:26,
    skills:{1:{name:'溶岩拳',dmg:2},2:{name:'溶岩拳',dmg:3},3:{name:'岩塊投げ',dmg:3},4:{name:'岩塊投げ',dmg:4},5:{name:'灼熱',dmg:5},6:{name:'噴火',dmg:6}},
    xp:5, chest:{ rate:0.70, white:0.45 }
  },
  // st7 氷の洞窟
  iceSlime: { key:'iceSlime', name:'氷スライム', img:'氷スライム.png', max:22,
    skills:{1:{name:'冷気',dmg:2},2:{name:'冷気',dmg:2},3:{name:'氷弾',dmg:3},4:{name:'氷弾',dmg:3},5:{name:'氷槍',dmg:4},6:{name:'氷槍（強）',dmg:5}},
    xp:4, chest:{ rate:0.65, white:0.55 }
  },
  yeti: { key:'yeti', name:'雪男', img:'雪男.png', max:28,
    skills:{1:{name:'叩きつけ',dmg:2},2:{name:'叩きつけ',dmg:3},3:{name:'吹雪',dmg:3},4:{name:'吹雪',dmg:4},5:{name:'氷砕',dmg:5},6:{name:'猛威',dmg:6}},
    xp:5, chest:{ rate:0.72, white:0.45 }
  },
  // st8 砂漠
  scorpion: { key:'scorpion', name:'サソリ', img:'サソリ.png', max:26,
    skills:{1:{name:'はさみ',dmg:2},2:{name:'はさみ',dmg:3},3:{name:'毒針',dmg:3},4:{name:'毒針',dmg:4},5:{name:'連続刺し',dmg:4},6:{name:'猛毒刺し',dmg:5}},
    xp:5, chest:{ rate:0.75, white:0.42 }
  },
  mummy: { key:'mummy', name:'ミイラ', img:'ミイラ.png', max:30,
    skills:{1:{name:'包帯締め',dmg:2},2:{name:'包帯締め',dmg:3},3:{name:'呪詛',dmg:3},4:{name:'呪詛',dmg:4},5:{name:'呪縛',dmg:5},6:{name:'災厄',dmg:6}},
    xp:6, chest:{ rate:0.78, white:0.40 }
  },
  // st9 天空城
  angelSoldier: { key:'angelSoldier', name:'天使兵', img:'天使兵.png', max:32,
    skills:{1:{name:'斬撃',dmg:3},2:{name:'斬撃',dmg:3},3:{name:'光弾',dmg:4},4:{name:'光弾',dmg:4},5:{name:'裁き',dmg:5},6:{name:'聖光',dmg:6}},
    xp:6, chest:{ rate:0.80, white:0.35 }
  },
  gargoyle: { key:'gargoyle', name:'ガーゴイル', img:'ガーゴイル.png', max:34,
    skills:{1:{name:'爪撃',dmg:3},2:{name:'爪撃',dmg:3},3:{name:'尾撃',dmg:4},4:{name:'尾撃',dmg:4},5:{name:'石化打',dmg:5},6:{name:'怒涛',dmg:6}},
    xp:7, chest:{ rate:0.82, white:0.33 }
  },

  // ===== st10 ドラゴン（大ボス） =====
  dragon: {
    key:'dragon', name:'ドラゴン', img:'ドラゴン.png', max:60,
    // ターン期待値を高め（終盤ボス）
    skills:{1:{name:'爪撃',dmg:4},2:{name:'尾撃',dmg:4},3:{name:'咆哮',dmg:5},4:{name:'ブレス',dmg:6},5:{name:'紅蓮ブレス',dmg:7},6:{name:'滅炎',dmg:8}},
    passive:{ name:'逆鱗', desc:'コンボ無効化＆被ダメージ-1（最低1）' },
    xp:12,
    // ★キラキラ青宝箱を確定（assets: blue_sparkle_closed.png / blue_sparkle_open.png）
    chest:{ rate:1.00, blueSparkle:1.00 }
  }
};

// ------------------ ステージ図鑑 ------------------
const STAGE_BOOK = {
  // 既存
  st1:{ key:'st1', name:'草原', bg:'stage1.png', battles:3,
    pool:[{key:'slime',w:60},{key:'mutant',w:40}], xp:2 },
  st2:{ key:'st2', name:'森', bg:'stage2.png', battles:3,
    pool:[{key:'slime',w:40},{key:'mutant',w:30},{key:'mushroom',w:30}], xp:3 },
  st3:{ key:'st3', name:'湖畔', bg:'stage3.png', battles:3,
    pool:[{key:'waterSlime',w:60},{key:'frog',w:40}], xp:4 },
  st4:{ key:'st4', name:'洞窟', bg:'stage4.png', battles:3,
    pool:[{key:'bat',w:50},{key:'smallGolem',w:50}], xp:5 },
  st5:{ key:'st5', name:'廃墟', bg:'stage5.png', battles:2,
    pool:[{key:'bat',w:60},{key:'smallGolem',w:40}], boss:'ruinsGuardian', xp:6 },
  // 新規
  st6:{ key:'st6', name:'火山', bg:'stage6.png', battles:3,
    pool:[{key:'fireLizard',w:55},{key:'magmaGolem',w:45}], xp:7 },
  st7:{ key:'st7', name:'氷の洞窟', bg:'stage7.png', battles:3,
    pool:[{key:'iceSlime',w:55},{key:'yeti',w:45}], xp:8 },
  st8:{ key:'st8', name:'砂漠', bg:'stage8.png', battles:3,
    pool:[{key:'scorpion',w:55},{key:'mummy',w:45}], xp:9 },
  st9:{ key:'st9', name:'天空城', bg:'stage9.png', battles:3,
    pool:[{key:'angelSoldier',w:55},{key:'gargoyle',w:45}], xp:10 },
  st10:{ key:'st10', name:'竜の間', bg:'stage10.png', battles:1,
    pool:[{key:'dragon',w:1}], boss:'dragon', xp:12 }
};

// ------------------ ゲーム状態 ------------------
let Game = {
  player:{
    name:'勇者A', lvl:1, xp:0, atk:0,
    baseMax:20, max:20, hp:20,
    skills:JSON.parse(JSON.stringify(DEFAULT_SKILLS)),
    items:{ potion:3, megaPotion:0 }, // ★HP+10アイテム
    equip:{ weapon:null, armor:null },
    equipFaces:{},
    box:{ ironSword:0, dragonSword:0 }
  },
  progress:{
    kills:{
      slime:0,mutant:0,mushroom:0,waterSlime:0,frog:0,bat:0,
      smallGolem:0,ruinsGuardian:0,
      fireLizard:0,magmaGolem:0,iceSlime:0,yeti:0,scorpion:0,mummy:0,angelSoldier:0,gargoyle:0,dragon:0
    },
    unlock:{}
  }
};

// ------------------ ルーター ------------------
function goto(id){
  document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
function gotoStage(stageKey){
  if(STAGE_BOOK[stageKey]){
    startStage(stageKey);
  }else{
    startBattle(stageKey);
    goto('battle');
  }
}

// ------------------ ステージ進行 ------------------
let StageCP = null;
let Stage = null;
let StageReward = { xp:0, chests:[], items:[], equips:[] };

function startStage(stageKey){
  const stage = STAGE_BOOK[stageKey];
  if(!stage) return;

  StageCP = JSON.parse(JSON.stringify(Game));
  Game.currentStage = stageKey;
  Game.currentBattle = 0;
  Stage = { id: stageKey, remain: stage.battles, cleared: false };

  setStageProgress(stageKey, 0, stage.battles);
  applyStageBG(stage.bg);

  $('#winOverlay').classList.remove('show');
  $('#winOverlay').hidden = true;

  nextBattle();
}

function nextBattle(){
  const stage = STAGE_BOOK[Game.currentStage];
  if(!stage) return;

  let enemyKey;
  if (stage.boss && Stage.remain===1){
    enemyKey = stage.boss;
  }else{
    enemyKey = pickEnemy(stage.pool);
  }
  startBattle(enemyKey);
  buildSkillTbl(E.skills, 'e');
  goto('battle');
}

function setStageProgress(stageKey, cleared, total){
  const el = document.getElementById(`prog_${stageKey}`);
  if(el) el.textContent = `${cleared}/${total}`;
}

function pickEnemy(pool){
  let total = pool.reduce((a,b)=>a+b.w,0);
  let r = Math.random() * total;
  for(const e of pool){
    if(r < e.w) return e.key;
    r -= e.w;
  }
  return pool[0].key;
}

function leaveBattle(){
  if (Game.currentStage && StageCP){
    Game = JSON.parse(JSON.stringify(StageCP));
    Game.player.hp = Game.player.max;
    Game.currentStage = null;
    Stage = null;
    StageCP = null;
    StageReward = { xp:0, chests:[], items:[], equips:[] };

    applyDerivedStats();
    P.max = Game.player.max; 
    P.hp  = Game.player.max; 
    setHp('P');

    for(const k of Object.keys(STAGE_BOOK)){
      const tot = STAGE_BOOK[k].battles;
      setStageProgress(k, 0, tot);
    }
    clearStageBG();

    saveGame();
    goto('select');
    refreshSelect();
    return;
  }
  goto('select');
  refreshSelect();
}

// ------------------ SAVE / LOAD ------------------
const SAVE_KEY='batoDiceSaveV2';
function saveGame(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(Game)) }catch(e){} }
function loadGame(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(raw){
      const g=JSON.parse(raw);
      if(g?.player && g?.progress){ Game=g }
    }
  }catch(e){}
}
function resetSave(andStay){
  Game = { 
    player:{
      name:'勇者A', lvl:1, xp:0, atk:0,
      baseMax:20, max:20, hp:20,
      skills:JSON.parse(JSON.stringify(DEFAULT_SKILLS)),
      items:{potion:3, megaPotion:0}, equip:{weapon:null,armor:null},
      equipFaces:{}, box:{ironSword:0, dragonSword:0}
    },
    progress:{
      kills:{
        slime:0,mutant:0,mushroom:0,waterSlime:0,frog:0,bat:0,
        smallGolem:0,ruinsGuardian:0,
        fireLizard:0,magmaGolem:0,iceSlime:0,yeti:0,scorpion:0,mummy:0,angelSoldier:0,gargoyle:0,dragon:0
      },
      unlock:{}
    }
  };
  localStorage.removeItem(SAVE_KEY);
  resetEquipFaces();
  saveGame(); refreshSelect(); clearStageBG();

  const btn = document.querySelector('.homeBtns .btn.ghost');
  if(btn){
    btn.textContent = "初期化完了！"; btn.disabled = true;
    setTimeout(()=>{ btn.textContent="セーブ初期化"; btn.disabled=false }, 2000);
  }
  if(andStay){ goto('home') }
}
window.resetSave = resetSave;

// ------------------ SELECT UI ------------------
function refreshSelect(){
  $('#plName').textContent = Game.player.name;
  $('#plLv').textContent   = Game.player.lvl;
  $('#plXp').textContent   = Game.player.xp;
  $('#plHp').textContent   = Game.player.hp;
  $('#plMax').textContent  = Game.player.max;
  $('#plAtk').textContent  = Game.player.atk;

  const needXp = XP_TABLE[Game.player.lvl];
  let xpText = "";
  if(needXp){
    const remain = Math.max(0, needXp - Game.player.xp);
    xpText = `（次Lvまで残り ${remain} xp）`;
  } else {
    xpText = "(最大レベル)";
  }
  $('#plXp').textContent = `${Game.player.xp} ${xpText}`;

  // 右ペインの装備/アイテム欄を非表示にする場合は以下のまま
  const equipRow = document.getElementById('equipBadges');
  const itemRow  = document.getElementById('plItems');
  if(equipRow) equipRow.parentElement.style.display = "none";
  if(itemRow)  itemRow.parentElement.style.display  = "none";

  saveGame();
}

function openItems(){
  renderItems();
  const m=document.getElementById('itemModal');
  m.hidden=false; m.classList.add('show');
}

function openEquip(){
  const m=document.getElementById('equipFaceModal');
  m.hidden=false; m.classList.add('show');
  document.getElementById('equipFaceTitle').textContent = "出目を選択してください";
  document.getElementById('equipOptions').style.display = 'none';
}

function equipItem(key){
  const e=EQUIP_BOOK[key];
  Game.player.equip[e.slot]=key;
  applyDerivedStats();
  refreshSelect(); saveGame();
}

// ------------------ BATTLE STATE ------------------
let currentEnemyKey=null;
const P = { name:'勇者A', baseMax:20, max:20, hp:20, atk:0, hist:[], finisher:false, skills:JSON.parse(JSON.stringify(DEFAULT_SKILLS)) };
const E = { key:'slime', name:'スライム', max:10, hp:10, img:'スライム.png', skills: ENEMY_BOOK.slime.skills, hist:[] };

let rolledP=null, rolledE=null, phase='ready', busy=false;

// DOMキャッシュ
const hpP=$('#hpP'), hpE=$('#hpE');
const cardP=$('#cardP'), cardE=$('#cardE');
const ribP=$('#ribbonP'), ribPText=$('#ribbonPText');
const ribE=$('#ribbonE'), ribEText=$('#ribbonEText');
const logpre=$('#logpre');
const allyChips=$('#allyChips'), enemyChips=$('#enemyChips');
const btnRoll=$('#btnRoll'), btnAct=$('#btnAct'), actLabel=$('#actLabel');
const winOverlay=$('#winOverlay');
const nameP=$('#nameP'), nameE=$('#nameE');

const btnSettings=$('#btnSettings');
const settingsModal=$('#settingsModal');
const closeSettings=$('#closeSettings');
const applySettings=$('#applySettings');
const speedSel=$('#speedSel');
const pName=$('#pName'), pMax=$('#pMax'), pTbl=$('#pSkillsTbl');
const eName=$('#eName'), eMax=$('#eMax'), eTbl=$('#eSkillsTbl');

// audio（任意）
const audioBgm = document.createElement('audio'); audioBgm.id='bgm'; audioBgm.loop=true;
const audioWin = document.createElement('audio'); audioWin.id='winbgm'; audioWin.loop=true;

// ====== 小ユーティリティ ======
function setHp(who){
  if(who==='P'){ hpP.style.width=pct(P.hp,P.max)+'%'; hpP.parentElement.classList.toggle('warn', P.hp/P.max<=.4); }
  else { hpE.style.width=pct(E.hp,E.max)+'%'; hpE.parentElement.classList.toggle('warn', E.hp/E.max<=.4); }
}
function pushChip(container,n,cls){
  const kids=[...container.children]; kids.forEach(c=>c.classList.remove('last'));
  if(kids.length>=3) container.removeChild(kids[0]);
  const el=document.createElement('div'); el.className='chip '+cls+' last'; el.textContent=n; container.appendChild(el);
}
function appendLog(side, n, name, dmg, remain){
  const span=document.createElement('span');
  span.className='t '+(side==='味'?'tA':'tE'); span.textContent=side;
  logpre.appendChild(document.createTextNode('\n')); logpre.appendChild(span);
  const dmgTxt = dmg!=null ? ` → <span class="red">-${dmg}</span>（残HP <span class="gray">${remain}</span>）` : '';
  logpre.insertAdjacentHTML('beforeend', `【${n}】 ${name}${dmgTxt}`);
  logpre.scrollTop=logpre.scrollHeight;
}
function showRibbon(who, text, ult=false){
  const rib = who==='P'? ribP : ribE; const t = who==='P'? ribPText : ribEText;
  t.textContent = text; rib.style.display='flex'; rib.classList.toggle('ult', ult);
  rib.classList.remove('show'); void rib.offsetWidth; rib.classList.add('show');
  setTimeout(()=>{ rib.style.display='none' }, 900);
}
function hitFX(card, dmg){
  const f=document.createElement('div'); f.className='flash'; f.style.zIndex=2; card.appendChild(f); setTimeout(()=>f.remove(),350);
  const d=document.createElement('div'); d.className='dmg'; d.textContent='-'+dmg; card.appendChild(d); setTimeout(()=>d.remove(),820);
  card.classList.remove('hitShake'); void card.offsetWidth; card.classList.add('hitShake');
}
function checkComboP(){
  if(P.hist.length<3) return null;
  const h = P.hist.slice(-3);
  if(h[0]===h[1] && h[1]===h[2]) return {type:'triple', label:'ゾロ目', bonus:5};
  if(h.includes(4) && h.includes(5) && h.includes(6)) return {type:'456', label:'4-5-6', bonus:3};
  return null;
}

// dice visuals
let rotX=0, rotY=0;
function spinDice(n){
  const dice=document.getElementById('dice');
  rotX += 360 * (2 + Math.floor(Math.random()*2));
  rotY += 360 * (2 + Math.floor(Math.random()*2));
  const FACE={1:{x:0,y:0},2:{x:90,y:0},3:{x:0,y:-90},4:{x:0,y:90},5:{x:-90,y:0},6:{x:0,y:180}};
  const base=FACE[n];
  dice.style.transform=`rotateX(${rotX+base.x}deg) rotateY(${rotY+base.y}deg)`;
}
function resetEquipFaces(){
  for(let i=1;i<=6;i++){
    const img = document.getElementById(`diceImg${i}`);
    if (img) img.src = `${i}.png`;
  }
  const faceMap = {1:'.front',2:'.bottom',3:'.right',4:'.left',5:'.topp',6:'.back'};
  for(let i=1;i<=6;i++){
    const el = document.querySelector(faceMap[i]);
    if (el) el.style.backgroundImage = `url("${i}.png")`;
  }
  if(Game.player) Game.player.equipFaces = {};
}

// ------------------ アイテム ------------------
const btnItem=$('#btnItem'), itemModal=$('#itemModal'), itemList=$('#itemList');
function renderItems(){
  itemList.innerHTML='';
  const items=Game.player.items;
  const addRow=(label,key,count)=>{
    const div=document.createElement('div'); div.className='item';
    div.innerHTML=`<span>${label}</span><span>残り ${count}</span>`;
    if(count>0){ const btn=document.createElement('button'); btn.className='pill2'; btn.textContent='使う'; btn.onclick=()=>useItem(key); div.appendChild(btn); }
    itemList.appendChild(div);
  };
  addRow('回復薬（HP+3）','potion',items.potion||0);
  addRow('超回復薬（HP+10）','megaPotion',items.megaPotion||0);
}
function useItem(type){
  const items=Game.player.items;
  if(items[type]<=0) return;
  if(type==='potion'){
    const heal=3; P.hp=clamp(P.hp+heal,0,P.max); setHp('P'); appendLog('味','-','回復薬を使用',null,`${P.hp}/${P.max}`);
  }else if(type==='megaPotion'){
    const heal=10; P.hp=clamp(P.hp+heal,0,P.max); setHp('P'); appendLog('味','-','超回復薬を使用',null,`${P.hp}/${P.max}`);
  }
  items[type]--; renderItems(); itemModal.classList.remove('show'); itemModal.hidden=true; saveGame();
}
btnItem.addEventListener('click',()=>{ renderItems(); itemModal.hidden=false; itemModal.classList.add('show'); });

function rollOneBase(){ return Math.floor(Math.random()*6)+1 }
function rollOne(){ return rollOneBase(); }

// ------------------ バトルコア ------------------
function startBattle(enemyKey){
  // sync player
  P.name=Game.player.name; P.baseMax=Game.player.baseMax; P.max=Game.player.max; P.hp=Math.min(Game.player.hp, P.max);
  P.atk=Game.player.atk; P.skills=JSON.parse(JSON.stringify(Game.player.skills));P.equipFaces = {...Game.player.equipFaces}; // ★これを追加！
  applyDerivedStats();

  // enemy
  currentEnemyKey=enemyKey;
  const T=ENEMY_BOOK[enemyKey];
  E.key=T.key; E.name=T.name; E.max=T.max; E.hp=T.max; E.img=T.img; E.skills=T.skills; E.hist=[];
  $('#imgE').src=E.img; $('#nameE').textContent=E.name; $('#eName').value=E.name; $('#eMax').value=E.max;

  // visuals
  resetBattle(true);
  logpre.textContent=`${E.name} が現れた！`;

  // 敵パッシブをUIに反映
  if (T.passive) {
    document.querySelector('#badgeE').textContent = 'パッシブ';
    const modal = document.getElementById('passiveE');
    modal.querySelector('h4').textContent = `パッシブ：${T.passive.name}`;
    modal.querySelector('p').textContent  = T.passive.desc;
    document.querySelector('#cardE .foot .pill').textContent = `パッシブ：${T.passive.name}`;
    document.querySelector('#cardE .foot .pill').disabled = false;
  } else {
    document.querySelector('#badgeE').textContent = '-';
    const modal = document.getElementById('passiveE');
    modal.querySelector('h4').textContent = 'パッシブ：-';
    modal.querySelector('p').textContent  = 'この敵にパッシブはありません';
    document.querySelector('#cardE .foot .pill').textContent = 'パッシブ：-';
    document.querySelector('#cardE .foot .pill').disabled = true;
  }
  document.querySelector('#badgeE').style.display = "none";
 }

 function applyDerivedStats(){
  let max = Game.player.baseMax;
  let atk = Game.player.atk;
  const wKey=Game.player.equip.weapon; const aKey=Game.player.equip.armor;
  if(wKey){ const w=EQUIP_BOOK[wKey]; atk += (w.atk||0); }
  if(aKey){ const a=EQUIP_BOOK[aKey]; max += (a.hp||0); }
  Game.player.max = max; Game.player.atk = atk;
  P.max=max; P.atk=atk; if(P.hp>max) P.hp=max;
 }

 function resetBattle(keepAudio=true){
  busy=false; phase='ready'; rolledP=null; rolledE=null; P.finisher=false;
  P.hist=[]; E.hist=[];
  setHp('P'); setHp('E'); nameP.textContent=P.name; nameE.textContent=E.name;
  $('#imgE').classList.remove('vanish'); winOverlay.classList.remove('show'); winOverlay.hidden=true;
  allyChips.innerHTML=''; enemyChips.innerHTML='';
  btnRoll.disabled=false; btnAct.disabled=true; actLabel.textContent='技';
  if(!keepAudio){ try{ audioBgm.pause(); audioWin.pause(); }catch(e){} }
 }

 btnRoll.addEventListener('click', async ()=>{
  if(phase!=='ready' || busy) return; busy=true; phase='rolled'; btnRoll.disabled=true; btnAct.disabled=true;
  const nP=rollOne(); rolledP=nP; spinDice(nP);

  P.hist.push(nP); if(P.hist.length>60) P.hist.shift();
  setTimeout(()=>{ pushChip(allyChips,nP,'ally') },1000);

  // 出目装備ボーナス
  let equipBonus = 0;
  if (P.equipFaces && P.equipFaces[nP]) {
    const key = P.equipFaces[nP];
    const equip = EQUIP_BOOK[key];
    if (equip?.atk) equipBonus += equip.atk;
  }

  // コンボ判定
  let comboBonus = 0;
  const combo=checkComboP();
  if(combo){ 
    P.finisher=true; 
    comboBonus = 2; 
    showRibbon('P',`コンボ成立！ ${combo.label}`,true); 
  }


  // 表示用（ドラゴンは後で無効化）
  const shownBase = P.skills[nP].dmg + P.atk + equipBonus + comboBonus;

  await wait(timing.pause+300);
  showRibbon('P',`技${nP}：${P.skills[nP].name}（${shownBase}）`, P.finisher);
  actLabel.textContent = (P.finisher? '必殺：':'技：') + `${P.skills[nP].name}（${shownBase}）`;
  await wait(timing.pause); btnAct.disabled=false; busy=false;
   });

   btnAct.addEventListener('click', async ()=>{
  if(phase!=='rolled' || busy) return; busy=true; phase='acting'; btnAct.disabled=true;

  // 出目に割り当てた装備ボーナス
  let bonus = 0;
  if (P.equipFaces && P.equipFaces[rolledP]) {
  const key = P.equipFaces[rolledP];
  const equip = EQUIP_BOOK[key];
  if (equip?.atk) bonus += equip.atk;
   }

  // コンボ（ドラゴンは無効化）
  let comboBonus = (P.finisher ? 2 : 0);
  if (E.key === 'dragon' && P.finisher){
    // 逆鱗：コンボ無効
    comboBonus = 0;
    showRibbon('E','逆鱗：コンボ無効！',true);
    P.finisher = false;
  }

  let dmgP = Math.max(0, P.skills[rolledP].dmg + P.atk + bonus + comboBonus);

  // パッシブ軽減
  if (E.key === 'ruinsGuardian') {
    dmgP = Math.max(1, dmgP - 1);
  }
  if (E.key === 'dragon') {
    dmgP = Math.max(1, dmgP - 1); // 逆鱗：常時-1（最低1）
  }

  E.hp = clamp(E.hp - dmgP, 0, E.max);
  hitFX(cardE, dmgP); setHp('E');
  appendLog('味', rolledP, (comboBonus? '必殺：':'')+P.skills[rolledP].name, dmgP, `${E.hp}/${E.max}`);
  actLabel.textContent='技';

  if(E.hp<=0){
    await wait(350); $('#imgE').classList.add('vanish'); await wait(800); handleWin(); return;
  }

  // 敵の手番
  await wait(timing.enemyPause);
  rolledE=rollOne(); spinDice(rolledE);
  setTimeout(()=>{ E.hist.push(rolledE); if(E.hist.length>3) E.hist.shift(); pushChip(enemyChips,rolledE,'enemy') },1000);
  await wait(timing.pause+300); showRibbon('E',`技${rolledE}：${E.skills[rolledE].name}`,false);
  await wait(timing.pause+500);

  const dmgE=Math.max(0, E.skills[rolledE].dmg);
  P.hp = clamp(P.hp - dmgE, 0, P.max);
  hitFX(cardP, dmgE); setHp('P'); appendLog('敵', rolledE, E.skills[rolledE].name, dmgE, `${P.hp}/${P.max}`);

  if(P.hp<=0){
    await wait(350);
    try{ audioBgm.pause() }catch(e){}
    winOverlay.querySelector('span').textContent='LOSE';
    winOverlay.hidden=false; winOverlay.classList.add('show');

    // 負けたらHP全快・ステージ中断
    Game.player.hp = Game.player.max;
    Game.currentStage = null;
    Stage = null;
    clearStageBG();
    saveGame();

    btnRoll.disabled=true; btnAct.disabled=true; busy=false;
    return;
  }

  phase='ready'; btnRoll.disabled=false; btnAct.disabled=true; busy=false;
 });

 function handleWin(){
  winOverlay.querySelector('span').textContent='WIN'; winOverlay.hidden=false; winOverlay.classList.add('show');

  Game.progress.kills[currentEnemyKey] = (Game.progress.kills[currentEnemyKey]||0) + 1;
  const gainXP = ENEMY_BOOK[currentEnemyKey].xp;
  StageReward.xp += gainXP;

  // 宝箱ドロップ
  const cfg = ENEMY_BOOK[currentEnemyKey].chest || { rate:0.5, white:0.8 };
  let chest = null;
  if (Math.random() < (cfg.rate ?? 0)) {
    if (cfg.blueSparkle) chest = 'blueSparkle';
    else chest = (Math.random() < (cfg.white ?? 0.8)) ? 'white' : 'blue';
  }
  if (chest) {
    StageReward.chests.push(chest);
    showChestDrop(chest);
  }

  Game.player.hp = clamp(P.hp, 1, Game.player.max);

  logpre.insertAdjacentHTML('beforeend',
    `\n—— 勝利！ 経験値+${gainXP} ${chest ? '/ 宝箱出現！' : ''}`);

  saveGame();

  setTimeout(()=>{
    if(Game.currentStage){
      const stage = STAGE_BOOK[Game.currentStage];

      Stage.remain -= 1;
      const cleared = stage.battles - Stage.remain;
      setStageProgress(Game.currentStage, cleared, stage.battles);

      if(Stage.remain > 0){
        nextBattle();
        goto('battle');
      }else{
        // クリア処理：XP反映、結果画面へ
        Stage.cleared = true;
        Game.player.hp = Game.player.max;
        Game.player.xp += StageReward.xp;

        // レベルアップ（Lv20まで）
        let leveled = false;
        for (let targetLv = Game.player.lvl + 1; targetLv <= MAX_LEVEL; targetLv++) {
          const req = LEVEL_TABLE[targetLv];
          if (!req) break;
          if (Game.player.xp >= req.xp) {
            Game.player.lvl = targetLv;
            Game.player.baseMax += req.hp;
            Game.player.atk     += req.atk;
            leveled = true;
          }
        }
        if (leveled) {
          applyDerivedStats();
          Game.player.hp = Game.player.max;
          P.hp = P.max;
          setHp('P');
        }

        logpre.insertAdjacentHTML('beforeend', `\n—— ${stage.name} クリア！ 報酬を獲得！ HP全回復！`);
        saveGame();
        showResultScreen(Game.currentStage);
      }
    }else{
      goto('select'); refreshSelect();
    }
  }, 900);
 }

 // 宝箱演出（敵カード中央）
 function showChestDrop(chestType){
  const enemyCard = document.getElementById('cardE');
  const rect = enemyCard.getBoundingClientRect();
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;

  const chestImg = document.createElement('img');
  chestImg.src = chestType==='white'
    ? 'white_chest_closed.png'
    : chestType==='blueSparkle'
      ? 'blue_sparkle_closed.png'
      : 'blue_chest_closed.png';
  if (chestType==='blueSparkle') chestImg.classList.add('sparkle');

  chestImg.className += ' chest-drop';
  chestImg.style.left = `${cx}px`;
  chestImg.style.top  = `${cy}px`;

  document.body.appendChild(chestImg);
  requestAnimationFrame(()=> chestImg.classList.add('show'));
  setTimeout(()=> chestImg.remove(), 1000);
 }

 // リザルト画面
 function showResultScreen(stageKey){
  goto('result');
  const stage = STAGE_BOOK[stageKey];
  $('#resultStageName').textContent = `${stage.name} クリア！`;
  $('#resultXp').textContent       = `経験値 +${StageReward.xp}`;

  const area = document.getElementById('chestArea');
  area.innerHTML = '';
  StageReward.chests.forEach(type => {
    const img = document.createElement('img');
    img.src = type==='white'
      ? 'white_chest_closed.png'
      : type==='blueSparkle'
        ? 'blue_sparkle_closed.png'
        : 'blue_chest_closed.png';
    if (type==='blueSparkle') img.classList.add('sparkle');

    img.className += ' result-chest';
    img.dataset.type = type;
    img.dataset.opened = 'false';
    img.onclick = () => openResultChest(img, type);
    area.appendChild(img);
  });

  document.getElementById('rewardList').innerHTML = '';
 }

 function openResultChest(el, type){
  if(el.dataset.opened === 'true') return;
  el.dataset.opened = 'true';
  el.src = (type==='white') ? 'white_chest_open.png'
        : (type==='blueSparkle') ? 'blue_sparkle_open.png'
        : 'blue_chest_open.png';

  let itemLabel = '';
  if(type==='white'){
    itemLabel = '回復薬';
    Game.player.items.potion = (Game.player.items.potion||0)+1;
  }else if(type==='blue'){
    itemLabel = '鉄の剣';
    Game.player.box.ironSword = (Game.player.box.ironSword||0)+1;
  }else if(type==='blueSparkle'){
    // ★ドラゴン専用キラキラ青：20% ドラゴンの剣(+3)、30% 超回復薬(HP+10)、残り50% 鉄の剣
    const r = Math.random();
    if (r < 0.20){
      itemLabel = 'ドラゴンの剣（攻撃+3）';
      Game.player.box.dragonSword = (Game.player.box.dragonSword||0)+1;
    } else if (r < 0.50){
      itemLabel = '超回復薬（HP+10）';
      Game.player.items.megaPotion = (Game.player.items.megaPotion||0)+1;
    } else {
      itemLabel = '鉄の剣';
      Game.player.box.ironSword = (Game.player.box.ironSword||0)+1;
    }
  }

  const li = document.createElement('li');
  li.textContent = itemLabel;
  document.getElementById('rewardList').appendChild(li);
  saveGame();
 }

 function openAllChests(){
  document.querySelectorAll('#chestArea img').forEach(img=>{
    if(img.dataset.opened === 'false'){
      openResultChest(img, img.dataset.type);
    }
  });
 }

 function finishResult(){
  const finishedStage = Game.currentStage;
  Game.currentStage = null;
  Stage = null;
  StageCP = null;

  for(const k of Object.keys(STAGE_BOOK)){
    const tot = STAGE_BOOK[k].battles;
    setStageProgress(k, 0, tot);
  }
  clearStageBG();

  StageReward = { xp:0, chests:[], items:[], equips:[] };

  goto('select');
  refreshSelect();
 } 

 // ============ 背景（ステージごと） ============
 function applyStageBG(bg){
  const sec = document.getElementById('battle');
  sec.style.background = `#000 url('${bg}') center/cover no-repeat`;
 }
 function clearStageBG(){
  const sec = document.getElementById('battle');
  sec.style.background = '';
 }
 
 // ------------------ 設定モーダル ------------------
btnSettings.addEventListener('click',()=>{
  speedSel.value='normal';
  pName.value=P.name; pMax.value=P.max; eName.value=E.name; eMax.value=E.max;
  pTbl.innerHTML = buildSkillTbl(P.skills,'p');
  eTbl.innerHTML = buildSkillTbl(E.skills,'e');
  settingsModal.hidden=false; settingsModal.classList.add('show');
  });
 closeSettings.addEventListener('click',()=>{ settingsModal.classList.remove('show'); settingsModal.hidden=true });
 applySettings.addEventListener('click',()=>{
  P.name=(pName.value||'勇者A').trim(); Game.player.name=P.name;
  Game.player.baseMax = Math.max(1, parseInt(pMax.value||20)); applyDerivedStats(); P.hp=P.max;
  P.skills = collectTbl('p'); Game.player.skills = JSON.parse(JSON.stringify(P.skills));
  E.name=(eName.value||E.name).trim(); E.max=Math.max(1, parseInt(eMax.value||E.max)); E.hp=E.max;
  E.skills = collectTbl('e');
  resetBattle(true);
  settingsModal.classList.remove('show'); settingsModal.hidden=true; saveGame();
 });

 function buildSkillTbl(skills, prefix){
  if(prefix==='p'){
    const list=document.getElementById('skillPList'); list.innerHTML='';
    for(let i=1;i<=6;i++){ const s=skills[i]||{name:`技${i}`,dmg:1};
      const row=document.createElement('div'); row.className='item';
      row.innerHTML=`<span>${i}：${s.name}</span><span>敵にダメージ${s.dmg} + 攻撃</span>`; list.appendChild(row);
    }
  }else{
    const list=document.getElementById('skillEList'); list.innerHTML='';
    for(let i=1;i<=6;i++){ const s=skills[i]||{name:`技${i}`,dmg:1};
      const row=document.createElement('div'); row.className='item';
      row.innerHTML=`<span>${i}：${s.name}</span><span>味方にダメージ${s.dmg}</span>`; list.appendChild(row);
    }
  }
  let html=''; for(let i=1;i<=6;i++){
    const s=skills[i]||{name:`技${i}`,dmg:1};
    html+=`<div class="cell"><div style="font-weight:700;margin-bottom:4px">${i}</div>
    <input id="${prefix}_name_${i}" class="txt" placeholder="技名" value="${s.name}">
    <div style="margin-top:4px"><input id="${prefix}_dmg_${i}" class="num" type="number" min="0" value="${s.dmg}"></div></div>`;
  }
  return html;
 }
 function collectTbl(prefix){
  const out={}; for(let i=1;i<=6;i++){
    const nm=(document.getElementById(prefix+'_name_'+i)?.value||`技${i}`).trim();
    const dm=Math.max(0, parseInt(document.getElementById(prefix+'_dmg_'+i)?.value||0));
    out[i]={name:nm,dmg:dm};
  }
  buildSkillTbl(out, prefix); return out;
 }

 // ------------------ EQUIP FACE（出目割当） ------------------
 function restoreEquipFaces(){
  if(!Game.player.equipFaces) return;
  const faceMap = { 1:'.front', 2:'.bottom', 3:'.right', 4:'.left', 5:'.topp', 6:'.back' };
  for(const [face, key] of Object.entries(Game.player.equipFaces)){
    const img = document.getElementById(`diceImg${face}`);
    if (img) img.src = `dice_${key}${face}.png`; // 例：dice_dragonSword3.png
    const selector = faceMap[face];
    if (selector) {
      const el = document.querySelector(selector);
      if (el) el.style.backgroundImage = `url("dice_${key}${face}.png")`;
    }
  }
 }
 let pendingFace=null;
 function chooseFace(face){
  pendingFace = face;
  const title = document.getElementById('equipFaceTitle');
  const area  = document.getElementById('equipButtons');
  const options = document.getElementById('equipOptions');

  title.textContent = `出目${face} に装備を割り当て`;
  area.innerHTML = '';

  const currentKey = Game.player.equipFaces?.[face];
  if (currentKey) {
    const equipName = EQUIP_BOOK[currentKey]?.name || '不明';
    area.insertAdjacentHTML('beforeend', `<div style="margin-bottom:8px;color:#bcd1ff">現在：${equipName} が装備されています</div>`);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'pill2 ghost';
    removeBtn.textContent = '装備を解除';
    removeBtn.onclick = () => {
      delete Game.player.equipFaces[face];
      saveGame(); refreshSelect();
      const img = document.getElementById(`diceImg${face}`); if (img) img.src = `${face}.png`;
      const fm = {1:'.front',2:'.bottom',3:'.right',4:'.left',5:'.topp',6:'.back'};
      const el = document.querySelector(fm[face]); if (el) el.style.backgroundImage = `url("${face}.png")`;
      alert(`出目${face} の装備を解除しました`);
      const m = document.getElementById('equipFaceModal'); m.classList.remove('show'); m.hidden = true;
    };
    area.appendChild(removeBtn);
  } else {
    area.insertAdjacentHTML('beforeend', `<div style="margin-bottom:8px;color:#bcd1ff">現在：装備なし</div>`);
  }

  const equipUsed = {};
  for (const usedKey of Object.values(Game.player.equipFaces || {})) {
    equipUsed[usedKey] = (equipUsed[usedKey] || 0) + 1;
  }
  for (const key of Object.keys(Game.player.box)) {
    const owned = Game.player.box[key] || 0;
    if (owned <= 0) continue;
    const used = equipUsed[key] || 0;
    const remain = owned - used;
    const name = EQUIP_BOOK[key]?.name || key;
    const label = `${name}（残り ${remain}）`;

    const btn = document.createElement('button');
    btn.className = 'pill2';
    btn.textContent = label;
    btn.disabled = remain <= 0;
    btn.onclick = () => assignEquipToFace(face, key);
    area.appendChild(btn);
  }

  options.style.display = 'block';
 }

 function assignEquipToFace(face, key){
  if (!Game.player.equipFaces) Game.player.equipFaces = {};
  Game.player.equipFaces[face] = key;
  saveGame(); refreshSelect();

  const img = document.getElementById(`diceImg${face}`);
  if (img) img.src = `dice_${key}${face}.png`;

  const faceMap = {1:'.front',2:'.bottom',3:'.right',4:'.left',5:'.topp',6:'.back'};
  const el = document.querySelector(faceMap[face]);
  if (el) el.style.backgroundImage = `url("dice_${key}${face}.png")`;

  alert(`出目${face} に ${EQUIP_BOOK[key].name} を装備しました！`);
  const m=document.getElementById('equipFaceModal'); m.classList.remove('show'); m.hidden=true;
  pendingFace = null;
 }

 // ------------------ INIT ------------------
 function init(){
  loadGame(); applyDerivedStats();
  document.querySelectorAll('.hp').forEach(hp=>{ if(!hp.querySelector('.ticks')){ const t=document.createElement('span'); t.className='ticks'; hp.appendChild(t); } });
  nameP.textContent=Game.player.name; setHp('P');
  for(const k of Object.keys(STAGE_BOOK)){
    setStageProgress(k, 0, STAGE_BOOK[k].battles);
  }
  refreshSelect();
  restoreEquipFaces();

  // モーダル共通open
  document.querySelectorAll('[data-open]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const targetSel = btn.getAttribute('data-open');
      if(targetSel){
        const modal = document.querySelector(targetSel);
        if(modal){ modal.hidden = false; modal.classList.add('show'); }
      }
    });
  });
  // モーダル共通close
  document.querySelectorAll('[data-close]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const modal = btn.closest('.modal');
      if(modal){ modal.classList.remove('show'); modal.hidden = true; }
    });
  });

  buildSkillTbl(P.skills, 'p');
 }
 init();

 // 速度切替（任意）
 document.getElementById('speedSel')?.addEventListener('change', (e)=>{
  const v = e.target.value || 'normal';
  timing = { ...SPEEDS[v] };
  });
