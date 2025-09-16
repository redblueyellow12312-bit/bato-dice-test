// =====================================================
// BatoDice – app.js（Lv30 / St1-20 / 中盤ギミック対応 + ソロ切替/ロスター連携）
// 画像想定：stage1〜20.png、各敵png、white_chest_*、blue_chest_*、blue_sparkle_*、yellow_chest_*、1.png〜6.pngほか
// ★修正点（要約）
//  - ソロの「ガロ＝ガード型」「ミナ＝回復型」スキルセットを導入（レオンは従来の攻撃）
//  - レベルアップで HP/ATK に加え、ガロは guardPower、ミナは healPower が上昇
//  - 杖装備（司祭/祝福）は「回復量+」に変更、盾は従来どおり「次被ダメ軽減」
//  - 技表示/設定UIのプレビューも回復/ガード値を表示
// =====================================================

// ------------------ 定数・ユーティリティ ------------------
const MAX_LEVEL = 30; // ★Lv30まで
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

// ==== JUICE PACK utils ====
// 画面シェイク
function camShake(targetId='battle'){
  const el = document.getElementById(targetId);
  if(!el) return;
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}
// スパーク粒子
function spawnSparks(card, count=8){
  const rect = card.getBoundingClientRect();
  for(let i=0;i<count;i++){
    const s = document.createElement('i'); s.className='spark';
    const ang = Math.random()*Math.PI*2;
    const pow = 24 + Math.random()*26;
    s.style.setProperty('--tx', `${Math.cos(ang)*pow}px`);
    s.style.setProperty('--ty', `${Math.sin(ang)*pow}px`);
    const cx = rect.width*0.5 + (Math.random()*20-10);
    const cy = rect.height*0.42 + (Math.random()*20-10);
    s.style.left = cx+'px'; s.style.top = cy+'px';
    card.appendChild(s); setTimeout(()=>s.remove(), 600);
  }
}
// ヒットストップ（ちょい間を持たせる）
async function hitStop(ms=110){ await wait(ms); }
// シネマバー ON/OFF（必殺/撃破時）
function cineOn(){ document.getElementById('battle')?.classList.add('cine'); }
function cineOff(){ document.getElementById('battle')?.classList.remove('cine'); }


// ------------------ レベルテーブル共通ヘルパ ------------------
const XP_TABLE = {};    // UI用：次レベルに必要な累計 (=(L+1)^2)
for (let lv=1; lv<MAX_LEVEL; lv++){ XP_TABLE[lv] = (lv+1)*(lv+1) }

// ★Lv成長：ATK/HPに加え、ガロ=guard、ミナ=heal
function buildLevelTable(atkUpLevels, guardUpLevels = [], healUpLevels = []){
  const T={};
  for(let lv=2; lv<=MAX_LEVEL; lv++){
    T[lv] = { 
      xp: lv*lv, 
      hp: (lv<=25?2:0), 
      atk: atkUpLevels.includes(lv)?1:0,
      guard: guardUpLevels.includes(lv)?1:0,
      heal: healUpLevels.includes(lv)?1:0
    };
  }
  return T;
}

// ★キャラ別のATK上昇レベル
const ATK_UP_LEON = [2,4,7,10,13,16,19,22,25,28,30];
const ATK_UP_GARO = [4,8,12,16,20,24,28,30];
const ATK_UP_MINA = [3,6,10,14,18,22,26,30];

// ★ガロ/ミナの役割成長レベル
const GUARD_UP_GARO = [4,8,12,16,20,24,28,30];
const HEAL_UP_MINA  = [3,6,10,14,18,22,26,30];

// ★キャラ別レベルテーブル
const LEVEL_TABLE_LEON = buildLevelTable(ATK_UP_LEON);
const LEVEL_TABLE_GARO = buildLevelTable(ATK_UP_GARO, GUARD_UP_GARO, []);
const LEVEL_TABLE_MINA = buildLevelTable(ATK_UP_MINA, [], HEAL_UP_MINA);

// ------------------ 装備（出目割り当て対応） ------------------
// 盾=次の被ダメ軽減一回（defOnce）、杖=回復量+（healPlus）に変更
const EQUIP_BOOK = {
  ironSword:    {slot:'face', name:'鉄の剣',       atk:1},
  ironShield:   {slot:'face', name:'鉄の盾',       defOnce:1},
  blueSword:    {slot:'face', name:'蒼鉄の剣',     atk:2},
  blueShield:   {slot:'face', name:'蒼鉄の盾',     defOnce:2},
  dragonSword:  {slot:'face', name:'ドラゴンの剣', atk:3},       // キラ青限定
  sol:          {slot:'face', name:'ソル',         atk:3},       // 黄
  regalia:      {slot:'face', name:'レガリア',     defOnce:3},   // 黄
  // 新規（ガロ＆ミナ用）
  scaleShield:  {slot:'face', name:'竜鱗の盾',     defOnce:3},   // キラ青（ガロ向け）
  priestStaff:  {slot:'face', name:'司祭の杖',     healPlus:1},  // 白（ミナ向け）
  blessedStaff: {slot:'face', name:'祝福の杖',     healPlus:2}   // 青（ミナ向け）
};

// --- キャラ画像マップ ---
const CHAR_ASSETS = {
  leon: { img:'勇者.jpg', label:'剣士レオン' },
  garo: { img:'ガロ.png', label:'盾騎士ガロ' },
  mina: { img:'ミナ.png', label:'僧侶ミナ' },
};

// --- アクティブキャラの画像をUIに反映（HTML変更不要） ---
function applyActiveCharVisuals(){
  const who = Game.activeChar || 'leon';
  const src = (CHAR_ASSETS[who]?.img) || CHAR_ASSETS.leon.img;

  // バトル画面の味方画像
  const battleImg = document.getElementById('imgP');
  if (battleImg) battleImg.src = src;

  // セレクト画面 右ペインのポートレート（1枚想定）
  const selImg = document.querySelector('#select .selRight img');
  if (selImg) selImg.src = src;
}

// ------------------ スキルセット（ソロ用） ------------------
// 既存 DEFAULT はフォールバックとして保持
const DEFAULT_SKILLS = {
  1:{name:'つつき',dmg:1}, 2:{name:'つつき',dmg:1},
  3:{name:'きりさく',dmg:2}, 4:{name:'きりさく',dmg:2},
  5:{name:'スラッシュ',dmg:3}, 6:{name:'スラッシュ',dmg:3}
};
// レオン：従来の攻撃型（そのまま）
const SKILLS_LEON = JSON.parse(JSON.stringify(DEFAULT_SKILLS));
// ガロ：ガード型（軽い打撃+ガード積み）
const SKILLS_GARO = {
  1:{name:'盾打ち',dmg:1},
  2:{name:'防御の構え',guard:1},
  3:{name:'中盾打ち',dmg:2},
  4:{name:'挑発の構え',guard:2},
  5:{name:'大盾打ち',dmg:3},
  6:{name:'鉄壁',guard:3}
};
// ミナ：回復型（一人旅なので単体回復のみでOK）
const SKILLS_MINA = {
  1:{name:'杖打ち',dmg:1},                 // 低ロールでも削れる
  2:{name:'小癒し',heal:2},
  3:{name:'祝福',heal:2,buffAtk:1},
  4:{name:'光線',dmg:2},
  5:{name:'大回復',heal:4},
  6:{name:'聖なる光',dmg:3}  
};

// ------------------ 状態管理（プレイヤー） ------------------
const PStatus = {
  poison:0,     // 1ダメ/ターン
  burn:0,       // 2ダメ/ターン
  curse:0,      // 攻撃-1（計算時に反映）
  guard:0,      // 次の被ダメ軽減（複数回分を合算可／消費は1回で全消費）
  atkBuff:0,    // 次の攻撃ダメージに+X（使用で0）
  trueSight:0   // 幽霊の回避-20%を無視（ターン数）
};

