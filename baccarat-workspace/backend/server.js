const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "baccarat_jwt_secret_2024";

app.use(express.json());
app.use(cors());
mongoose.set("strictQuery", true);

// ===== MongoDB =====
async function connectDB() {
  try {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (err) {
    console.log("DB error:", err.message);
    process.exit(1);
  }
}

// ===== Schemas =====
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model("User", UserSchema);

const SessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  username: { type: String, default: null },
  bankroll: { type: Number, default: 100 },   // starting balance for this game
  baseUnit: { type: Number, default: 0.5 },    // bankroll * 0.005
  balance: { type: Number, default: 100 },
  maxWin: { type: Number, default: 100 },
  fullHistory: [{ type: String }],
  bpHistory: [{ type: String }],
  consecutiveLosses: { type: Number, default: 0 },
  lossStep: { type: Number, default: 0 },
  lossLevel: { type: Number, default: 0 },
  targetMax: { type: Number, default: null },
  phase: { type: String, default: "waiting" },
  observationCount: { type: Number, default: 0 },
  currentSuggestion: { type: String, default: null },
  currentUnit: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now },
});
const Session = mongoose.model("Session", SessionSchema);

// ===== Auth Middleware =====
function auth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token gerekli" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Geçersiz token" });
  }
}

// ===== Algorithm =====
const BARRIER_PCTS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];

function getLeader(bpHistory) {
  const b = bpHistory.filter((r) => r === "B").length;
  const p = bpHistory.filter((r) => r === "P").length;
  return b >= p ? "B" : "P";
}

function applyBarrier(balance, maxWin, bankroll) {
  // barriers scale with bankroll, iterate from lowest to find closest barrier above balance
  const barriers = [...BARRIER_PCTS].reverse().map((p) => bankroll * p);
  for (const barrier of barriers) {
    if (balance <= barrier && maxWin > barrier) return barrier;
  }
  return maxWin;
}

function getScoreboard(history) {
  return {
    B: history.filter((r) => r === "B").length,
    P: history.filter((r) => r === "P").length,
    T: history.filter((r) => r === "T").length,
  };
}

function fmt(n) {
  return Number(n.toFixed(2));
}

function getLossThreshold(initialBankroll, lossLevel) {
  const percentages = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
  const index = Math.min(lossLevel, percentages.length - 1);
  return initialBankroll * percentages[index];
}

function applyLossLevel(s) {
  const threshold = getLossThreshold(s.bankroll, s.lossLevel);
  if (s.balance < threshold) {
    s.lossLevel = Math.min(s.lossLevel + 1, 7);
    s.targetMax = fmt(threshold); // baraj değeri yeni hedef olur
  } else {
    s.lossLevel = Math.max(0, s.lossLevel - 1);
    // targetMax değişmez — sadece aşağı yönlü ratchet
  }
}

