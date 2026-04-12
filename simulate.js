// Monte Carlo Simülasyonu — 200 masa, her masada +2 birim hedef
// Baccarat olasılıkları (tie hariç): Banker %50.68, Player %49.32
// Banker komisyonu: %5

const TABLES = 200;
const BANKROLL = 600;
const BASE_UNIT = BANKROLL * 0.005; // $3
const TARGET_PROFIT_UNITS = 10; // +10 birim = $30 per masa (değiştir)

// Baccarat olasılıkları
function randomResult() {
  const r = Math.random();
  if (r < 0.0952) return "T";       // %9.52 Tie
  if (r < 0.0952 + 0.4586) return "B"; // %45.86 Banker
  return "P";                          // %44.62 Player
}

function roundBet(amount) {
  if (amount < 7) return 5;
  if (amount < 10) return 7;
  return Math.floor(amount);
}

function getLeader(hist) {
  const b = hist.filter(x => x === "B").length;
  const p = hist.filter(x => x === "P").length;
  return b >= p ? "B" : "P";
}

function fmt(n) { return Math.round(n * 100) / 100; }

function applyLossLevel(s) {
  const pcts = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
  let level = 0;
  for (let i = 0; i < pcts.length; i++) {
    if (s.balance < s.bankroll * pcts[i]) { level = i + 1; }
    else break;
  }
  s.lossLevel = Math.min(level, 7);
  if (s.lossLevel > 0 && s.targetMax === null) {
    // Sadece ilk tetiklenişte set edilir — sonra sabit kalır
    s.targetMax = fmt(s.bankroll * pcts[s.lossLevel - 1]);
  }
}

function playTable(bankroll) {
  const s = {
    bankroll,
    balance: bankroll,
    maxWin: bankroll,
    baseUnit: bankroll * 0.005,
    bpHistory: [],
    fullHistory: [],
    currentSuggestion: null,
    currentUnit: 1,
    consecutiveLosses: 0,
    lossLevel: 0,
    targetMax: null,
    hands: 0,
  };

  const gameOverTarget = () =>
    s.targetMax !== null
      ? s.targetMax + 2 * s.baseUnit
      : s.bankroll + TARGET_PROFIT_UNITS * s.baseUnit;

  // 3 el setup
  for (let i = 0; i < 3; i++) {
    let r = randomResult();
    while (r === "T") r = randomResult();
    s.bpHistory.push(r);
    s.fullHistory.push(r);
    s.hands++;
  }
  s.currentSuggestion = getLeader(s.bpHistory);
  s.currentUnit = 1;

  let maxHands = 200; // Sonsuz döngü önlemi

  while (maxHands-- > 0) {
    // Game over kontrolü
    if (s.balance >= gameOverTarget()) {
      return { result: "WIN", balance: s.balance, hands: s.hands, lossLevel: s.lossLevel };
    }
    // Stop: çok kötü kayıp (baraj %20 altı)
    if (s.balance < s.bankroll * 0.2) {
      return { result: "BUST", balance: s.balance, hands: s.hands, lossLevel: s.lossLevel };
    }

    let r = randomResult();
    s.fullHistory.push(r);
    s.hands++;
    if (r === "T") continue; // TIE: aynı bahis devam

    s.bpHistory.push(r);
    const win = r === s.currentSuggestion;
    const betAmt = roundBet(s.currentUnit * s.baseUnit);

    if (win) {
      const commission = s.currentSuggestion === "B" ? fmt(betAmt * 0.05) : 0;
      const netWin = fmt(betAmt - commission);
      s.balance = fmt(s.balance + netWin);
      if (s.balance > s.maxWin) s.maxWin = s.balance;
      s.consecutiveLosses = 0;
      s.currentSuggestion = getLeader(s.bpHistory);
      const baseTarget = s.targetMax !== null ? s.targetMax : s.maxWin;
      const gap = baseTarget + s.baseUnit - s.balance;
      s.currentUnit = gap > 0 ? Math.ceil(gap / s.baseUnit) : 1;
      if (s.currentUnit < 1) s.currentUnit = 1;
      // Bahis bakiyeyi geçemez
      const maxUnits = Math.floor(s.balance / roundBet(s.baseUnit));
      if (s.currentUnit > maxUnits && maxUnits > 0) s.currentUnit = maxUnits;
    } else {
      s.balance = fmt(s.balance - betAmt);
      applyLossLevel(s);
      s.consecutiveLosses++;
      if (s.consecutiveLosses >= 3) {
        // 3 kayıp: 3 el gözlem (skip 3 hands without betting)
        for (let i = 0; i < 3; i++) {
          let obs = randomResult();
          s.fullHistory.push(obs);
          s.hands++;
          if (obs !== "T") s.bpHistory.push(obs);
        }
        s.consecutiveLosses = 0;
        s.currentSuggestion = getLeader(s.bpHistory);
        s.currentUnit = 1;
      } else {
        s.currentSuggestion = s.currentSuggestion === "B" ? "P" : "B";
        s.currentUnit = s.consecutiveLosses === 1 ? 2 : 1;
      }
    }
  }
  return { result: "TIMEOUT", balance: s.balance, hands: s.hands, lossLevel: s.lossLevel };
}