// ------------------ 敵図鑑（1〜20） ------------------
const ENEMY_BOOK = {
  // ===== 1〜5 既存 =====
  slime: { key:'slime', name:'スライム', img:'スライム.png', max:8,
    skills:{1:{name:'ぺちぺち',dmg:1},2:{name:'ぺちぺち',dmg:1},3:{name:'ぺちぺち',dmg:1},4:{name:'のしかかり',dmg:2},5:{name:'のしかかり',dmg:2},6:{name:'どろ弾（強）',dmg:2}},
    xp:1, chest:{ rate:0.35, white:0.95 }
  },
  mutant: { key:'mutant', name:'変異スライム', img:'スライム1.png', max:12,
    skills:{1:{name:'ぽよん防御',dmg:1},2:{name:'ぽよん防御',dmg:1},3:{name:'のしかかり',dmg:2},4:{name:'のしかかり',dmg:2},5:{name:'硬化',dmg:2},6:{name:'硬化（強）',dmg:2}},
    xp:2, chest:{ rate:0.40, white:0.70 }
  },
  mushroom: { key:'mushroom', name:'キノコ', img:'キノコ.png', max:13,
    skills:{1:{name:'胞子',dmg:1},2:{name:'胞子',dmg:1},3:{name:'柄打ち',dmg:2},4:{name:'柄打ち',dmg:2},5:{name:'毒胞子',dmg:2},6:{name:'毒胞子（強）',dmg:3}},
    xp:2, chest:{ rate:0.45, white:0.80 }
  },
  waterSlime: { key:'waterSlime', name:'水スライム', img:'水スライム.png', max:12,
    skills:{1:{name:'水しぶき',dmg:1},2:{name:'水しぶき',dmg:1},3:{name:'水弾',dmg:2},4:{name:'水弾',dmg:2},5:{name:'水流タックル',dmg:2},6:{name:'渦打ち',dmg:3}},
    xp:2, chest:{ rate:0.50, white:0.75 }
  },
  frog: { key:'frog', name:'カエル', img:'カエル.png', max:14,
    skills:{1:{name:'舌ペチ',dmg:2},2:{name:'舌ペチ',dmg:2},3:{name:'跳び蹴り',dmg:2},4:{name:'跳び蹴り',dmg:3},5:{name:'毒舌',dmg:3},6:{name:'体当たり',dmg:4}},
    xp:3, chest:{ rate:0.60, white:0.70 }
  },
  bat: { key:'bat', name:'コウモリ', img:'コウモリ.png', max:16,
    skills:{1:{name:'噛みつき',dmg:2},2:{name:'噛みつき',dmg:2},3:{name:'急降下',dmg:2},4:{name:'急降下',dmg:3},5:{name:'超音波',dmg:3},6:{name:'狂乱連撃',dmg:4}},
    xp:3, chest:{ rate:0.55, white:0.65 }
  },
  smallGolem: { key:'smallGolem', name:'小ゴーレム', img:'小ゴーレム.png', max:20,
    skills:{1:{name:'岩拳',dmg:2},2:{name:'岩拳',dmg:2},3:{name:'瓦礫投げ',dmg:3},4:{name:'瓦礫投げ',dmg:3},5:{name:'地響き',dmg:4},6:{name:'地割れ',dmg:5}},
    xp:4, chest:{ rate:0.60, white:0.60 }
  },
  ruinsGuardian: {
    key:'ruinsGuardian', name:'廃墟守護者', img:'廃墟守護者.png', max:30,
    skills:{1:{name:'斬撃',dmg:3},2:{name:'盾打ち',dmg:3},3:{name:'呪詛紋',dmg:4},4:{name:'魔力砲',dmg:5},5:{name:'魔力砲・強',dmg:6},6:{name:'粛清光',dmg:7}},
    passive:{ harden:1, label:'被ダメ-1（最低1）' },
    xp:7, chest:{ rate:1.00, white:0.30 }
  },

  // ===== 6〜9 =====
  fireLizard: { key:'fireLizard', name:'火トカゲ', img:'火トカゲ.png', max:22,
    skills:{1:{name:'噛みつき',dmg:2},2:{name:'尻尾打ち',dmg:2},3:{name:'火花',dmg:3},4:{name:'火花',dmg:3},5:{name:'火炎吐き',dmg:4},6:{name:'火炎吐き・強',dmg:5}},
    xp:4, chest:{ rate:0.65, white:0.55 }
  },
  magmaGolem: { key:'magmaGolem', name:'マグマゴーレム', img:'マグマゴーレム.png', max:26,
    skills:{1:{name:'溶岩拳',dmg:2},2:{name:'溶岩拳',dmg:3},3:{name:'岩塊投げ',dmg:3},4:{name:'岩塊投げ',dmg:4},5:{name:'灼熱',dmg:5},6:{name:'噴火',dmg:6}},
    xp:5, chest:{ rate:0.70, white:0.45 }
  },
  iceSlime: { key:'iceSlime', name:'氷スライム', img:'氷スライム.png', max:22,
    skills:{1:{name:'冷気',dmg:2},2:{name:'冷気',dmg:2},3:{name:'氷弾',dmg:3},4:{name:'氷弾',dmg:3},5:{name:'氷槍',dmg:4},6:{name:'氷槍（強）',dmg:5}},
    xp:4, chest:{ rate:0.65, white:0.55 }
  },
  yeti: { key:'yeti', name:'雪男', img:'雪男.png', max:28,
    skills:{1:{name:'叩きつけ',dmg:2},2:{name:'叩きつけ',dmg:3},3:{name:'吹雪',dmg:3},4:{name:'吹雪',dmg:4},5:{name:'氷砕',dmg:5},6:{name:'猛威',dmg:6}},
    xp:5, chest:{ rate:0.72, white:0.45 }
  },
  scorpion: { key:'scorpion', name:'サソリ', img:'サソリ.png', max:26,
    skills:{1:{name:'はさみ',dmg:2},2:{name:'はさみ',dmg:3},3:{name:'毒針',dmg:3},4:{name:'毒針',dmg:4},5:{name:'連続刺し',dmg:4},6:{name:'猛毒刺し',dmg:5}},
    xp:5, chest:{ rate:0.75, white:0.42 }
  },
  mummy: { key:'mummy', name:'ミイラ', img:'ミイラ.png', max:30,
    skills:{1:{name:'包帯締め',dmg:2},2:{name:'包帯締め',dmg:3},3:{name:'呪詛',dmg:3},4:{name:'呪詛',dmg:4},5:{name:'呪縛',dmg:5},6:{name:'災厄',dmg:6}},
    xp:6, chest:{ rate:0.78, white:0.40 }
  },
  angelSoldier: { key:'angelSoldier', name:'天使兵', img:'天使兵.png', max:32,
    skills:{1:{name:'斬撃',dmg:3},2:{name:'斬撃',dmg:3},3:{name:'光弾',dmg:4},4:{name:'光弾',dmg:4},5:{name:'裁き',dmg:5},6:{name:'聖光',dmg:6}},
    xp:6, chest:{ rate:0.80, white:0.35 }
  },
  gargoyle: { key:'gargoyle', name:'ガーゴイル', img:'ガーゴイル.png', max:34,
    skills:{1:{name:'爪撃',dmg:3},2:{name:'爪撃',dmg:3},3:{name:'尾撃',dmg:4},4:{name:'尾撃',dmg:4},5:{name:'石化打',dmg:5},6:{name:'怒涛',dmg:6}},
    xp:7, chest:{ rate:0.82, white:0.33 }
  },

  // ===== 10 ドラゴン（既存強化） =====
  dragon: {
    key:'dragon', name:'ドラゴン', img:'ドラゴン.png', max:60,
    skills:{1:{name:'爪撃',dmg:4},2:{name:'尾撃',dmg:4},3:{name:'咆哮',dmg:5},4:{name:'ブレス',dmg:6},5:{name:'紅蓮ブレス',dmg:7},6:{name:'滅炎',dmg:8}},
    passive:{ geirin:true, harden:1, label:'逆鱗（コンボ無効）＆被ダメ-1' },
    xp:12, chest:{ rate:1.00, blueSparkle:1.00 } // キラ青確定
  },

  // ===== 11〜20 中盤 =====
  ghost: { key:'ghost', name:'幽霊', img:'ghost.png', max:24,
    skills:{1:{name:'怨念',dmg:2},2:{name:'怨念',dmg:2},3:{name:'冷気',dmg:3},4:{name:'冷気',dmg:3},5:{name:'呪気',dmg:4},6:{name:'呪気・強',dmg:5}},
    passive:{ intangible:0.20, label:'半透明（被命中率-20%）' },
    xp:5, chest:{ rate:0.30, white:0.75 }
  },
  deathKnight: { key:'deathKnight', name:'デスナイト', img:'deathKnight.png', max:35,
    skills:{1:{name:'暗黒斬',dmg:3},2:{name:'暗黒斬',dmg:3},3:{name:'死の剣',dmg:4},4:{name:'死の剣',dmg:4},5:{name:'滅撃',dmg:5},6:{name:'滅撃・強',dmg:6}},
    passive:{ poisonOnHit:2, label:'攻撃時に毒付与（2T）' },
    xp:6, chest:{ rate:0.25, white:0.65 }
  },
  cerberus: { key:'cerberus', name:'ケルベロス', img:'cerberus.png', max:40,
    skills:{1:{name:'噛み裂き',dmg:3},2:{name:'噛み裂き',dmg:3},3:{name:'咆哮',dmg:4},4:{name:'炎牙',dmg:5},5:{name:'炎牙・強',dmg:6},6:{name:'連牙',dmg:7}},
    passive:{ doubleTurn:0.25, label:'低確率で2回行動' },
    xp:7, chest:{ rate:0.25, white:0.60 }
  },
  lich: { key:'lich', name:'リッチ', img:'lich.png', max:38,
    skills:{1:{name:'闇弾',dmg:3},2:{name:'闇弾',dmg:4},3:{name:'吸精',dmg:4},4:{name:'吸精',dmg:5},5:{name:'死霊術',dmg:6},6:{name:'冥府門',dmg:7}},
    passive:{ lifesteal:2, label:'攻撃時HP+2回復' },
    xp:7, chest:{ rate:0.30, white:0.65 }
  },
  golemEX: { key:'golemEX', name:'強化ゴーレム', img:'golem_strong.png', max:36,
    skills:{1:{name:'岩拳',dmg:2},2:{name:'岩拳',dmg:3},3:{name:'瓦礫投げ',dmg:4},4:{name:'瓦礫投げ',dmg:4},5:{name:'地響き',dmg:5},6:{name:'地割れ',dmg:6}},
    passive:{ harden:1, label:'被ダメ-1' },
    xp:7, chest:{ rate:0.25, white:0.60 }
  },
  griffon: { key:'griffon', name:'グリフォン', img:'griffon.png', max:42,
    skills:{1:{name:'爪撃',dmg:3},2:{name:'爪撃',dmg:3},3:{name:'急襲',dmg:4},4:{name:'急襲',dmg:5},5:{name:'旋風撃',dmg:6},6:{name:'暴風',dmg:7}},
    passive:{ preemptive:true, label:'初手先制攻撃' },
    xp:8, chest:{ rate:0.30, white:0.60 }
  },
  basilisk: { key:'basilisk', name:'バジリスク', img:'basilisk.png', max:45,
    skills:{1:{name:'尻尾打ち',dmg:3},2:{name:'噛みつき',dmg:4},3:{name:'毒牙',dmg:4},4:{name:'毒牙',dmg:5},5:{name:'連続打',dmg:6},6:{name:'猛毒牙',dmg:7}},
    passive:{ poisonOnHit:3, label:'攻撃時に毒付与（3T）' },
    xp:8, chest:{ rate:0.30, white:0.60 }
  },
  dragonewt: { key:'dragonewt', name:'ドラゴニュート', img:'dragonewt.png', max:48,
    skills:{1:{name:'竜撃',dmg:3},2:{name:'竜撃',dmg:4},3:{name:'烈火',dmg:5},4:{name:'烈火',dmg:5},5:{name:'熾炎',dmg:6},6:{name:'逆鱗打',dmg:7}},
    passive:{ harden:1, label:'被ダメ-1' },
    xp:9, chest:{ rate:0.25, white:0.60 }
  },
  fallenAngel: { key:'fallenAngel', name:'堕天使', img:'fallenAngel.png', max:55,
    skills:{1:{name:'堕翼',dmg:4},2:{name:'堕翼',dmg:4},3:{name:'闇裁',dmg:5},4:{name:'闇裁',dmg:6},5:{name:'終末',dmg:7},6:{name:'黙示録',dmg:8}},
    passive:{ harden:2, label:'被ダメ-2' },
    xp:10, chest:{ rate:0.20, white:0.55 }
  },
  blackDragon: { key:'blackDragon', name:'黒竜', img:'blackDragon.png', max:65,
    skills:{1:{name:'黒爪',dmg:4},2:{name:'黒尾',dmg:5},3:{name:'黒炎',dmg:5},4:{name:'黒炎咆',dmg:6},5:{name:'灼黒',dmg:7},6:{name:'滅黒',dmg:8}},
    passive:{ burnOnHit:3, harden:1, enrageHalf:true, label:'炎上DOT/被ダメ-1/半分で強化' },
    xp:12, chest:{ rate:1.00, blue:0.60 }
  },
  demonSoldier: { key:'demonSoldier', name:'魔族兵', img:'demonSoldier.png', max:42,
    skills:{1:{name:'斬り付け',dmg:3},2:{name:'斬り付け',dmg:3},3:{name:'戦斧',dmg:4},4:{name:'戦斧',dmg:5},5:{name:'乱撃',dmg:5},6:{name:'乱撃・強',dmg:6}},
    xp:7, chest:{ rate:0.30, white:0.60 }
  },
  demonElite: { key:'demonElite', name:'魔族精鋭', img:'demonElite.png', max:50,
    skills:{1:{name:'連斬',dmg:3},2:{name:'連斬',dmg:4},3:{name:'槍撃',dmg:4},4:{name:'槍撃',dmg:5},5:{name:'剛撃',dmg:6},6:{name:'剛撃・強',dmg:7}},
    passive:{ harden:1, label:'精鋭統率（被ダメ-1）' },
    xp:10, chest:{ rate:0.35, white:0.55 }
  },
  demonGeneral: { key:'demonGeneral', name:'魔族将軍', img:'demonGeneral.png', max:70,
    skills:{1:{name:'覇斬',dmg:4},2:{name:'覇斬',dmg:4},3:{name:'軍律',dmg:5},4:{name:'軍律',dmg:6},5:{name:'破軍',dmg:7},6:{name:'破軍・極',dmg:8}},
    passive:{ enrageHalfAtk:2, label:'半分でATK+2（自己強化）' },
    xp:15, chest:{ rate:1.00, yellow:1.00 }
  },

  // ===== 組み合わせ/強化バリエーション =====
  ghostPair:   { key:'ghostPair',   name:'幽霊（ペア）', img:'ghost_pair.png', max:28,  skills:{1:{name:'怨念',dmg:2},2:{name:'怨念',dmg:3},3:{name:'連怨',dmg:3},4:{name:'連怨',dmg:4},5:{name:'呪気',dmg:5},6:{name:'呪気・強',dmg:5}}, passive:{ intangible:0.20, label:'半透明（-20%）' }, xp:6, chest:{rate:0.35, white:0.7} },
  deathKnightEX:{ key:'deathKnightEX', name:'デスナイト（強）', img:'deathKnight_ex.png', max:38, skills:{1:{name:'暗黒斬',dmg:3},2:{name:'暗黒斬',dmg:4},3:{name:'死の剣',dmg:4},4:{name:'死の剣',dmg:5},5:{name:'滅撃',dmg:6},6:{name:'滅撃・強',dmg:7}}, passive:{poisonOnHit:3,label:'攻撃時毒3T'}, xp:8, chest:{rate:0.30, white:0.6} },
  ghostKnight: { key:'ghostKnight', name:'幽霊＋デスナイト（隊）', img:'幽霊＋デス.png', max:34,
    skills:{1:{name:'連携斬',dmg:3},2:{name:'連携斬',dmg:4},3:{name:'呪斬',dmg:4},4:{name:'呪斬',dmg:5},5:{name:'滅呪',dmg:6},6:{name:'滅呪・強',dmg:7}},
    passive:{ intangible:0.20, poisonOnHit:2, label:'半透明＆攻撃時毒' }, xp:8, chest:{rate:0.35, white:0.6}
  },
  lizardPack:  { key:'lizardPack', name:'火トカゲ軍団', img:'火トカゲ群.png', max:26,
    skills:{1:{name:'群噛み',dmg:3},2:{name:'群噛み',dmg:3},3:{name:'火花乱舞',dmg:3},4:{name:'火花乱舞',dmg:4},5:{name:'火炎雨',dmg:5},6:{name:'火炎雨・強',dmg:5}}, xp:6, chest:{ rate:0.32, white:0.6 }
  },
  lichPlus:    { key:'lichPlus', name:'リッチ（強）', img:'lich_plus.png', max:40, skills:{1:{name:'闇弾',dmg:4},2:{name:'闇弾',dmg:4},3:{name:'吸精',dmg:5},4:{name:'吸精',dmg:6},5:{name:'死霊術',dmg:7},6:{name:'冥府門',dmg:8}}, passive:{lifesteal:3,label:'攻撃時HP+3'}, xp:9, chest:{rate:0.35, white:0.6} },
  golemPlus:   { key:'golemPlus', name:'強化ゴーレム（特）', img:'golem_plus.png', max:38, skills:{1:{name:'岩拳',dmg:3},2:{name:'岩拳',dmg:3},3:{name:'瓦礫投げ',dmg:4},4:{name:'瓦礫投げ',dmg:5},5:{name:'地響き',dmg:6},6:{name:'地割れ',dmg:7}}, passive:{harden:2,label:'被ダメ-2'}, xp:9, chest:{rate:0.30, white:0.55} },
  lichGolem:   { key:'lichGolem', name:'リッチ＋ゴーレム', img:'リッチゴーレム.png', max:42,
    skills:{1:{name:'闇打',dmg:4},2:{name:'闇打',dmg:4},3:{name:'呪砲',dmg:5},4:{name:'呪砲',dmg:6},5:{name:'冥砕',dmg:7},6:{name:'冥砕・強',dmg:8}},
    passive:{ lifesteal:2, harden:1, label:'吸収+被ダメ-1' }, xp:10, chest:{ rate:0.36, white:0.55 }
  },
  lichGolemPlus:{ key:'lichGolemPlus', name:'連戦ラスト（リッチ＋強G）', img:'連戦ラスト.png', max:46,
    skills:{1:{name:'闇岩連撃',dmg:4},2:{name:'闇岩連撃',dmg:5},3:{name:'呪詛砲',dmg:6},4:{name:'呪詛砲',dmg:6},5:{name:'冥砕滅',dmg:7},6:{name:'冥砕滅・強',dmg:9}},
    passive:{ lifesteal:2, harden:2, label:'吸収+被ダメ-2' }, xp:12, chest:{ rate:0.40, white:0.50 }
  }
};