function processResult(result, s) {
  const r = String(result).toUpperCase().trim();
  if (!["B", "P", "T"].includes(r)) throw new Error("Geçersiz sonuç");

  if (s.phase === "gameover") {
    return { gameOver: true, balance: s.balance, scoreboard: getScoreboard(s.fullHistory) };
  }

  s.fullHistory.push(r);
  if (r !== "T") s.bpHistory.push(r);
  s.updatedAt = new Date();

  const scoreboard = getScoreboard(s.fullHistory);
  const history = s.fullHistory.slice(-20);
  // Initialize targetMax on first run
  if (s.targetMax === null || s.targetMax === undefined) {
    s.targetMax = fmt(s.bankroll + 3 * s.baseUnit);
  }

  // Waiting for first 3 B/P results
  if (s.bpHistory.length < 3) {
    return {
      recommendation: null, unit: null, actualBet: null,
      balance: fmt(s.balance), scoreboard, history,
      message: `${3 - s.bpHistory.length} sonuç daha girin`,
      phase: "waiting", baseUnit: s.baseUnit, bankroll: s.bankroll,
      lossLevel: s.lossLevel, targetMax: fmt(s.targetMax),
    };
  }

  const leader = getLeader(s.bpHistory);

  // T: no balance change
  if (r === "T") {
    if (!s.currentSuggestion && s.phase !== "observation") {
      s.currentSuggestion = leader;
      s.currentUnit = 1;
      s.phase = "active";
    }
    return {
      recommendation: s.phase === "observation" ? null : s.currentSuggestion,
      unit: s.phase === "observation" ? null : s.currentUnit,
      actualBet: s.phase === "observation" ? null : fmt(s.currentUnit * s.baseUnit),
      balance: fmt(s.balance), scoreboard, history,
      message: "TIE — Değişiklik yok",
      phase: s.phase, baseUnit: s.baseUnit, bankroll: s.bankroll,
      observationLeft: s.phase === "observation" ? Math.max(0, 3 - s.observationCount) : 0,
      lossLevel: s.lossLevel, targetMax: fmt(s.targetMax),
    };
  }

  // Observation mode
  if (s.phase === "observation") {
    s.observationCount++;
    if (s.observationCount >= 3) {
      const recoveryUnits = Math.max(1, Math.ceil((s.targetMax - s.balance) / s.baseUnit));
      s.phase = "active";
      s.currentSuggestion = leader;
      s.currentUnit = recoveryUnits;
      s.consecutiveLosses = 0;
      s.lossStep = 0;
      s.observationCount = 0;
      return {
        recommendation: s.currentSuggestion, unit: s.currentUnit,
        actualBet: fmt(s.currentUnit * s.baseUnit),
        balance: fmt(s.balance), scoreboard, history,
        message: `Sistem devreye girdi — ${s.currentSuggestion} × ${s.currentUnit} birim (${fmt(s.currentUnit * s.baseUnit)})`,
        phase: "active", observationLeft: 0, baseUnit: s.baseUnit, bankroll: s.bankroll,
        lossLevel: s.lossLevel, targetMax: fmt(s.targetMax),
      };
    }
    return {
      recommendation: null, unit: null, actualBet: null,
      balance: fmt(s.balance), scoreboard, history,
      message: `Gözlem: ${3 - s.observationCount} el kaldı`,
      phase: "observation", observationLeft: 3 - s.observationCount,
      baseUnit: s.baseUnit, bankroll: s.bankroll,
      lossLevel: s.lossLevel, targetMax: fmt(s.targetMax),
    };
  }

  // Initialize suggestion
  if (!s.currentSuggestion) {
    s.currentSuggestion = leader;
    s.currentUnit = 1;
    s.phase = "active";
    s.lossStep = 0;
  }

  const win = r === s.currentSuggestion;

  if (win) {
    s.balance = fmt(s.balance + s.currentUnit * s.baseUnit);
    if (s.balance > s.maxWin) s.maxWin = s.balance;
    applyLossLevel(s); // lossLevel azaltır, barrier geçildiyse targetMax değişmez
    const msg = `KAZANÇ +${s.currentUnit} birim (+${fmt(s.currentUnit * s.baseUnit)})`;
    s.consecutiveLosses = 0;
    s.lossStep = 0;
    s.currentSuggestion = leader;
    // Kazanç sonrası: recovery bet — hedefe tek hamlede ulaşacak birim
    s.currentUnit = Math.max(1, Math.ceil((s.targetMax - s.balance) / s.baseUnit));

    if (s.balance >= s.targetMax) {
      s.phase = "gameover";
      return {
        gameOver: true, win: true,
        recommendation: null, unit: null, actualBet: null,
        balance: fmt(s.balance), scoreboard, history,
        message: `GAME OVER! Hedefe ulaşıldı! (Hedef: ${fmt(s.targetMax)})`,
        phase: "gameover", baseUnit: s.baseUnit, bankroll: s.bankroll,
        lossLevel: s.lossLevel, targetMax: fmt(s.targetMax),
      };
    }

    return {
      win: true, recommendation: s.currentSuggestion, unit: s.currentUnit,
      actualBet: fmt(s.currentUnit * s.baseUnit),
      balance: fmt(s.balance), scoreboard, history, message: msg,
      phase: "active", observationLeft: 0, baseUnit: s.baseUnit, bankroll: s.bankroll,
      lossLevel: s.lossLevel, targetMax: fmt(s.targetMax),
    };
  } else {
    s.balance = fmt(s.balance - s.currentUnit * s.baseUnit);
    s.maxWin = applyBarrier(s.balance, s.maxWin, s.bankroll);

    // Peak protection: maxWin bankroll'u aştıysa targetMax = maxWin + 1 birim
    // Unconditional — stale/bozuk targetMax değerlerini de düzeltir
    if (s.maxWin > s.bankroll) {
      s.targetMax = fmt(Math.min(s.maxWin + s.baseUnit, s.bankroll + 3 * s.baseUnit));
    }

    applyLossLevel(s); // Baraj kırıldıysa targetMax = baraj değerine düşer

    const msg = `KAYIP -${s.currentUnit} birim (-${fmt(s.currentUnit * s.baseUnit)})`;
    s.consecutiveLosses++;

    if (s.consecutiveLosses >= 3) {
      s.phase = "observation";
      s.observationCount = 0;
      s.currentSuggestion = null;
      s.currentUnit = null;
      return {
        win: false, recommendation: null, unit: null, actualBet: null,
        balance: fmt(s.balance), scoreboard, history,
        message: "3 üst üste kayıp — 3 el gözlem modu",
        phase: "observation", observationLeft: 3, baseUnit: s.baseUnit, bankroll: s.bankroll,
        lossLevel: s.lossLevel, targetMax: fmt(s.targetMax),
      };
    }

    // Kayıp sırasında: 1→2→1→1... pattern (lossStep)
    s.lossStep = (s.lossStep + 1) % 2;
    if (s.lossStep === 1) {
      s.currentSuggestion = s.currentSuggestion === "B" ? "P" : "B";
      s.currentUnit = 2;
    } else {
      s.currentSuggestion = leader;
      s.currentUnit = 1;
    }

    return {
      win: false, recommendation: s.currentSuggestion, unit: s.currentUnit,
      actualBet: fmt(s.currentUnit * s.baseUnit),
      balance: fmt(s.balance), scoreboard, history, message: msg,
      phase: "active", observationLeft: 0, baseUnit: s.baseUnit, bankroll: s.bankroll,
      lossLevel: s.lossLevel, targetMax: fmt(s.targetMax),
    };
  }
}

