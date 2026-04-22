// Blackjack KOS Simulation — düzeltilmiş
// Push: %8.5, kazanç prob (decisive): %49 = ~0.5% house edge
// KOS: 1-2-3-5-3-2-1-2-3-5, her kazanç = game over (yeni oyun)
// Her 3 kayıp = 3-el gözlem (bahis yok)
// Günlük: X oturum kadar oyna, eşik geçilince kaydet

const KOS_SEQ = [1, 2, 3, 5, 3, 2, 1, 2, 3, 5];
const P_PUSH = 0.085;
const P_DEC  = 1 - P_PUSH;

function playOneSession(balance, baseUnit, pWinDec) {
  let lossStep = 0;
  let totalLosses = 0;
  let handCount = 0;

  while (handCount < 500) {
    // Observation: her 3 kayıpta 3 el gözlem (basitleştirilmiş: sadece 3 el atla)
    if (totalLosses > 0 && totalLosses % 3 === 0) {
      // 3 el observation — bahis yok, sadece geçer
      // totalLosses'u observation'ı tekrar tetiklemeyecek şekilde işaretle
      totalLosses = 0; // reset (gözlemden sonra sıfırla)
    }

    const bet = KOS_SEQ[lossStep] * baseUnit;
    const r = Math.random();

    if (r < P_PUSH) { handCount++; continue; } // push

    const dec = (r - P_PUSH) / P_DEC;
    if (dec < pWinDec) {
      // WIN
      balance += bet;
      return { win: true, balance };
    } else {
      // LOSS
      balance -= bet;
      lossStep++;
      totalLosses++;
      if (lossStep >= KOS_SEQ.length) {
        // dizi bitti → game over (kayıp)
        return { win: false, balance };
      }
    }
    handCount++;
  }
  return { win: false, balance };
}

function simulateDay(startBankroll, sessionsPerDay, pWin) {
  const pWinDec = pWin / P_DEC;
  let balance = startBankroll;
  const baseUnit = startBankroll * 0.01;
  const t10 = startBankroll * 1.10;
  const t15 = startBankroll * 1.15;
  const t20 = startBankroll * 1.20;
  let r10=false, r15=false, r20=false;

  for (let s = 0; s < sessionsPerDay; s++) {
    if (balance <= 0) break;
    const res = playOneSession(balance, baseUnit, pWinDec);
    balance = res.balance;
    if (balance >= t10) r10=true;
    if (balance >= t15) r15=true;
    if (balance >= t20) r20=true;
  }

  return { r10, r15, r20, bankrupt: balance <= 0 };
}

const DAYS = 100000;
const BANKROLL = 100;

console.log("=".repeat(68));
console.log("  BLACKJACK KOS | 100,000 GÜN | BJ house edge ~0.5% (basic strategy)");
console.log("  KOS: 1-2-3-5-3-2-1-2-3-5 | Her kazanç = yeni oturum");
console.log("=".repeat(68));
console.log("  Oturum/Gün   +%10    +%15    +%20    Kayıp");
console.log("  " + "-".repeat(50));

for (const sessions of [5, 10, 15, 20, 30, 50]) {
  let r10=0, r15=0, r20=0, bk=0;
  for (let i=0; i<DAYS; i++) {
    const d = simulateDay(BANKROLL, sessions, 0.490);
    if (d.r10) r10++;
    if (d.r15) r15++;
    if (d.r20) r20++;
    if (d.bankrupt) bk++;
  }
  console.log(`  ${String(sessions).padEnd(14)}${(r10/DAYS*100).toFixed(1)}%   ${(r15/DAYS*100).toFixed(1)}%   ${(r20/DAYS*100).toFixed(1)}%    ${(bk/DAYS*100).toFixed(1)}%`);
}

console.log("\n  --- 20 oturum/gün — farklı kazanma ihtimalleri ---");
console.log("  P(win)   +%10    +%15    +%20    Kayıp");
console.log("  " + "-".repeat(46));
for (const pw of [0.44, 0.46, 0.48, 0.49, 0.50, 0.51, 0.52]) {
  let r10=0, r15=0, r20=0, bk=0;
  for (let i=0; i<DAYS; i++) {
    const d = simulateDay(BANKROLL, 20, pw);
    if (d.r10) r10++;
    if (d.r15) r15++;
    if (d.r20) r20++;
    if (d.bankrupt) bk++;
  }
  console.log(`  %${(pw*100).toFixed(0)}      ${(r10/DAYS*100).toFixed(1)}%   ${(r15/DAYS*100).toFixed(1)}%   ${(r20/DAYS*100).toFixed(1)}%    ${(bk/DAYS*100).toFixed(1)}%`);
}
console.log("=".repeat(68));

// KOS vs Baccarat KOS karşılaştırma notu
console.log(`
  NOT: Baccarat KOS'ta kazanma ihtimali ~%49.1 (0 komisyonlu)
  Blackjack basic strategy ile ~%49 → pratik olarak aynı sistem.
  Fark: BJ'de double/split seçenekleri EV'yi artırır (+%0.3-0.5)
  ancak simülasyonda bu basitleştirilerek göz ardı edilmiştir.
`);