// ------------------ ステージ図鑑（playlist対応） ------------------
const STAGE_BOOK = {
  // 1〜5
  st1:{ key:'st1', name:'草原', bg:'stage1.png', battles:3, pool:[{key:'slime',w:60},{key:'mutant',w:40}], xp:2 },
  st2:{ key:'st2', name:'森', bg:'stage2.png', battles:3, pool:[{key:'slime',w:40},{key:'mutant',w:30},{key:'mushroom',w:30}], xp:3 },
  st3:{ key:'st3', name:'湖畔', bg:'stage3.png', battles:3, pool:[{key:'waterSlime',w:60},{key:'frog',w:40}], xp:4 },
  st4:{ key:'st4', name:'洞窟', bg:'stage4.png', battles:3, pool:[{key:'bat',w:50},{key:'smallGolem',w:50}], xp:5 },
  st5:{ key:'st5', name:'廃墟', bg:'stage5.png', battles:2, pool:[{key:'bat',w:60},{key:'smallGolem',w:40}], boss:'ruinsGuardian', xp:6 },

  // 6〜9
  st6:{ key:'st6', name:'火山', bg:'stage6.png', battles:3, pool:[{key:'fireLizard',w:55},{key:'magmaGolem',w:45}], xp:7 },
  st7:{ key:'st7', name:'氷の洞窟', bg:'stage7.png', battles:3, pool:[{key:'iceSlime',w:55},{key:'yeti',w:45}], xp:8 },
  st8:{ key:'st8', name:'砂漠', bg:'stage8.png', battles:3, pool:[{key:'scorpion',w:55},{key:'mummy',w:45}], xp:9 },
  st9:{ key:'st9', name:'天空城', bg:'stage9.png', battles:3, pool:[{key:'angelSoldier',w:55},{key:'gargoyle',w:45}], xp:10 },

  // 10
  st10:{ key:'st10', name:'竜の間', bg:'stage10.png', battles:1, playlist:['dragon'], boss:'dragon', xp:12 },

  // ===== 中盤 11〜20（playlist） =====
  st11:{ key:'st11', name:'墓地', bg:'stage11.png', battles:5,
    playlist:['ghost','ghostPair','deathKnight','ghostKnight','deathKnightEX'], xp:8 },
  st12:{ key:'st12', name:'火山深層', bg:'stage12.png', battles:3,
    playlist:['lizardPack','magmaGolem','cerberus'], xp:9 },
  st13:{ key:'st13', name:'魔導塔', bg:'stage13.png', battles:6,
    playlist:['lich','golemEX','lichGolem','lichPlus','golemPlus','lichGolemPlus'], xp:10 },
  st14:{ key:'st14', name:'空中庭園', bg:'stage14.png', battles:4,
    playlist:['angelSoldier','gargoyle','griffon','griffon'], xp:10 },
  st15:{ key:'st15', name:'砂漠遺跡', bg:'stage15.png', battles:2,
    playlist:['scorpion','basilisk'], xp:11 },
  st16:{ key:'st16', name:'火山外縁', bg:'stage16.png', battles:5,
    playlist:['fireLizard','dragonewt','dragonewt','magmaGolem','dragonewt'], xp:11 },
  st17:{ key:'st17', name:'黒翼の祭壇', bg:'stage17.png', battles:3,
    playlist:['angelSoldier','fallenAngel','gargoyle'], xp:12 },
  st18:{ key:'st18', name:'黒竜の間', bg:'stage18.png', battles:2,
    playlist:['demonSoldier','blackDragon'], xp:13 },
  st19:{ key:'st19', name:'魔王城前庭', bg:'stage19.png', battles:7,
    playlist:['demonSoldier','lich','deathKnight','demonSoldier','lichPlus','demonSoldier','demonElite'], xp:14 },
  st20:{ key:'st20', name:'魔族将軍の間', bg:'stage20.png', battles:3,
    playlist:['demonSoldier','fallenAngel','demonGeneral'], boss:'demonGeneral', xp:16 }
};