// ===== Demo helpers =====
function drawCard() {
  const cards = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  return cards[Math.floor(Math.random() * cards.length)];
}
function cardValue(c) {
  if (c === "A") return 1;
  if (["10","J","Q","K"].includes(c)) return 0;
  return Number(c);
}
function handScore(cards) {
  return cards.reduce((s, c) => s + cardValue(c), 0) % 10;
}

function newDemoSession() {
  return {
    bankroll: 100, baseUnit: 0.5,
    balance: 100, maxWin: 100,
    fullHistory: [], bpHistory: [],
    consecutiveLosses: 0, lossStep: 0,
    lossLevel: 0, targetMax: null,
    phase: "waiting", observationCount: 0,
    currentSuggestion: null, currentUnit: 1,
  };
}
let demoSession = newDemoSession();

// ===== HEALTH =====
app.get("/", (req, res) => res.send("Backend running"));

// ===== AUTH (login only, no public register) =====
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Kullanıcı adı ve şifre gerekli" });
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(400).json({ message: "Kullanıcı bulunamadı" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Şifre yanlış" });
    const token = jwt.sign({ id: String(user._id), username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, username: user.username });
  } catch (err) {
    return res.status(500).json({ message: "Giriş başarısız", error: err.message });
  }
});

// Internal only — no public route
async function createUser(username, password) {
  const existing = await User.findOne({ username: username.toLowerCase() });
  if (existing) return { error: "Zaten var" };
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ username, password: hashed });
  return { ok: true, id: user._id };
}

// ===== DEMO =====
app.post("/demo/reset", (req, res) => {
  demoSession = newDemoSession();
  return res.json({ message: "Demo sıfırlandı" });
});

app.post("/demo/deal", (req, res) => {
  if (demoSession.phase === "gameover") demoSession = newDemoSession();
  const playerCards = [drawCard(), drawCard()];
  const bankerCards = [drawCard(), drawCard()];
  const pScore = handScore(playerCards);
  const bScore = handScore(bankerCards);
  let result = "T";
  if (pScore > bScore) result = "P";
  else if (bScore > pScore) result = "B";
  const state = processResult(result, demoSession);
  return res.json({
    cards: { player: { cards: playerCards, score: pScore }, banker: { cards: bankerCards, score: bScore } },
    result, ...state,
  });
});

// ===== GAME (authenticated) =====
app.post("/game/start", auth, async (req, res) => {
  try {
    const bankroll = Number(req.body.bankroll);
    if (!bankroll || bankroll <= 0) return res.status(400).json({ message: "Geçerli bir bankroll girin" });
    const baseUnit = fmt(bankroll * 0.005);
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const targetMax = fmt(bankroll + 3 * baseUnit);
    const session = await Session.create({
      userId: req.user.id, username: req.user.username,
      bankroll, baseUnit, balance: bankroll, maxWin: bankroll,
      lossLevel: 0, targetMax,
    });
    return res.json({
      balance: session.balance, maxWin: session.maxWin,
      bankroll, baseUnit, lossLevel: 0, targetMax,
      scoreboard: { B: 0, P: 0, T: 0 }, recommendation: null,
      unit: null, actualBet: null, phase: "waiting", history: [],
      message: "3 sonuç girin, sistem başlasın",
    });
  } catch (err) {
    return res.status(500).json({ message: "Oyun başlatılamadı", error: err.message });
  }
});