// ===== SİMÜLASYON =====
console.log(`\n🎰 Monte Carlo Simülasyonu`);
console.log(`   Bankroll: $${BANKROLL} | BaseUnit: $${BASE_UNIT.toFixed(2)} | Hedef: +${TARGET_PROFIT_UNITS} birim ($${TARGET_PROFIT_UNITS * BASE_UNIT})`);
console.log(`   Masa sayısı: ${TABLES}\n`);

let totalProfit = 0;
let wins = 0, losses = 0, busts = 0, timeouts = 0;
let totalHands = 0;
let worstBalance = BANKROLL;
let bestProfit = 0;
const lossLevelCounts = [0, 0, 0, 0, 0, 0, 0, 0];

for (let i = 0; i < TABLES; i++) {
  const { result, balance, hands, lossLevel } = playTable(BANKROLL);
  const profit = fmt(balance - BANKROLL);
  totalProfit = fmt(totalProfit + profit);
  totalHands += hands;
  if (balance < worstBalance) worstBalance = balance;
  if (profit > bestProfit) bestProfit = profit;
  lossLevelCounts[lossLevel]++;
  if (result === "WIN") wins++;
  else if (result === "BUST") busts++;
  else if (result === "TIMEOUT") timeouts++;
  else losses++;
}

const winRate = ((wins / TABLES) * 100).toFixed(1);
const avgProfit = fmt(totalProfit / TABLES);
const avgHands = Math.round(totalHands / TABLES);

console.log(`📊 SONUÇLAR (${TABLES} masa)`);
console.log(`─────────────────────────────────`);
console.log(`✅ Kazanan masa : ${wins} (%${winRate})`);
console.log(`❌ Kaybeden masa: ${TABLES - wins - busts - timeouts}`);
console.log(`💥 Bust (-%80)  : ${busts}`);
console.log(`⏱️  Timeout      : ${timeouts}`);
console.log(`─────────────────────────────────`);
console.log(`💰 Toplam kâr/zarar : $${totalProfit}`);
console.log(`📈 Masa başı ort.   : $${avgProfit}`);
console.log(`🃏 Masa başı ort. el: ${avgHands}`);
console.log(`📉 En kötü bakiye   : $${worstBalance.toFixed(2)}`);
console.log(`📈 En iyi kâr       : $${bestProfit.toFixed(2)}`);
console.log(`─────────────────────────────────`);
console.log(`\n🚧 Baraj dağılımı:`);
lossLevelCounts.forEach((c, i) => {
  if (i === 0) console.log(`   Barajsız     : ${c} masa`);
  else console.log(`   L${i} (%${(1-[0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2][i-1])*100}): ${c} masa`);
});
console.log(`\n💡 %20 günlük hedef ($${BANKROLL * 0.2}) için gereken kazanan masa: ${Math.ceil(BANKROLL * 0.2 / (TARGET_PROFIT_UNITS * BASE_UNIT))}`);