// ------------------ ゲーム状態 ------------------
let Game = {
  player:{
    name:'剣士レオン', lvl:1, xp:1, atk:0,
    baseMax:20, max:20, hp:20,
    guardPower:0, healPower:0, // ★役割補正
    skills:JSON.parse(JSON.stringify(SKILLS_LEON)),
    // 所持アイテム（全員共有）
    items:{ potion3:3, potion10:0, potion25:0, antidote:0, eyedrops:0, dispel:0, atkPot:0, defPot:0 },
    // 出目割当用の所持装備（箱から増える） ※全員共有
    box:{ ironSword:0, ironShield:0, blueSword:0, blueShield:0, dragonSword:0, sol:0, regalia:0, scaleShield:0, priestStaff:0, blessedStaff:0 },
    equipFaces:{} // { face(1-6): key }
  },
  // 仲間（個別Lv30表）
  party:{
    garo:{ name:'盾騎士ガロ', lvl:1, xp:1, atk:0, baseMax:24, max:24, hp:24, guardPower:0, healPower:0, skills:JSON.parse(JSON.stringify(SKILLS_GARO)) },
    mina:{ name:'僧侶ミナ',   lvl:1, xp:1, atk:0, baseMax:18, max:18, hp:18, guardPower:0, healPower:0, skills:JSON.parse(JSON.stringify(SKILLS_MINA)) }
  },
  progress:{ kills:{}, unlock:{} },
  activeChar: 'leon' // 'leon'|'garo'|'mina'
};