app.get("/game/state", auth, async (req, res) => {
  try {
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    return res.json({
      balance: fmt(session.balance), maxWin: fmt(session.maxWin),
      bankroll: session.bankroll, baseUnit: session.baseUnit,
      scoreboard: getScoreboard(session.fullHistory),
      recommendation: session.currentSuggestion, unit: session.currentUnit,
      actualBet: session.currentUnit ? fmt(session.currentUnit * session.baseUnit) : null,
      phase: session.phase, history: session.fullHistory.slice(-20),
      observationLeft: session.phase === "observation" ? Math.max(0, 3 - session.observationCount) : 0,
      lossLevel: session.lossLevel ?? 0,
      targetMax: session.targetMax != null ? fmt(session.targetMax) : fmt(session.bankroll + 3 * session.baseUnit),
    });
  } catch (err) {
    return res.status(500).json({ message: "State alınamadı", error: err.message });
  }
});

app.post("/game/result", auth, async (req, res) => {
  try {
    const { result } = req.body;
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    const state = processResult(result, session);
    await session.save();
    return res.json(state);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

app.post("/game/reset", auth, async (req, res) => {
  try {
    // bankroll = current accumulated balance from previous game
    const bankroll = Number(req.body.bankroll);
    if (!bankroll || bankroll <= 0) return res.status(400).json({ message: "Geçerli bir bankroll girin" });
    const baseUnit = fmt(bankroll * 0.005);
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const targetMax = fmt(bankroll + 3 * baseUnit);
    const session = await Session.create({
      userId: req.user.id, username: req.user.username,
      bankroll, baseUnit, balance: bankroll, maxWin: bankroll,
      lossLevel: 0, targetMax,
    });
    return res.json({
      balance: session.balance, maxWin: session.maxWin,
      bankroll, baseUnit, lossLevel: 0, targetMax,
      scoreboard: { B: 0, P: 0, T: 0 }, recommendation: null,
      unit: null, actualBet: null, phase: "waiting", history: [],
      message: "3 sonuç girin, sistem başlasın",
    });
  } catch (err) {
    return res.status(500).json({ message: "Reset başarısız", error: err.message });
  }
});

// ===== ADMIN CREATE USER =====
app.post("/admin/create-user", async (req, res) => {
  const secret = req.headers["x-admin-secret"];
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (secret !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Eksik bilgi" });
    const result = await createUser(username, password);
    if (result.error) return res.status(400).json({ message: result.error });
    return res.json({ ok: true, username: username.toLowerCase() });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ===== FINISH (early exit with current balance) =====
app.post("/game/finish", auth, async (req, res) => {
  try {
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    const finalBalance = fmt(session.balance);
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    return res.json({ message: "Oyun bitirildi", balance: finalBalance });
  } catch (err) {
    return res.status(500).json({ message: "Finish başarısız", error: err.message });
  }
});

// ===== ADMIN REPORT =====
app.get("/admin/report", async (req, res) => {
  const secret = req.headers["x-admin-secret"];
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (secret !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });

  try {
    const sessions = await Session.find().sort({ updatedAt: -1 });

    const userMap = {};
    for (const s of sessions) {
      const key = s.username || String(s.userId);
      if (!userMap[key]) {
        userMap[key] = {
          username: s.username || "—",
          sessions: 0,
          totalHands: 0,
          lastBalance: 0,
          lastBankroll: 0,
          lastActive: null,
          bestBalance: 0,
        };
      }
      const u = userMap[key];
      u.sessions++;
      u.totalHands += s.fullHistory.length;
      if (!u.lastActive || s.updatedAt > u.lastActive) {
        u.lastActive = s.updatedAt;
        u.lastBalance = fmt(s.balance);
        u.lastBankroll = s.bankroll;
      }
      if (s.balance > u.bestBalance) u.bestBalance = fmt(s.balance);
    }

    const players = Object.values(userMap).map((u) => ({
      ...u,
      pnl: fmt(u.lastBalance - u.lastBankroll),
      lastActive: u.lastActive ? u.lastActive.toISOString().slice(0, 16).replace("T", " ") : "—",
    }));

    return res.json({ totalPlayers: players.length, totalSessions: sessions.length, players });
  } catch (err) {
    return res.status(500).json({ message: "Rapor alınamadı", error: err.message });
  }
});

// ===== START =====
async function startServer() {
  await connectDB();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
startServer();
module.exports = app;