// ------------------ ルーター ------------------
function goto(id){
  document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
function gotoStage(stageKey){
  if(STAGE_BOOK[stageKey]) startStage(stageKey);
  else { startBattle(stageKey); goto('battle'); }
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

function getPlaylistEnemy(stage, idxFromZero){
  if(!stage.playlist) return null;
  const i = clamp(idxFromZero,0,stage.playlist.length-1);
  return stage.playlist[i];
}

function nextBattle(){
  const stage = STAGE_BOOK[Game.currentStage];
  if(!stage) return;

  let enemyKey;
  const cleared = stage.battles - Stage.remain; // 0-based
  if(stage.playlist){
    enemyKey = getPlaylistEnemy(stage, cleared);
  }else if (stage.boss && Stage.remain===1){
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
    const who = Game.activeChar || 'leon';
    if(who==='leon'){ Game.player.hp = Game.player.max; }
    else{ Game.party[who].hp = Game.party[who].max; }

    Game.currentStage = null; Stage = null; StageCP = null;
    StageReward = { xp:0, chests:[], items:[], equips:[] };
    applyDerivedStats();
    P.max = (who==='leon' ? Game.player.max : Game.party[who].max);
    P.hp  = P.max; setHp('P');

    for(const k of Object.keys(STAGE_BOOK)){
      setStageProgress(k, 0, STAGE_BOOK[k].battles);
    }
    clearStageBG(); saveGame(); goto('select'); refreshSelect(); return;
  }
  goto('select'); refreshSelect();
}

// ------------------ SAVE / LOAD ------------------
const SAVE_KEY='batoDiceSaveV3';
function saveGame(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(Game)) }catch(e){} }
function loadGame(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(raw){
      const g = JSON.parse(raw);
      if (g?.player && g?.progress) { Game = g; }
    }
    if (!Game.activeChar) Game.activeChar = 'leon';

    // ------- ③ 互換パッチ：ガロ/ミナの技を役割型へ補正、ミナATK最低値を保障 -------
    const onlyDmg = (skills) => {
      if (!skills) return true;                 // skillsなし→補正対象
      const arr = Object.values(skills);
      if (arr.length === 0) return true;        // 空→補正対象
      // すべて「dmgのみ（heal/guardなし）」なら旧レオン型と判定
      return arr.every(s => s && typeof s === 'object' && s.dmg != null && s.heal == null && s.guard == null);
    };

    if (Game.party) {
      // ガロ
      if (Game.party.garo) {
        if (!Game.party.garo.skills || onlyDmg(Game.party.garo.skills)) {
          Game.party.garo.skills = JSON.parse(JSON.stringify(SKILLS_GARO));
        }
      }
      // ミナ
      if (Game.party.mina) {
        if (!Game.party.mina.skills || onlyDmg(Game.party.mina.skills)) {
          Game.party.mina.skills = JSON.parse(JSON.stringify(SKILLS_MINA));
        }
        // 攻撃0だと詰むので最低1を保障
        if ((Game.party.mina.atk || 0) < 1) Game.party.mina.atk = 1;
      }
    }
  }catch(e){}
}
function resetSave(andStay){
  Game = { 
    player:{
      name:'剣士レオン', lvl:1, xp:1, atk:0,
      baseMax:20, max:20, hp:20,
      guardPower:0, healPower:0,
      skills:JSON.parse(JSON.stringify(SKILLS_LEON)),
      items:{ potion3:3, potion10:0, potion25:0, antidote:0, eyedrops:0, dispel:0, atkPot:0, defPot:0 },
      box:{ ironSword:0, ironShield:0, blueSword:0, blueShield:0, dragonSword:0, sol:0, regalia:0, scaleShield:0, priestStaff:0, blessedStaff:0 },
      equipFaces:{}
    },
    party:{
      garo:{ name:'盾騎士ガロ', lvl:1, xp:1, atk:0, baseMax:24, max:24, hp:24, guardPower:0, healPower:0, skills:JSON.parse(JSON.stringify(SKILLS_GARO)) },
      mina:{ name:'僧侶ミナ',   lvl:1, xp:1, atk:0, baseMax:18, max:18, hp:18, guardPower:0, healPower:0, skills:JSON.parse(JSON.stringify(SKILLS_MINA)) }
    },
    progress:{ kills:{}, unlock:{} },
    activeChar:'leon'
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
  const snap = snapshotActiveChar();
  $('#plName').textContent = snap.name;
  $('#plLv').textContent   = snap.lvl;
  $('#plXp').textContent   = snap.xp;
  $('#plHp').textContent   = snap.hp;
  $('#plMax').textContent  = snap.max;
  $('#plAtk').textContent  = snap.atk;

  const needXp = XP_TABLE[snap.lvl];
  let xpText = "";
  if(needXp){
    const remain = Math.max(0, needXp - snap.xp);
    xpText = `（次Lvまで残り ${remain} xp）`;
  } else {
    xpText = "(最大レベル)";
  }
  $('#plXp').textContent = `${snap.xp} ${xpText}`;

  // 右ペインの装備/アイテム欄はデモでは非表示のまま
  const equipRow = document.getElementById('equipBadges');
  const itemRow  = document.getElementById('plItems');
  if(equipRow) equipRow.parentElement.style.display = "none";
  if(itemRow)  itemRow.parentElement.style.display  = "none";

  saveGame();
  highlightActiveSoloButtons();
}
function snapshotActiveChar(){
  const who = Game.activeChar || 'leon';
  const s = (who==='leon') ? Game.player : (Game.party[who] || Game.player);
  return { name:s.name, lvl:s.lvl, xp:s.xp, hp:s.hp, max:s.max, atk:s.atk };
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

// ------------------ BATTLE STATE ------------------
let currentEnemyKey=null;
const P = { name:'剣士レオン', baseMax:20, max:20, hp:20, atk:1, guardPower:0, healPower:0, hist:[], finisher:false, skills:JSON.parse(JSON.stringify(SKILLS_LEON)) };
const E = { key:'slime', name:'スライム', max:10, hp:10, img:'スライム.png', skills: ENEMY_BOOK.slime?.skills || JSON.parse(JSON.stringify(DEFAULT_SKILLS)), hist:[] };
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
  const d=document.createElement('div'); d.className='dmg'; d.textContent='-'+dmg; card.appendChild(d); setTimeout(()=>d.remove(),900);

  // 衝撃波
  const sw=document.createElement('div'); sw.className='shockwave'; card.appendChild(sw); setTimeout(()=>sw.remove(),650);

  // 斬撃の軌跡（軽め）
  const sl=document.createElement('div'); sl.className='slashFX'; card.appendChild(sl); setTimeout(()=>sl.remove(),360);

  // 破片をランダムに飛ばす
  for(let i=0;i<6;i++){
    const s=document.createElement('div'); s.className='hitShard';
    s.style.setProperty('--tx', (Math.random()*120-60)+'px');
    s.style.setProperty('--ty', (Math.random()*-70-10)+'px');
    card.appendChild(s);
    setTimeout(()=>s.remove(),560);
  }

  card.classList.remove('hitShake'); void card.offsetWidth; card.classList.add('hitShake');
}
function healFX(card, val){
  const h=document.createElement('div'); h.className='healBurst'; h.textContent='+'+val;
  card.appendChild(h); setTimeout(()=>h.remove(),900);
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
  const FACE={1:{x:0,y:0},2:{x:90,y:0},3:{x:0,y:-90},4:{x:0,y:90},5:{x:-90,y:0},6:{x:0,y:180}};
  const base=FACE[n];

  // 演出のために stop を外して 1秒後に再付与
  dice.classList.remove('stop');
  rotX += 360 * (2 + Math.floor(Math.random()*2));
  rotY += 360 * (2 + Math.floor(Math.random()*2));
  dice.style.transform=`rotateX(${rotX+base.x}deg) rotateY(${rotY+base.y}deg)`;
  setTimeout(()=> dice.classList.add('stop'), 1000);
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

// ------------------ アイテムUI＆効果 ------------------
const btnItem=$('#btnItem'), itemModal=$('#itemModal'), itemList=$('#itemList');
function renderItems(){
  itemList.innerHTML='';
  const it=Game.player.items;
  const add=(label,key,count,desc)=>{ const div=document.createElement('div'); div.className='item';
    div.innerHTML=`<span>${label}${desc?` <small style="opacity:.8">${desc}</small>`:''}</span><span>残り ${count}</span>`;
    if(count>0){ const btn=document.createElement('button'); btn.className='pill2'; btn.textContent='使う'; btn.onclick=()=>useItem(key); div.appendChild(btn); }
    itemList.appendChild(div); };

  add('回復薬+3','potion3',it.potion3||0,'HP+3');
  add('回復薬+10','potion10',it.potion10||0,'HP+10');
  add('回復薬+25','potion25',it.potion25||0,'HP+25');
  add('解毒薬','antidote',it.antidote||0,'毒を解除');
  add('目薬','eyedrops',it.eyedrops||0,'命中低下を無視(3T)');
  add('解呪薬','dispel',it.dispel||0,'呪い/炎上を解除');
  add('攻撃薬','atkPot',it.atkPot||0,'次の攻撃+3');
  add('守備薬','defPot',it.defPot||0,'次の被ダメ-2');
}
function useItem(type){
  const it=Game.player.items;
  if((it[type]||0)<=0) return;
  switch(type){
    case 'potion3':  P.hp=clamp(P.hp+3,0,P.max); appendLog('味','-','回復薬+3 を使用',null,`${P.hp}/${P.max}`); break;
    case 'potion10': P.hp=clamp(P.hp+10,0,P.max); appendLog('味','-','回復薬+10 を使用',null,`${P.hp}/${P.max}`); break;
    case 'potion25': P.hp=clamp(P.hp+25,0,P.max); appendLog('味','-','回復薬+25 を使用',null,`${P.hp}/${P.max}`); break;
    case 'antidote': PStatus.poison=0; appendLog('味','-','解毒薬で毒を解除',null,`${P.hp}/${P.max}`); break;
    case 'eyedrops': PStatus.trueSight=3; appendLog('味','-','目薬で命中低下を無効(3T)',null,`${P.hp}/${P.max}`); break;
    case 'dispel':   PStatus.curse=0; PStatus.burn=0; appendLog('味','-','解呪薬で不利を解除',null,`${P.hp}/${P.max}`); break;
    case 'atkPot':   PStatus.atkBuff+=3; appendLog('味','-','攻撃薬で次の攻撃+3',null,`${P.hp}/${P.max}`); break;
    case 'defPot':   PStatus.guard+=2; appendLog('味','-','守備薬で次の被ダメ-2',null,`${P.hp}/${P.max}`); break;
  }
  it[type]--; renderItems(); itemModal.classList.remove('show'); itemModal.hidden=true; setHp('P'); saveGame();
}
btnItem?.addEventListener('click',()=>{ renderItems(); itemModal.hidden=false; itemModal.classList.add('show'); });

// ------------------ バトルコア ------------------
function startBattle(enemyKey){
  // アクティブキャラをPへロード
  loadActiveCharIntoP();
  applyActiveCharVisuals(); 
  // reset statuses
  PStatus.poison=0; PStatus.burn=0; PStatus.curse=0; PStatus.guard=0; PStatus.atkBuff=0; // trueSightは保持

  // enemy
  currentEnemyKey=enemyKey;
  const T=ENEMY_BOOK[enemyKey] || ENEMY_BOOK.slime;
  E.key=T.key; E.name=T.name; E.max=T.max; E.hp=T.max; E.img=T.img; E.skills=T.skills; E.hist=[]; E.passive=T.passive||null; E.enraged=false;
  $('#imgE').src=E.img; $('#nameE').textContent=E.name; $('#eName').value=E.name; $('#eMax').value=E.max;

  // visuals
  resetBattle(true);
  logpre.textContent=`${E.name} が現れた！`;

  // 敵パッシブUI
  if (T.passive) {
    const modal = document.getElementById('passiveE');
    modal.querySelector('h4').textContent = `パッシブ：${T.passive.label || '-'}`;
    modal.querySelector('p').textContent  = T.passive.label || '-';
    document.querySelector('#cardE .foot .pill').textContent = `パッシブ：${T.passive.label || '-'}`;
    document.querySelector('#cardE .foot .pill').disabled = false;
  } else {
    const modal = document.getElementById('passiveE');
    modal.querySelector('h4').textContent = 'パッシブ：-';
    modal.querySelector('p').textContent  = 'この敵にパッシブはありません';
    document.querySelector('#cardE .foot .pill').textContent = 'パッシブ：-';
    document.querySelector('#cardE .foot .pill').disabled = true;
  }
  document.querySelector('#badgeE').style.display = "none";

  // 先制（グリフォンなど）
  if (E.passive?.preemptive){
    showRibbon('E','先制攻撃！',true);
    // 先制一撃
    setTimeout(async ()=>{
      await enemyAttackTurn(true);
      phase='ready'; btnRoll.disabled=false; btnAct.disabled=true; busy=false;
    }, 450);
  }
}

function loadActiveCharIntoP(){
  const k = Game.activeChar || 'leon';
  if(k==='leon'){
    P.name=Game.player.name; P.baseMax=Game.player.baseMax;
    applyDerivedStats();
    P.max=Game.player.max; P.hp=Math.min(Game.player.hp, P.max);
    P.atk=Game.player.atk; 
    P.guardPower = Game.player.guardPower||0;
    P.healPower  = Game.player.healPower||0;
    P.skills=JSON.parse(JSON.stringify(Game.player.skills));
    P.equipFaces = {...Game.player.equipFaces};
  }else{
    const r = Game.party[k];
    P.name=r.name; P.baseMax=r.baseMax; P.max=r.max; P.hp=Math.min(r.hp, r.max);
    P.atk=r.atk; 
    P.guardPower = r.guardPower||0;
    P.healPower  = r.healPower||0;
    P.skills=JSON.parse(JSON.stringify(r.skills));
    P.equipFaces = {...Game.player.equipFaces}; // 出目装備は共通運用
  }
  buildSkillTbl(P.skills, 'p');
}

function applyDerivedStats(){
  // permanent装備加算（今回は使わない想定だが互換保持）
  let max = Game.player.baseMax;
  let atk = Game.player.atk;
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

btnRoll?.addEventListener('click', async ()=>{
  if(phase!=='ready' || busy) return; busy=true; phase='rolled'; btnRoll.disabled=true; btnAct.disabled=true;

  // DOT（自分側）をターン開始時に処理
  await applyPlayerDots();

  const nP=rollOne(); rolledP=nP; spinDice(nP);
  P.hist.push(nP); if(P.hist.length>60) P.hist.shift();
  setTimeout(()=>{ pushChip(allyChips,nP,'ally') },1000);

  // 出目装備（剣=atk、盾=guard）※盾は「次の被ダメ軽減」を即座にスタック
  let equipAtk = 0;
  let equipHealPlus = 0;
  if (P.equipFaces && P.equipFaces[nP]) {
    const key = P.equipFaces[nP];
    const equip = EQUIP_BOOK[key];
    if (equip?.atk) equipAtk += equip.atk;
    if (equip?.defOnce) PStatus.guard += equip.defOnce; // 次の被ダメ軽減をセット
    if (equip?.healPlus) equipHealPlus += equip.healPlus;
  }

  // コンボ
  let comboBonus = 0;
  const combo=checkComboP();
  if(combo){ P.finisher=true; comboBonus = 2; showRibbon('P',`コンボ成立！ ${combo.label}`,true); }

  // プレビュー（ダメ/回復/ガード）
  const s = P.skills[nP] || {};
  let shownBase = 0;
  if (s.heal != null){
    shownBase = Math.max(0, (s.heal||0) + (P.healPower||0) + (equipHealPlus||0));
  } else if (s.guard != null){
    shownBase = Math.max(0, (s.guard||0) + (P.guardPower||0));
  } else {
    shownBase = Math.max(0, (s.dmg||0) + P.atk + equipAtk + comboBonus + PStatus.atkBuff - PStatus.curse);
  }

  await wait(timing.pause+300);
  showRibbon('P',`技${nP}：${s.name||`技${nP}`}（${shownBase}）`, P.finisher);
  actLabel.textContent = (P.finisher? '必殺：':'技：') + `${s.name||`技${nP}`}（${shownBase}）`;
  await wait(timing.pause); btnAct.disabled=false; busy=false;
});

btnAct?.addEventListener('click', async ()=>{
  if(phase!=='rolled' || busy) return; busy=true; phase='acting'; btnAct.disabled=true;

  const s = P.skills[rolledP] || {};
  const equipKey = P.equipFaces?.[rolledP];
  const equip    = equipKey ? EQUIP_BOOK[equipKey] : null;

  // === 回復技 ===
 if (s.heal != null){
  const plusEquip = equip?.healPlus || 0;
  const healAmt = Math.max(0, (s.heal||0) + (P.healPower||0) + plusEquip);
  P.hp = clamp(P.hp + healAmt, 0, P.max);
  setHp('P');

  appendLog('味', rolledP, `${s.name}（回復 +${healAmt}）`, null, `${P.hp}/${P.max}`);

  // ---- 敵ターンへ ----
  if(E.hp > 0){                // 敵がまだ生きている場合
    await enemyAttackTurn(false);
    if(P.hp <= 0) return;       // 倒れていたら終了
  }

  phase='ready';
  btnRoll.disabled=false;
  btnAct.disabled=true;
  busy=false;
  return;
}

  // === ガード技 ===
  if (s.guard != null){
  const add = Math.max(0, (s.guard||0) + (P.guardPower||0));
  PStatus.guard += add;

  // 🔽 ログは1回だけ
  appendLog('味', rolledP, `${s.name}（ガード +${add}）`, null, `${P.hp}/${P.max}`);
  if(E.hp > 0){
  await enemyAttackTurn(false);
  if(P.hp <= 0) return;
}

  phase='ready'; 
  btnRoll.disabled=false; 
  btnAct.disabled=true; 
  busy=false;
  return;  // ← ★これを追加
}

  // === 攻撃技 ===
  let bonus = 0;
  if (equip?.atk) bonus += equip.atk;

  // コンボ（逆鱗持ちは無効）
  let comboBonus = (P.finisher ? 2 : 0);
  if (E.passive?.geirin && P.finisher){
    comboBonus = 0; showRibbon('E','逆鱗：コンボ無効！',true); P.finisher = false;
  }

  // 幽霊の命中低下（ただし目薬中は無視）
  if (E.passive?.intangible && PStatus.trueSight<=0){
    if(Math.random() < E.passive.intangible){
      appendLog('味', rolledP, `${s.name||`技${rolledP}`}（ミス）`, 0, `${E.hp}/${E.max}`);
      PStatus.atkBuff = 0; // 使い切る
      phase='ready'; btnRoll.disabled=false; btnAct.disabled=true; busy=false;
      return;
    }
  }

  // プレイヤー与ダメ
  let dmgP = Math.max(0, (s.dmg||0) + P.atk + bonus + comboBonus + PStatus.atkBuff - PStatus.curse);
  PStatus.atkBuff = 0; // 使い切り

  // 敵の被ダメ軽減
  if (E.passive?.harden) dmgP = Math.max(1, dmgP - E.passive.harden);

  E.hp = clamp(E.hp - dmgP, 0, E.max);
  hitFX(cardE, dmgP); setHp('E');
  appendLog('味', rolledP, (comboBonus? '必殺：':'')+(s.name||`技${rolledP}`), dmgP, `${E.hp}/${E.max}`);
  actLabel.textContent='技';

  // 黒竜・将軍の形態変化
  if(!E.enraged && E.passive?.enrageHalf && E.hp <= Math.floor(E.max/2)){
    E.enraged=true;
    for(let i=1;i<=6;i++){ E.skills[i].dmg += 1; }
    showRibbon('E','黒竜：逆鱗に触れた！(強化)',true);
  }
  if(!E.enraged && E.passive?.enrageHalfAtk && E.hp <= Math.floor(E.max/2)){
    E.enraged=true;
    showRibbon('E','将軍：戦意高揚！(ATK+2)',true);
  }

  if(E.hp<=0){
    await wait(350); $('#imgE').classList.add('vanish'); await wait(800); handleWin(); return;
  }

  // 敵の手番
  await enemyAttackTurn(false);
  if(P.hp<=0) return;

  phase='ready'; btnRoll.disabled=false; btnAct.disabled=true; busy=false;
});

// アクティブキャラへXPを適用（キャラ別Lv30表）＋ guard/heal 成長
function applyXpToActiveChar(totalXp){
  const who = Game.activeChar || 'leon';
  const ch  = (who==='leon') ? Game.player : Game.party[who];

  ch.hp = ch.max;
  ch.xp = Math.max(ch.xp||1, 1) + totalXp;

  const table = (who==='leon') ? LEVEL_TABLE_LEON : (who==='garo' ? LEVEL_TABLE_GARO : LEVEL_TABLE_MINA);

  for(let t=ch.lvl+1; t<=MAX_LEVEL; t++){
    const req = table[t]; if(!req) break;
    if(ch.xp>=req.xp){
      ch.lvl=t; 
      ch.baseMax+=(req.hp||0); 
      ch.atk+=(req.atk||0);
      ch.guardPower = (ch.guardPower||0) + (req.guard||0);
      ch.healPower  = (ch.healPower ||0) + (req.heal ||0);
    }
  }
  ch.max = ch.baseMax; ch.hp = ch.max;

  if(who==='leon'){ Game.player = ch; applyDerivedStats(); Game.player.hp=Game.player.max; }
  else{ Game.party[who] = ch; }
}

async function enemyAttackTurn(isPreemptive=false){
  await wait(isPreemptive? 200 : timing.enemyPause);
  rolledE=rollOne(); spinDice(rolledE);
  setTimeout(()=>{ E.hist.push(rolledE); if(E.hist.length>3) E.hist.shift(); pushChip(enemyChips,rolledE,'enemy') },1000);
  await wait(timing.pause+300); showRibbon('E',`技${rolledE}：${E.skills[rolledE].name}`,false);
  await wait(timing.pause+300);

  let add = 0;
  if (E.enraged && E.passive?.enrageHalfAtk) add += 2;

  let dmgE=Math.max(0, E.skills[rolledE].dmg + add);

  // 守備薬・盾の軽減（1回で全消費）
  if (PStatus.guard>0){
    const before=dmgE;
    dmgE = Math.max(0, dmgE - PStatus.guard);
    PStatus.guard=0;
    if(before!==dmgE) appendLog('敵','-','（ガードで軽減）',null,`${P.hp}/${P.max}`);
  }

  P.hp = clamp(P.hp - dmgE, 0, P.max);
  hitFX(cardP, dmgE); setHp('P'); appendLog('敵', rolledE, E.skills[rolledE].name, dmgE, `${P.hp}/${P.max}`);

  // 敵パッシブの追撃効果
  if(E.passive?.lifesteal && dmgE>0){ E.hp = clamp(E.hp + E.passive.lifesteal, 0, E.max); setHp('E'); appendLog('敵','-','（吸収 +'+E.passive.lifesteal+'）',null,`${E.hp}/${E.max}`) }
  if(E.passive?.poisonOnHit && dmgE>0){ PStatus.poison = Math.max(PStatus.poison, E.passive.poisonOnHit); appendLog('敵','-','（毒を付与）',null,`${P.hp}/${P.max}`) }
  if(E.passive?.burnOnHit && dmgE>0){ PStatus.burn   = Math.max(PStatus.burn,   E.passive.burnOnHit);   appendLog('敵','-','（炎上！）',null,`${P.hp}/${P.max}`) }

  if(P.hp<=0){
    await wait(350);
    try{ audioBgm.pause() }catch(e){}
    winOverlay.querySelector('span').textContent='LOSE';
    winOverlay.hidden=false; winOverlay.classList.add('show');

    // 負け：HP全快・中断（アクティブキャラへ反映）
    const who = Game.activeChar || 'leon';
    if(who==='leon'){ Game.player.hp = Game.player.max; }
    else{ Game.party[who].hp = Game.party[who].max; }

    Game.currentStage = null; Stage = null; clearStageBG(); saveGame();
    btnRoll.disabled=true; btnAct.disabled=true; busy=false;
    return;
  }

  // 敵の2回行動
  if(E.passive?.doubleTurn && Math.random()<E.passive.doubleTurn){
    appendLog('敵','-','（連続行動！）',null,`${P.hp}/${P.max}`);
    await wait(360);
    await enemyAttackTurn(true); // 2撃目
  }

  // DOT（自分側）を敵手番後に処理
  await applyPlayerDots();
}

async function applyPlayerDots(){
  let totalDot=0;
  if(PStatus.poison>0){ totalDot += 1; PStatus.poison--; }
  if(PStatus.burn>0){ totalDot += 2; PStatus.burn--; }
  if(totalDot>0){
    P.hp = clamp(P.hp - totalDot, 0, P.max);
    hitFX(cardP, totalDot); setHp('P');
    appendLog('敵','-',`継続ダメージ (${totalDot})`, totalDot, `${P.hp}/${P.max}`);
    await wait(250);
  }
  if(PStatus.trueSight>0) PStatus.trueSight--;
}

function rollOne(){ return Math.floor(Math.random()*6)+1 }

// ------------------ 勝利処理＆宝箱 ------------------
function handleWin(){
  winOverlay.querySelector('span').textContent='WIN'; winOverlay.hidden=false; winOverlay.classList.add('show');

  Game.progress.kills[currentEnemyKey] = (Game.progress.kills[currentEnemyKey]||0) + 1;
  const gainXP = ENEMY_BOOK[currentEnemyKey]?.xp ?? 1;
  StageReward.xp += gainXP;

  // 宝箱ドロップ
  const cfg = ENEMY_BOOK[currentEnemyKey]?.chest || { rate:0.5, white:0.8 };
  let chest = null;
  if (Math.random() < (cfg.rate ?? 0)) {
    if (cfg.blueSparkle) chest = 'blueSparkle';
    else if (cfg.yellow) chest = 'yellow';
    else {
      // 白 or 青
      const pWhite = cfg.white ?? 0.8;
      const pBlue  = cfg.blue  ?? (1 - pWhite);
      chest = (Math.random() < pWhite) ? 'white' : (Math.random() < pBlue ? 'blue' : 'white');
    }
  }
  if (chest) {
    StageReward.chests.push(chest);
    showChestDrop(chest);
  }

  // HP保存はアクティブキャラへ
  const who = Game.activeChar || 'leon';
  if(who==='leon'){ Game.player.hp = clamp(P.hp, 1, Game.player.max); }
  else{ Game.party[who].hp = clamp(P.hp, 1, Game.party[who].max); }

  logpre.insertAdjacentHTML('beforeend', `\n—— 勝利！ 経験値+${gainXP} ${chest ? '/ 宝箱出現！' : ''}`);
  saveGame();

  setTimeout(()=>{
    if(Game.currentStage){
      const stage = STAGE_BOOK[Game.currentStage];

      Stage.remain -= 1;
      const cleared = stage.battles - Stage.remain;
      setStageProgress(Game.currentStage, cleared, stage.battles);

      if(Stage.remain > 0){
        nextBattle(); goto('battle');
      }else{
        // クリア処理：アクティブキャラに経験値を配布し、結果画面へ
        Stage.cleared = true;
        applyXpToActiveChar(StageReward.xp);
        logpre.insertAdjacentHTML('beforeend', `\n—— ${stage.name} クリア！ 報酬を獲得！ HP全回復！`);
        saveGame(); showResultScreen(Game.currentStage);
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
  chestImg.src = chestType==='white'      ? 'white_chest_closed.png'
            : chestType==='blueSparkle'   ? 'blue_sparkle_closed.png'
            : chestType==='yellow'        ? 'yellow_chest_closed.png'
            : 'blue_chest_closed.png';
  if (chestType==='blueSparkle') chestImg.classList.add('sparkle');

  chestImg.className += ' chest-drop';
  chestImg.style.left = `${cx}px`; chestImg.style.top  = `${cy}px`;

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
    img.src = type==='white'      ? 'white_chest_closed.png'
          : type==='blueSparkle'  ? 'blue_sparkle_closed.png'
          : type==='yellow'        ? 'yellow_chest_closed.png'
          : 'blue_chest_closed.png';
    if (type==='blueSparkle') img.classList.add('sparkle');
    img.className += ' result-chest';
    img.dataset.type = type; img.dataset.opened = 'false';
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
        : (type==='yellow') ? 'yellow_chest_open.png'
        : 'blue_chest_open.png';

  const { label } = rollChestContent(type);
  const li = document.createElement('li');
  li.textContent = label;
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
  Game.currentStage = null; Stage = null; StageCP = null;
  for(const k of Object.keys(STAGE_BOOK)){ setStageProgress(k, 0, STAGE_BOOK[k].battles); }
  clearStageBG();
  StageReward = { xp:0, chests:[], items:[], equips:[] };
  goto('select'); refreshSelect();
}

// ----- 宝箱中身（キャラ別テーブル実装） -----
function grantItem(key){
  const it=Game.player.items;
  it[key]=(it[key]||0)+1;
}
function grantEquip(key){
  Game.player.box[key]=(Game.player.box[key]||0)+1;
}

function rollChestContent(type){
  const who = Game.activeChar || 'leon';
  if(who==='garo') return rollChest_Garo(type);
  if(who==='mina') return rollChest_Mina(type);
  return rollChest_Leon(type);
}

// ▼レオン：従来仕様
function rollChest_Leon(type){
  const r = Math.random()*100;
  if(type==='white'){
    if(r<55){ grantItem('potion3');  return {label:'回復薬+3'}; }
    else if(r<80){ grantItem('potion10'); return {label:'回復薬+10'}; }
    else if(r<90){ grantItem('antidote'); return {label:'解毒薬'}; }
    else if(r<95){ grantEquip('ironSword'); return {label:'鉄の剣'}; }
    else { grantEquip('ironShield'); return {label:'鉄の盾'}; }
  }
  if(type==='blue'){
    if(r<35){ grantItem('potion10'); return {label:'回復薬+10'}; }
    else if(r<60){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<70){ grantItem('eyedrops'); return {label:'目薬'}; }
    else if(r<80){ grantItem('dispel'); return {label:'解呪薬'}; }
    else if(r<90){ grantEquip('blueSword'); return {label:'蒼鉄の剣'}; }
    else { grantEquip('blueShield'); return {label:'蒼鉄の盾'}; }
  }
  if(type==='blueSparkle'){
    if(r<30){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<45){ grantItem('atkPot'); return {label:'攻撃薬'}; }
    else if(r<60){ grantItem('defPot'); return {label:'守備薬'}; }
    else if(r<80){ grantItem('dispel'); return {label:'解呪薬'}; }
    else { grantEquip('dragonSword'); return {label:'ドラゴンの剣'}; }
  }
  if(type==='yellow'){
    if(r<25){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<40){ grantItem('atkPot'); return {label:'攻撃薬'}; }
    else if(r<55){ grantItem('defPot'); return {label:'守備薬'}; }
    else if(r<75){ grantItem('dispel'); return {label:'解呪薬'}; }
    else if(r<85){ grantEquip('sol'); return {label:'ソル'}; }
    else { grantEquip('regalia'); return {label:'レガリア'}; }
  }
  grantItem('potion3'); return {label:'回復薬+3'};
}

// ▼ガロ：盾寄り＆守備薬厚め（装備/盾の比重UP）
function rollChest_Garo(type){
  const r = Math.random()*100;
  if(type==='white'){
    // アイテム80 / 装備20（盾15・剣5）
    if(r<50){ grantItem('potion3');  return {label:'回復薬+3'}; }
    else if(r<70){ grantItem('potion10'); return {label:'回復薬+10'}; }
    else if(r<80){ grantItem('antidote'); return {label:'解毒薬'}; }
    else if(r<95){ grantEquip('ironShield'); return {label:'鉄の盾'}; }
    else { grantEquip('ironSword'); return {label:'鉄の剣'}; }
  }
  if(type==='blue'){
    // アイテム75 / 装備25（盾15・剣10）
    if(r<30){ grantItem('potion10'); return {label:'回復薬+10'}; }
    else if(r<55){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<65){ grantItem('eyedrops'); return {label:'目薬'}; }
    else if(r<75){ grantItem('dispel'); return {label:'解呪薬'}; }
    else if(r<90){ grantEquip('blueShield'); return {label:'蒼鉄の盾'}; }
    else { grantEquip('blueSword'); return {label:'蒼鉄の剣'}; }
  }
  if(type==='blueSparkle'){
    // アイテム70 / 装備30（竜鱗の盾20・ドラ剣10）※守備薬を厚め
    if(r<25){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<35){ grantItem('atkPot'); return {label:'攻撃薬'}; }
    else if(r<60){ grantItem('defPot'); return {label:'守備薬'}; }
    else if(r<70){ grantItem('dispel'); return {label:'解呪薬'}; }
    else if(r<90){ grantEquip('scaleShield'); return {label:'竜鱗の盾'}; }
    else { grantEquip('dragonSword'); return {label:'ドラゴンの剣'}; }
  }
  if(type==='yellow'){
    // アイテム75 / 装備25（レガリア15・ソル10）
    if(r<20){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<30){ grantItem('atkPot'); return {label:'攻撃薬'}; }
    else if(r<55){ grantItem('defPot'); return {label:'守備薬'}; }
    else if(r<75){ grantItem('dispel'); return {label:'解呪薬'}; }
    else if(r<90){ grantEquip('regalia'); return {label:'レガリア'}; }
    else { grantEquip('sol'); return {label:'ソル'}; }
  }
  grantItem('potion3'); return {label:'回復薬+3'};
}

// ▼ミナ：アイテム非常に出やすい（アイテム90%系）
function rollChest_Mina(type){
  const r = Math.random()*100;
  if(type==='white'){
    // アイテム90 / 装備10（盾6・杖4）
    if(r<60){ grantItem('potion3');  return {label:'回復薬+3'}; }
    else if(r<85){ grantItem('potion10'); return {label:'回復薬+10'}; }
    else if(r<90){ grantItem('antidote'); return {label:'解毒薬'}; }
    else if(r<96){ grantEquip('ironShield'); return {label:'鉄の盾'}; }
    else { grantEquip('priestStaff'); return {label:'司祭の杖（回復+）'}; }
  }
  if(type==='blue'){
    // アイテム90 / 装備10（盾8・祝福の杖2）
    if(r<40){ grantItem('potion10'); return {label:'回復薬+10'}; }
    else if(r<70){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<85){ grantItem('eyedrops'); return {label:'目薬'}; }
    else if(r<90){ grantItem('dispel'); return {label:'解呪薬'}; }
    else if(r<98){ grantEquip('blueShield'); return {label:'蒼鉄の盾'}; }
    else { grantEquip('blessedStaff'); return {label:'祝福の杖（回復+）'}; }
  }
  if(type==='blueSparkle'){
    // アイテム90 / 装備10
    if(r<35){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<45){ grantItem('atkPot'); return {label:'攻撃薬'}; }
    else if(r<65){ grantItem('defPot'); return {label:'守備薬'}; }
    else if(r<90){ grantItem('dispel'); return {label:'解呪薬'}; }
    else { grantEquip('dragonSword'); return {label:'ドラゴンの剣'}; }
  }
  if(type==='yellow'){
    // アイテム90 / 装備10
    if(r<30){ grantItem('potion25'); return {label:'回復薬+25'}; }
    else if(r<40){ grantItem('atkPot'); return {label:'攻撃薬'}; }
    else if(r<60){ grantItem('defPot'); return {label:'守備薬'}; }
    else if(r<90){ grantItem('dispel'); return {label:'解呪薬'}; }
    else if(r<95){ grantEquip('sol'); return {label:'ソル'}; }
    else { grantEquip('regalia'); return {label:'レガリア'}; }
  }
  grantItem('potion3'); return {label:'回復薬+3'};
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
btnSettings?.addEventListener('click', ()=>{
  speedSel.value='normal';
  pName.value=P.name; pMax.value=P.max; eName.value=E.name; eMax.value=E.max;
  pTbl.innerHTML = buildSkillTbl(P.skills,'p');
  eTbl.innerHTML = buildSkillTbl(E.skills,'e');
  settingsModal.hidden=false; settingsModal.classList.add('show');
});
closeSettings?.addEventListener('click',()=>{ settingsModal.classList.remove('show'); settingsModal.hidden=true });
applySettings?.addEventListener('click',()=>{
  const who = Game.activeChar || 'leon';
  const newName = (pName.value || '剣士レオン').trim();
  const newMax  = Math.max(1, parseInt(pMax.value || 20));
  const newSkills = collectTbl('p');

  // P（現在のプレイ中キャラ）へ即時反映
  P.name = newName; P.max = newMax; P.hp = newMax; P.skills = newSkills;

  // セーブ側は操作キャラへ保存
  if (who === 'leon') {
    Game.player.name = newName;
    Game.player.baseMax = newMax; applyDerivedStats(); Game.player.hp = Game.player.max;
    Game.player.skills = JSON.parse(JSON.stringify(newSkills));
  } else {
    const ch = Game.party[who];
    ch.name = newName;
    ch.baseMax = newMax; ch.max = newMax; ch.hp = newMax;
    ch.skills = JSON.parse(JSON.stringify(newSkills));
  }
  E.name=(eName.value||E.name).trim(); E.max=Math.max(1, parseInt(eMax.value||E.max)); E.hp=E.max;
  E.skills = collectTbl('e');
  resetBattle(true);
  settingsModal.classList.remove('show'); settingsModal.hidden=true; saveGame();
});

function buildSkillTbl(skills, prefix){
  // モーダルの見出し側（リスト）
  if(prefix==='p'){
    const list=document.getElementById('skillPList'); if(list){ list.innerHTML=''; }
    for(let i=1;i<=6;i++){ const s=skills[i]||{name:`技${i}`,dmg:1};
      const row=document.createElement('div'); row.className='item';
      let desc=''; 
      if(s.heal!=null) desc = `自身を回復 +${s.heal}（+役割/杖補正）`;
      else if(s.guard!=null) desc = `自身にガード +${s.guard}（+役割補正）`;
      else desc = `敵にダメージ ${s.dmg} + 攻撃`;
      row.innerHTML=`<span>${i}：${s.name}</span><span>${desc}</span>`; 
      list?.appendChild(row);
    }
  }else{
    const list=document.getElementById('skillEList'); if(list){ list.innerHTML=''; }
    for(let i=1;i<=6;i++){ const s=skills[i]||{name:`技${i}`,dmg:1};
      const row=document.createElement('div'); row.className='item';
      row.innerHTML=`<span>${i}：${s.name}</span><span>味方にダメージ${s.dmg}</span>`; 
      document.getElementById('skillEList')?.appendChild(row);
    }
  }
  // 編集テーブル（数値欄は dmg/heal/guard のいずれかを表示）
  let html=''; for(let i=1;i<=6;i++){
    const s=skills[i]||{name:`技${i}`,dmg:1};
    const val = (s.dmg!=null) ? s.dmg : (s.heal!=null) ? s.heal : (s.guard!=null) ? s.guard : 0;
    html+=`<div class="cell"><div style="font-weight:700;margin-bottom:4px">${i}</div>
    <input id="${prefix}_name_${i}" class="txt" placeholder="技名" value="${s.name}">
    <div style="margin-top:4px"><input id="${prefix}_dmg_${i}" class="num" type="number" min="0" value="${val}"></div></div>`;
  }
  return html;
}
// buildSkillTbl の下あたりに追加
function rebuildSoloSkillListForActive(){
  const who = Game.activeChar || 'leon';
  const skills = (who === 'leon') ? Game.player.skills : Game.party[who].skills;
  buildSkillTbl(skills, 'p');
}

function collectTbl(prefix){
  const out={}; 
  if(prefix==='p'){
    // 既存の P.skills を見て「ダメ/回復/ガード」を維持
    for(let i=1;i<=6;i++){
      const nm=(document.getElementById(prefix+'_name_'+i)?.value||`技${i}`).trim();
      const dm=Math.max(0, parseInt(document.getElementById(prefix+'_dmg_'+i)?.value||0));
      const cur = P.skills[i] || {};
      if(cur.heal!=null) out[i]={name:nm, heal:dm};
      else if(cur.guard!=null) out[i]={name:nm, guard:dm};
      else out[i]={name:nm, dmg:dm};
    }
    buildSkillTbl(out, prefix); 
    return out;
  }else{
    for(let i=1;i<=6;i++){
      const nm=(document.getElementById(prefix+'_name_'+i)?.value||`技${i}`).trim();
      const dm=Math.max(0, parseInt(document.getElementById(prefix+'_dmg_'+i)?.value||0));
      out[i]={name:nm,dmg:dm};
    }
    buildSkillTbl(out, prefix); 
    return out;
  }
}

// ------------------ EQUIP FACE（出目割当） ------------------
function restoreEquipFaces(){
  if (!Game.player.equipFaces) return;
  const faceMap = { 1:'.front', 2:'.bottom', 3:'.right', 4:'.left', 5:'.topp', 6:'.back' };

  for (const [face, key] of Object.entries(Game.player.equipFaces)) {
    const img = document.getElementById(`diceImg${face}`);
    const selector = faceMap[face];
    const candidate = `dice_${key}${face}.png`;
    const fallback  = `${face}.png`;

    // プリロードで存在確認
    const testImg = new Image();
    testImg.onload = () => {
      if (img) img.src = candidate;
      if (selector) {
        const el = document.querySelector(selector);
        if (el) el.style.backgroundImage = `url("${candidate}")`;
      }
    };
    testImg.onerror = () => {
      if (img) img.src = fallback; // 未定義なら通常サイコロ
      if (selector) {
        const el = document.querySelector(selector);
        if (el) el.style.backgroundImage = `url("${fallback}")`;
      }
    };
    testImg.src = candidate;
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

  // 既に他の面で使っている本数を控える
  const equipUsed = {};
  for (const usedKey of Object.values(Game.player.equipFaces || {})) {
    equipUsed[usedKey] = (equipUsed[usedKey] || 0) + 1;
  }
  // ボックスから候補を並べる
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

  const candidate = `dice_${key}${face}.png`;
  const fallback  = `${face}.png`;

  const img = document.getElementById(`diceImg${face}`);
  const faceMap = {1:'.front',2:'.bottom',3:'.right',4:'.left',5:'.topp',6:'.back'};
  const selector = faceMap[face];

  // プリロードして存在確認
  const testImg = new Image();
  testImg.onload = () => {
    if (img) img.src = candidate;
    if (selector) {
      const el = document.querySelector(selector);
      if (el) el.style.backgroundImage = `url("${candidate}")`;
    }
  };
  testImg.onerror = () => {
    if (img) img.src = fallback;
    if (selector) {
      const el = document.querySelector(selector);
      if (el) el.style.backgroundImage = `url("${fallback}")`;
    }
  };
  testImg.src = candidate;

  alert(`出目${face} に ${EQUIP_BOOK[key].name} を装備しました！（画像はなければデフォルト表示）`);
  const m=document.getElementById('equipFaceModal'); 
  m.classList.remove('show'); 
  m.hidden=true;
  pendingFace = null;
}

// ---- ソロのキャラ切替（最小UI対応） ----
window.setActiveChar = function setActiveChar(k){
  if(!['leon','garo','mina'].includes(k)) return;
  Game.activeChar = k;
  saveGame();
  refreshSelect();
  highlightActiveSoloButtons();
  applyActiveCharVisuals();
  rebuildSoloSkillListForActive(); // ★技一覧を今のキャラで描画
};

function highlightActiveSoloButtons(){
  const map = { leon:'btnCharLeon', garo:'btnCharGaro', mina:'btnCharMina' }; // ← 'leon' 修正
  Object.entries(map).forEach(([k,id])=>{
    const el = document.getElementById(id);
    if(!el) return;
    // 選択中だけ強調（ghost外してprimary風に）
    el.classList.toggle('ghost', Game.activeChar!==k);
    el.style.fontWeight = Game.activeChar===k ? '700' : '400';
    el.style.opacity     = Game.activeChar===k ? '1'   : '0.8';
  });
}

// ------------------ INIT ------------------
function init(){
  loadGame(); applyDerivedStats();
  document.querySelectorAll('.hp').forEach(hp=>{ if(!hp.querySelector('.ticks')){ const t=document.createElement('span'); t.className='ticks'; hp.appendChild(t); } });
  nameP.textContent=Game.player.name; setHp('P');

  for(const k of Object.keys(STAGE_BOOK)){ setStageProgress(k, 0, STAGE_BOOK[k].battles); }
  refreshSelect(); restoreEquipFaces();
  if (typeof installSoloCharSwitcher === 'function') installSoloCharSwitcher();
  // モーダルopen
  document.querySelectorAll('[data-open]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const targetSel = btn.getAttribute('data-open');
      if(targetSel){ const modal = document.querySelector(targetSel); if(modal){ modal.hidden = false; modal.classList.add('show'); } }
    });
  });
  // モーダルclose
  document.querySelectorAll('[data-close]').forEach(btn=>{
    btn.addEventListener('click',()=>{ const modal = btn.closest('.modal'); if(modal){ modal.classList.remove('show'); modal.hidden = true; } });
  });

  rebuildSoloSkillListForActive();
  highlightActiveSoloButtons();
  applyActiveCharVisuals();
}
init();

// 速度切替
document.getElementById('speedSel')?.addEventListener('change', (e)=>{
  const v = e.target.value || 'normal';
  timing = { ...SPEEDS[v] };
});
