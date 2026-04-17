const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Anthropic = require("@anthropic-ai/sdk");
const { Resend } = require("resend");
const cron = require("node-cron");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "baccarat_jwt_secret_2024";

app.use(express.json());
app.use(cors());

// Serve frontend build
const frontendBuild = path.join(__dirname, "baccarat-workspace/frontend/build");
app.use(express.static(frontendBuild));
mongoose.set("strictQuery", true);

async function connectDB() {
  try {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing");
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("MongoDB connected");
    }
  } catch (err) {
    console.log("DB error:", err.message);
    // process.exit kaldırıldı — serverless'ta tüm fonksiyonu öldürürdü
  }
}

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  email: { type: String, default: null, lowercase: true, trim: true },
  emailVerified: { type: Boolean, default: false },
  verificationCode: { type: String, default: null },
  verificationExpiry: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  termsAcceptedAt: { type: Date, default: null },
  termsAcceptedIp: { type: String, default: null },
  termsVersion: { type: String, default: null },
  role: { type: String, default: "user" },
  exempt: { type: Boolean, default: false },
  plan: { type: String, default: "none" },
  subscriptionExpiry: { type: Date, default: null },
  trialUsed: { type: Boolean, default: false },
  whopMemberId: { type: String, default: null },
  dailyWindowStart: { type: Date, default: null },
  dailyExtraMinutes: { type: Number, default: 0 },
});
const User = mongoose.models.User || mongoose.model("User", UserSchema);

const SessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  username: { type: String, default: null },
  bankroll: { type: Number, default: 100 },
  baseUnit: { type: Number, default: 0.5 },
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
  observationLevel: { type: Number, default: 0 },
  observationTarget: { type: Number, default: 1 },
  currentSuggestion: { type: String, default: null },
  currentUnit: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true },
  startedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  handLog: [{
    handNo: Number,
    suggestion: String,
    unit: Number,
    betAmount: Number,
    result: String,
    win: Boolean,
    balanceAfter: Number,
    phase: String,
    timestamp: Date,
  }],
});
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

const RouletteSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  username: { type: String, default: null },
  bankroll: { type: Number, default: 100 },
  baseUnit: { type: Number, default: 0.5 },
  balance: { type: Number, default: 100 },
  maxWin: { type: Number, default: 100 },
  isActive: { type: Boolean, default: true },
  startedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  fullHistory: [{ type: String }],   // "L", "H", "Z"
  suggestion: { type: String, default: null },
  currentUnit: { type: Number, default: 1 },
  consecutiveLosses: { type: Number, default: 0 },
  phase: { type: String, default: "waiting" },
  observationCount: { type: Number, default: 0 },
  observationLevel: { type: Number, default: 0 },
  observationTarget: { type: Number, default: 1 },
  lossLevel: { type: Number, default: 0 },
  lossStep: { type: Number, default: 0 },
  targetMax: { type: Number, default: null },
  handLog: [{
    handNo: Number, suggestion: String, unit: Number,
    betAmount: Number, result: String, win: Boolean,
    balanceAfter: Number, phase: String, timestamp: Date,
  }],
});
const RouletteSession = mongoose.models.RouletteSession || mongoose.model("RouletteSession", RouletteSessionSchema);

function auth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token gerekli" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: "Gecersiz token" }); }
}

async function authWithPlan(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token gerekli" });
  try {
    await connectDB();
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "Kullanici bulunamadi" });
    req.user = { id: String(user._id), username: user.username, role: user.role, exempt: user.exempt, plan: user.plan, subscriptionExpiry: user.subscriptionExpiry };
    // MEMBERSHIP CHECK DISABLED — all logged-in users can play
    return next();
    // Günlük süre kontrolü (120 dk + extra)
    const DAILY_LIMIT = 120;
    if (user.dailyWindowStart) {
      const windowDate = new Date(user.dailyWindowStart);
      const isToday = windowDate.toDateString() === now.toDateString();
      if (isToday) {
        const elapsed = (now - windowDate) / 60000; // dakika
        const allowed = DAILY_LIMIT + (user.dailyExtraMinutes || 0);
        if (elapsed > allowed) return res.status(403).json({ message: "Gunluk suren doldu", code: "DAILY_LIMIT", elapsed: Math.floor(elapsed), allowed });
      } else {
        // Yeni gün — sıfırla
        await User.findByIdAndUpdate(user._id, { dailyWindowStart: now, dailyExtraMinutes: 0 });
      }
    } else {
      // İlk kullanım — pencereyi başlat
      await User.findByIdAndUpdate(user._id, { dailyWindowStart: now });
    }
    next();
  } catch { return res.status(401).json({ message: "Gecersiz token" }); }
}

function isChop(arr) {
  if (arr.length < 5) return false;
  const last5 = arr.slice(-5);
  for (let i = 1; i < 5; i++) {
    if (last5[i] === last5[i - 1]) return false;
  }
  return true;
}

function getLeader(bpHistory) {
  const b = bpHistory.filter((r) => r === "B").length;
  const p = bpHistory.filter((r) => r === "P").length;
  return b >= p ? "B" : "P";
}
function getScoreboard(history) {
  return { B: history.filter((r) => r === "B").length, P: history.filter((r) => r === "P").length, T: history.filter((r) => r === "T").length };
}
function fmt(n) { return Number(n.toFixed(2)); }
function getLossThreshold(initialBankroll, lossLevel) {
  const percentages = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
  return initialBankroll * percentages[Math.min(lossLevel, percentages.length - 1)];
}
function applyLossLevel(s) {
  const pcts = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
  let level = 0;
  for (let i = 0; i < pcts.length; i++) {
    if (s.balance < s.bankroll * pcts[i]) level = i + 1;
    else break;
  }
  s.lossLevel = Math.min(level, 7);
  if (s.lossLevel > 0) {
    // Baraj tetiklendi veya derinleşti → targetMax güncelle
    s.targetMax = fmt(s.bankroll * pcts[s.lossLevel - 1]);
  }
  // lossLevel=0 olunca targetMax SİLİNMEZ — game over veya reset'te temizlenir
  // Böylece 900 barajından geçince bile targetMax=900 sabit kalır
}
function processResult(result, s) {
  const r = String(result).toUpperCase().trim();
  if (!["B", "P", "T"].includes(r)) throw new Error("Gecersiz sonuc");
  if (s.phase === "gameover") return { gameOver: true, balance: s.balance, scoreboard: getScoreboard(s.fullHistory) };
  s.fullHistory.push(r);
  if (r !== "T") s.bpHistory.push(r);
  s.updatedAt = new Date();
  const scoreboard = getScoreboard(s.fullHistory);
  const history = s.fullHistory.slice(-20);
  // Gözlem modu: 3 üst üste kayıptan sonra progressive gözlem (1→2→3 el)
  if (s.phase === "observation") {
    s.observationCount = (s.observationCount || 0) + 1;
    const target = s.observationTarget || 1;
    if (s.observationCount >= target) {
      s.phase = "active"; s.observationCount = 0; s.lossStep = 0;
      s.currentSuggestion = getLeader(s.bpHistory); s.currentUnit = 1;
    }
    const remaining = target - s.observationCount;
    return { recommendation: s.phase === "active" ? s.currentSuggestion : null, unit: s.phase === "active" ? s.currentUnit : null, actualBet: s.phase === "active" ? fmt(s.currentUnit * s.baseUnit) : null, balance: fmt(s.balance), scoreboard, history, message: s.phase === "observation" ? `Observation: ${remaining} hand${remaining !== 1 ? "s" : ""} remaining` : "Observation done — betting resumes", phase: s.phase, baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: s.targetMax != null ? fmt(s.targetMax) : null };
  }
  if (s.bpHistory.length < 3) return { recommendation: null, unit: null, actualBet: null, balance: fmt(s.balance), scoreboard, history, message: (3 - s.bpHistory.length) + " more results needed", phase: "waiting", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: s.targetMax != null ? fmt(s.targetMax) : null };
  // leader: 3 setup eli dahil tam geçmişe bakarak hesapla
  const leader = getLeader(s.bpHistory);
  if (r === "T") {
    if (!s.currentSuggestion) { s.currentSuggestion = getLeader(s.bpHistory); s.currentUnit = 1; s.phase = "active"; }
    return { recommendation: s.currentSuggestion, unit: s.currentUnit, actualBet: s.currentUnit ? fmt(s.currentUnit * s.baseUnit) : null, balance: fmt(s.balance), scoreboard, history, message: "TIE", phase: s.phase, baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: s.targetMax != null ? fmt(s.targetMax) : null };
  }
  if (!s.currentSuggestion) {
    s.currentSuggestion = leader; s.currentUnit = 1; s.phase = "active"; s.lossStep = 0;
    return { recommendation: s.currentSuggestion, unit: s.currentUnit, actualBet: fmt(s.currentUnit * s.baseUnit), balance: fmt(s.balance), scoreboard, history, message: "System ready — first bet: " + s.currentSuggestion, phase: "active", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: s.targetMax != null ? fmt(s.targetMax) : null };
  }
  const win = r === s.currentSuggestion;
  const handEntry = { handNo: s.handLog ? s.handLog.length + 1 : 1, suggestion: s.currentSuggestion, unit: s.currentUnit, betAmount: fmt(s.currentUnit * s.baseUnit), result: r, win, phase: s.phase, timestamp: new Date() };
  if (win) {
    const grossWin = fmt(s.currentUnit * s.baseUnit);
    const commission = s.currentSuggestion === "B" ? fmt(grossWin * 0.05) : 0;
    const netWin = fmt(grossWin - commission);
    s.balance = fmt(s.balance + netWin);
    handEntry.commission = commission;
    handEntry.payout = netWin;
    handEntry.balanceAfter = s.balance;
    if (s.handLog) s.handLog.push(handEntry);
    if (s.balance > s.maxWin) s.maxWin = s.balance;
    const inBarrier = s.targetMax !== null && s.targetMax < s.maxWin;
    const commMsg = commission > 0 ? ` (commission -${commission})` : "";
    const msg = `WIN +${netWin}${commMsg}`;
    s.consecutiveLosses = 0; s.currentSuggestion = leader;
    // +2 net unit game over target
    const netUnit = s.currentSuggestion === "B" ? fmt(s.baseUnit * 0.95) : s.baseUnit;
    const baseRef = s.targetMax !== null ? s.targetMax : s.bankroll;
    const gameOverTarget = fmt(baseRef + 1 * netUnit);
    // Gap-closing: aim exactly at game over target
    const gap = gameOverTarget - s.balance;
    let nextUnit = gap > 0 ? Math.ceil(gap / s.baseUnit) : 1;
    if (nextUnit < 1) nextUnit = 1;
    if (nextUnit > 5) nextUnit = 5;
    // Bahis mevcut bakiyeyi geçemez
    const maxAffordable = Math.floor(s.balance / fmt(s.baseUnit));
    if (nextUnit > maxAffordable && maxAffordable > 0) nextUnit = maxAffordable;
    s.currentUnit = nextUnit;
    if (s.balance >= gameOverTarget) {
      s.phase = "gameover";
      return { gameOver: true, win: true, recommendation: null, unit: null, actualBet: null, balance: fmt(s.balance), scoreboard, history, message: `GAME OVER! Target reached! (Target: ${fmt(gameOverTarget)})`, phase: "gameover", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: s.targetMax != null ? fmt(s.targetMax) : null };
    }
    return { win: true, recommendation: s.currentSuggestion, unit: s.currentUnit, actualBet: fmt(s.currentUnit * s.baseUnit), balance: fmt(s.balance), scoreboard, history, message: msg, phase: "active", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: s.targetMax != null ? fmt(s.targetMax) : null };
  } else {
    s.balance = fmt(s.balance - s.currentUnit * s.baseUnit);
    handEntry.balanceAfter = s.balance;
    if (s.handLog) s.handLog.push(handEntry);
    const lostUnit = s.currentUnit;
    applyLossLevel(s);
    s.consecutiveLosses++;
    if (s.consecutiveLosses >= 3) {
      // 3 üst üste kayıp → gözlem yok, flip + sıfırla
      s.currentSuggestion = s.currentSuggestion === "B" ? "P" : "B";
      s.currentUnit = 2; s.consecutiveLosses = 0;
    } else {
      // Her kayıpta seçenek flip: 1. kayıpta birim 2, 2. kayıpta birim 1
      s.currentSuggestion = s.currentSuggestion === "B" ? "P" : "B";
      s.currentUnit = s.consecutiveLosses === 1 ? 2 : 1;
    }
    return { win: false, recommendation: s.currentSuggestion, unit: s.currentUnit, actualBet: fmt(s.currentUnit * s.baseUnit), balance: fmt(s.balance), scoreboard, history, message: "LOSS -" + lostUnit + " units", phase: "active", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: s.targetMax != null ? fmt(s.targetMax) : null };
  }
}


// ═══ ROULETTE HELPERS ════════════════════════════════════════════════════════

function isChopLH(arr) {
  if (arr.length < 5) return false;
  const last5 = arr.slice(-5);
  for (let i = 1; i < 5; i++) {
    if (last5[i] === last5[i - 1]) return false;
  }
  return true;
}

function getLeaderLH(arr) {
  const l = arr.filter(x => x === "L").length;
  const h = arr.filter(x => x === "H").length;
  return l >= h ? "L" : "H";
}

function getRouletteScoreboard(fullHistory) {
  const sc = { L: 0, H: 0, Z: 0 };
  for (const r of fullHistory) {
    if (r === "Z") sc.Z++;
    else if (r === "L") sc.L++;
    else sc.H++;
  }
  return sc;
}

function rouletteProcessResult(result, s) {
  s.fullHistory.push(result);
  s.updatedAt = new Date();
  const scoreboard = getRouletteScoreboard(s.fullHistory);
  const history = [...s.fullHistory].slice(-20);
  const isZero = result === "Z";
  if (!isZero) s.fullHistory; // already pushed above — non-zero is "L" or "H"

  const buildResponse = (extra) => ({
    scoreboard, history,
    balance: fmt(s.balance), bankroll: s.bankroll, baseUnit: s.baseUnit,
    maxWin: s.maxWin, lossLevel: s.lossLevel, targetMax: s.targetMax != null ? fmt(s.targetMax) : null,
    phase: s.phase,
    suggestion: s.suggestion, unit: s.currentUnit,
    ...extra,
  });

  // ── WAITING phase ──────────────────────────────────────────────────────────
  if (s.phase === "waiting") {
    const nonZero = s.fullHistory.filter(x => x !== "Z");
    if (nonZero.length < 3) {
      return buildResponse({ message: (3 - nonZero.length) + " more results needed" });
    }
    s.suggestion = getLeaderLH(nonZero);
    s.currentUnit = 1;
    s.phase = "active";
    return buildResponse({ message: "System ready — " + (s.suggestion === "L" ? "LOW" : "HIGH") });
  }

  // ── OBSERVATION phase ──────────────────────────────────────────────────────
  if (s.phase === "observation") {
    s.observationCount++;
    const target = s.observationTarget || 1;
    if (s.observationCount >= target) {
      s.phase = "active"; s.observationCount = 0; s.consecutiveLosses = 0;
      const last5 = s.fullHistory.filter(x => x !== "Z").slice(-5);
      s.suggestion = getLeaderLH(last5.length ? last5 : s.fullHistory.filter(x => x !== "Z"));
      s.currentUnit = 1;
      return buildResponse({ message: "Observation done — betting resumes" });
    }
    const remaining = target - s.observationCount;
    return buildResponse({ message: "Observation: " + remaining + " hand" + (remaining !== 1 ? "s" : "") + " remaining" });
  }

  // ── ACTIVE phase ───────────────────────────────────────────────────────────
  const betAmount = fmt(s.currentUnit * s.baseUnit);

  if (isZero) {
    // Zero: lose, no flip
    s.balance = fmt(s.balance - betAmount);
    applyLossLevel(s);
    s.consecutiveLosses++;
    const handEntry = { handNo: (s.handLog ? s.handLog.length + 1 : 1), suggestion: s.suggestion, unit: s.currentUnit, betAmount, result: "Z", win: false, balanceAfter: s.balance, phase: s.phase, timestamp: new Date() };
    if (s.handLog) s.handLog.push(handEntry);
    if (s.consecutiveLosses >= 3) {
      s.suggestion = s.suggestion === "L" ? "H" : "L";
      s.currentUnit = 2; s.consecutiveLosses = 0;
    } else {
      s.currentUnit = s.consecutiveLosses === 1 ? 2 : 1;
    }
    return buildResponse({ win: false, message: "ZERO — LOSS -$" + betAmount });
  }

  // Non-zero result
  const win = result === s.suggestion;
  const lostUnit = s.currentUnit;

  s.balance = fmt(s.balance + (win ? betAmount : -betAmount));
  applyLossLevel(s);
  if (s.balance > s.maxWin) s.maxWin = s.balance;

  const handEntry = { handNo: (s.handLog ? s.handLog.length + 1 : 1), suggestion: s.suggestion, unit: s.currentUnit, betAmount, result, win, balanceAfter: s.balance, phase: s.phase, timestamp: new Date() };
  if (s.handLog) s.handLog.push(handEntry);

  if (win) {
    s.consecutiveLosses = 0;
    s.suggestion = getLeaderLH(s.fullHistory.filter(x => x !== "Z"));
    // Gap-closing unit
    const goRef = s.targetMax !== null ? s.targetMax : s.bankroll;
    const goTarget = fmt(goRef + 1 * s.baseUnit);
    const gap = goTarget - s.balance;
    let nextUnit = gap > 0 ? Math.ceil(gap / s.baseUnit) : 1;
    if (nextUnit > 5) nextUnit = 5;
    const maxAffordable = Math.floor(s.balance / s.baseUnit);
    s.currentUnit = Math.max(1, Math.min(nextUnit, maxAffordable > 0 ? maxAffordable : nextUnit));
  } else {
    s.consecutiveLosses++;
    if (s.consecutiveLosses >= 3) {
      // 3 üst üste kayıp → gözlem yok, flip + sıfırla
      s.suggestion = s.suggestion === "L" ? "H" : "L";
      s.currentUnit = 2; s.consecutiveLosses = 0;
    } else {
      s.suggestion = s.suggestion === "L" ? "H" : "L";
      s.currentUnit = s.consecutiveLosses === 1 ? 2 : 1;
    }
  }

  // Game over check
  const gameOverTarget = fmt((s.targetMax !== null ? s.targetMax : s.bankroll) + 1 * s.baseUnit);
  if (s.balance >= gameOverTarget) {
    s.phase = "gameover";
    return buildResponse({ gameOver: true, win: true, message: "GAME OVER! Target reached! (Target: $" + gameOverTarget + ")" });
  }

  const msg = win
    ? "WIN +" + betAmount
    : "LOSS -$" + fmt(lostUnit * s.baseUnit);
  return buildResponse({ win, message: msg });
}

// ═══ ROULETTE ROUTES ═════════════════════════════════════════════════════════

app.post("/roulette/start", authWithPlan, async (req, res) => {
  try {
    await connectDB();
    const { bankroll } = req.body;
    if (!bankroll || bankroll <= 0) return res.status(400).json({ message: "Valid bankroll required" });
    const baseUnit = fmt(bankroll * 0.01);
    await RouletteSession.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const session = await RouletteSession.create({ userId: req.user.id, username: req.user.username, bankroll, baseUnit, balance: bankroll, maxWin: bankroll });
    return res.json({ sessionId: String(session._id), balance: bankroll, bankroll, baseUnit, lossLevel: 0, targetMax: null, scoreboard: { L: 0, H: 0, Z: 0 }, phase: "waiting", history: [], suggestion: null, unit: 1, message: "Enter 3 results to start" });
  } catch (err) { return res.status(500).json({ message: "Start failed", error: err.message }); }
});

app.post("/roulette/result", authWithPlan, async (req, res) => {
  try {
    await connectDB();
    const { result, sessionId } = req.body;
    if (!["L", "H", "Z"].includes(result)) return res.status(400).json({ message: "Invalid result. Use L, H, or Z" });
    const query = sessionId ? { _id: sessionId, userId: req.user.id, isActive: true } : { userId: req.user.id, isActive: true };
    const session = await RouletteSession.findOne(query).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "No active roulette session" });
    const state = rouletteProcessResult(result, session);
    session.markModified("fullHistory"); session.markModified("handLog");
    session.isActive = state.gameOver ? false : true;
    await session.save();
    return res.json({ ...state, sessionId: String(session._id) });
  } catch (err) { return res.status(500).json({ message: "Result failed", error: err.message }); }
});

app.post("/roulette/reset", authWithPlan, async (req, res) => {
  try {
    await connectDB();
    const { bankroll } = req.body;
    if (!bankroll || bankroll <= 0) return res.status(400).json({ message: "Valid bankroll required" });
    const baseUnit = fmt(bankroll * 0.01);
    await RouletteSession.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const session = await RouletteSession.create({ userId: req.user.id, username: req.user.username, bankroll, baseUnit, balance: bankroll, maxWin: bankroll });
    return res.json({ sessionId: String(session._id), balance: bankroll, bankroll, baseUnit, lossLevel: 0, targetMax: null, scoreboard: { L: 0, H: 0, Z: 0 }, phase: "waiting", history: [], suggestion: null, unit: 1, message: "Enter 3 results to start" });
  } catch (err) { return res.status(500).json({ message: "Reset failed", error: err.message }); }
});

app.post("/roulette/finish", authWithPlan, async (req, res) => {
  try {
    await connectDB();
    const session = await RouletteSession.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "No active roulette session" });
    const finalBalance = fmt(session.balance);
    await RouletteSession.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    return res.json({ message: "Game finished", balance: finalBalance });
  } catch (err) { return res.status(500).json({ message: "Finish failed", error: err.message }); }
});

app.get("/health", (req, res) => res.send("Backend running"));

// ═══ WHOP WEBHOOK ════════════════════════════════════
app.post("/whop/webhook", async (req, res) => {
  try {
    const event = req.body;
    const { action, data } = event;
    const whopMemberId = data?.id || data?.membership?.id;
    const userEmail = data?.user?.email;
    const username = data?.metadata?.username || null;

    if (action === "membership.went_valid") {
      // Abonelik aktif / trial başladı
      let user = null;
      if (username) user = await User.findOne({ username: username.toLowerCase() });
      if (!user && userEmail) user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) { console.log("Whop webhook: user not found", { username, userEmail }); return res.json({ ok: true }); }
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
      user.plan = "active";
      user.subscriptionExpiry = expiry;
      user.whopMemberId = whopMemberId || user.whopMemberId;
      await user.save();
      console.log(`Whop: activated ${user.username} until ${expiry}`);
    } else if (action === "membership.went_invalid") {
      // Abonelik iptal / süresi doldu
      let user = null;
      if (whopMemberId) user = await User.findOne({ whopMemberId });
      if (!user && username) user = await User.findOne({ username: username.toLowerCase() });
      if (user) { user.plan = "none"; await user.save(); console.log(`Whop: deactivated ${user.username}`); }
    }
    return res.json({ ok: true });
  } catch (err) { console.error("Whop webhook error:", err); return res.status(500).json({ message: err.message }); }
});

// ═══ ERİŞİM KONTROLÜ ════════════════════════════════
function checkAccess(req, res, next) {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Token gerekli" });
  // Admin veya exempt kullanıcılar geçer
  if (user.exempt || user.role === "admin") return next();
  // Plan kontrolü (DB'den tekrar çekmemek için auth'da user objesine ekleyeceğiz)
  return next(); // Şimdilik açık, DB kontrolü aşağıda
}

app.post("/signup", async (req, res) => {
  try {
    await connectDB();
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ message: "All fields are required" });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    const existing = await User.findOne({ $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }] });
    if (existing) return res.status(400).json({ message: "Username or email already in use" });
    const hashed = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    const user = await User.create({ username: username.toLowerCase(), email: email.toLowerCase(), password: hashed, verificationCode: code, verificationExpiry: expiry });
    // Send verification email
    if (resendClient) {
      await resendClient.emails.send({
        from: "King Strategy <noreply@king-strategy.com>",
        to: email,
        subject: "Verify your email — King Strategy",
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#061a0e;color:#fff;border-radius:12px"><h2 style="color:#ffd700;margin-bottom:8px">King Strategy</h2><p style="color:#aaa;margin-bottom:24px">Welcome! Please verify your email to continue.</p><div style="background:#0f3520;border:1px solid #1a5a30;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px"><p style="color:#aaa;margin:0 0 8px;font-size:13px">Your verification code</p><div style="font-size:36px;font-weight:bold;color:#ffd700;letter-spacing:8px">${code}</div><p style="color:#666;margin:8px 0 0;font-size:12px">Expires in 15 minutes</p></div><p style="color:#666;font-size:12px">If you did not create an account, ignore this email.</p></div>`
      });
    }
    return res.json({ ok: true, message: "Verification code sent to your email" });
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

app.post("/verify-email", async (req, res) => {
  try {
    await connectDB();
    const { username, code } = req.body;
    if (!username || !code) return res.status(400).json({ message: "Username and code required" });
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.emailVerified) return res.status(400).json({ message: "Email already verified" });
    if (!user.verificationCode || user.verificationCode !== code) return res.status(400).json({ message: "Invalid code" });
    if (user.verificationExpiry < new Date()) return res.status(400).json({ message: "Code expired — please sign up again" });
    user.emailVerified = true;
    user.verificationCode = null;
    user.verificationExpiry = null;
    await user.save();
    return res.json({ ok: true, message: "Email verified successfully" });
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

app.post("/resend-code", async (req, res) => {
  try {
    await connectDB();
    const { username } = req.body;
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.emailVerified) return res.status(400).json({ message: "Already verified" });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.verificationCode = code;
    user.verificationExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();
    if (resendClient) {
      await resendClient.emails.send({
        from: "King Strategy <noreply@king-strategy.com>",
        to: user.email,
        subject: "New verification code — King Strategy",
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#061a0e;color:#fff;border-radius:12px"><h2 style="color:#ffd700">King Strategy</h2><div style="background:#0f3520;border:1px solid #1a5a30;border-radius:8px;padding:24px;text-align:center"><p style="color:#aaa;margin:0 0 8px;font-size:13px">Your new verification code</p><div style="font-size:36px;font-weight:bold;color:#ffd700;letter-spacing:8px">${code}</div><p style="color:#666;margin:8px 0 0;font-size:12px">Expires in 15 minutes</p></div></div>`
      });
    }
    return res.json({ ok: true, message: "New code sent" });
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

app.post("/login", async (req, res) => {
  try {
    await connectDB();
    const { username, password, termsAccepted } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password are required" });
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(400).json({ message: "User not found" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Incorrect password" });
    if (!user.emailVerified && !user.exempt && user.role !== "admin") return res.status(403).json({ message: "Please verify your email first", code: "EMAIL_NOT_VERIFIED", username: user.username });
    // Terms of Use kabulunu kaydet
    if (termsAccepted) {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      user.termsAcceptedAt = new Date();
      user.termsAcceptedIp = ip;
      user.termsVersion = "2026-04-11";
      await user.save();
    }
    const token = jwt.sign({ id: String(user._id), username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, username: user.username, role: user.role || "user", termsAccepted: !!user.termsAcceptedAt });
  } catch (err) { return res.status(500).json({ message: "Login failed", error: err.message }); }
});

async function createUser(username, password) {
  const existing = await User.findOne({ username: username.toLowerCase() });
  if (existing) return { error: "Zaten var" };
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ username, password: hashed });
  return { ok: true, id: user._id };
}


// Bootstrap: create or repair admin users
app.post("/admin/bootstrap", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Unauthorized" });
  try {
    await connectDB();
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "username and password required" });
    let user = await User.findOne({ username: username.toLowerCase() });
    if (user) {
      // Repair existing user: mark as admin + exempt + emailVerified
      const hashed = await bcrypt.hash(password, 10);
      user.password = hashed;
      user.role = "admin";
      user.exempt = true;
      user.emailVerified = true;
      await user.save();
      return res.json({ ok: true, action: "repaired", username: user.username });
    } else {
      // Create new admin user
      const hashed = await bcrypt.hash(password, 10);
      user = await User.create({ username: username.toLowerCase(), password: hashed, role: "admin", exempt: true, emailVerified: true });
      return res.json({ ok: true, action: "created", username: user.username });
    }
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

app.post("/game/start", authWithPlan, async (req, res) => {
  try {
    const bankroll = Number(req.body.bankroll);
    if (!bankroll || bankroll <= 0) return res.status(400).json({ message: "Gecerli bir bankroll girin" });
    const baseUnit = fmt(bankroll * 0.01);
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const session = await Session.create({ userId: req.user.id, username: req.user.username, bankroll, baseUnit, balance: bankroll, maxWin: bankroll, lossLevel: 0, targetMax: null });
    return res.json({ sessionId: String(session._id), balance: session.balance, maxWin: session.maxWin, bankroll, baseUnit, lossLevel: 0, targetMax: null, scoreboard: { B: 0, P: 0, T: 0 }, recommendation: null, unit: null, actualBet: null, phase: "waiting", history: [], message: "Enter 3 results to start" });
  } catch (err) { return res.status(500).json({ message: "Oyun baslatılamadi", error: err.message }); }
});

app.get("/game/state", auth, async (req, res) => {
  try {
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    return res.json({ balance: fmt(session.balance), maxWin: fmt(session.maxWin), bankroll: session.bankroll, baseUnit: session.baseUnit, scoreboard: getScoreboard(session.fullHistory), recommendation: session.currentSuggestion, unit: session.currentUnit, actualBet: session.currentUnit ? fmt(session.currentUnit * session.baseUnit) : null, phase: session.phase, history: session.fullHistory.slice(-20), lossLevel: session.lossLevel ?? 0, targetMax: session.targetMax != null ? fmt(session.targetMax) : fmt(session.bankroll + 3 * session.baseUnit) });
  } catch (err) { return res.status(500).json({ message: "State alinamadi", error: err.message }); }
});

app.post("/game/result", authWithPlan, async (req, res) => {
  try {
    const { result, sessionId } = req.body;
    let session = null;
    if (sessionId) {
      session = await Session.findOne({ _id: sessionId, userId: req.user.id, isActive: true });
    }
    if (!session) {
      session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ startedAt: -1 });
    }
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    const state = processResult(result, session);
    session.markModified("fullHistory");
    session.markModified("bpHistory");
    session.markModified("handLog");
    await session.save();
    return res.json({ ...state, sessionId: String(session._id) });
  } catch (err) { return res.status(400).json({ message: err.message }); }
});

app.post("/game/reset", authWithPlan, async (req, res) => {
  try {
    const bankroll = Number(req.body.bankroll);
    if (!bankroll || bankroll <= 0) return res.status(400).json({ message: "Gecerli bir bankroll girin" });
    const baseUnit = fmt(bankroll * 0.01);
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const session = await Session.create({ userId: req.user.id, username: req.user.username, bankroll, baseUnit, balance: bankroll, maxWin: bankroll, lossLevel: 0, targetMax: null, fullHistory: [], bpHistory: [], consecutiveLosses: 0, sessionHandCount: 0, phase: "waiting", currentSuggestion: null, currentUnit: 1 });
    return res.json({ sessionId: String(session._id), balance: session.balance, maxWin: session.maxWin, bankroll, baseUnit, lossLevel: 0, targetMax: null, scoreboard: { B: 0, P: 0, T: 0 }, recommendation: null, unit: null, actualBet: null, phase: "waiting", history: [], message: "Enter 3 results to start" });
  } catch (err) { return res.status(500).json({ message: "Reset basarisiz", error: err.message }); }
});

app.post("/game/finish", authWithPlan, async (req, res) => {
  try {
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    const finalBalance = fmt(session.balance);
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    return res.json({ message: "Oyun bitirildi", balance: finalBalance });
  } catch (err) { return res.status(500).json({ message: "Finish basarisiz", error: err.message }); }
});

app.post("/admin/create-user", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Eksik bilgi" });
    const result = await createUser(username, password);
    if (result.error) return res.status(400).json({ message: result.error });
    return res.json({ ok: true, username: username.toLowerCase() });
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

app.post("/admin/set-plan", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  try {
    const { username, plan, months, exempt, role, emailVerified } = req.body;
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(404).json({ message: "Kullanici bulunamadi" });
    if (plan !== undefined) user.plan = plan;
    if (exempt !== undefined) user.exempt = exempt;
    if (role !== undefined) user.role = role;
    if (emailVerified !== undefined) user.emailVerified = emailVerified;
    if (months) {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + months);
      user.subscriptionExpiry = expiry;
      user.plan = "active";
    }
    await user.save();
    return res.json({ ok: true, username: user.username, plan: user.plan, exempt: user.exempt, role: user.role, subscriptionExpiry: user.subscriptionExpiry });
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

app.get("/admin/report", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  try {
    const users = await User.find().sort({ createdAt: -1 });
    const sessions = await Session.find().sort({ updatedAt: -1 });
    const sessionMap = {};
    for (const s of sessions) {
      const key = s.username || String(s.userId);
      if (!sessionMap[key]) sessionMap[key] = { sessions: 0, totalHands: 0, lastBalance: 0, lastBankroll: 0, lastActive: null, bestBalance: 0 };
      const u = sessionMap[key];
      u.sessions++; u.totalHands += s.fullHistory.length;
      if (!u.lastActive || s.updatedAt > u.lastActive) { u.lastActive = s.updatedAt; u.lastBalance = fmt(s.balance); u.lastBankroll = s.bankroll; }
      if (s.balance > u.bestBalance) u.bestBalance = fmt(s.balance);
    }
    const toCST = (d) => d ? d.toLocaleString("tr-TR", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") : "-";
    const players = users.map((u) => {
      const s = sessionMap[u.username] || { sessions: 0, totalHands: 0, lastBalance: 0, lastBankroll: 0, lastActive: null, bestBalance: 0 };
      return {
        username: u.username,
        createdAt: toCST(u.createdAt),
        termsAccepted: u.termsAcceptedAt ? "YES" : "NO",
        termsAcceptedAt: toCST(u.termsAcceptedAt),
        termsAcceptedIp: u.termsAcceptedIp || "-",
        termsVersion: u.termsVersion || "-",
        sessions: s.sessions,
        totalHands: s.totalHands,
        lastBalance: s.lastBalance,
        lastBankroll: s.lastBankroll,
        pnl: fmt(s.lastBalance - s.lastBankroll),
        bestBalance: s.bestBalance,
        lastActive: toCST(s.lastActive),
      };
    });
    return res.json({ totalPlayers: players.length, totalSessions: sessions.length, players });
  } catch (err) { return res.status(500).json({ message: "Rapor alinamadi", error: err.message }); }
});

app.get("/admin/export-csv", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  try {
    const sessions = await Session.find().sort({ startedAt: -1 });
    const rows = ["Oyuncu,Oturum No,Baslangic,Bitis,Sure(dk),Bankroll,BaseUnit,El No,Oneri,Birim,Bahis Tutari,Sonuc,Kazanc/Kayip,Bakiye,Faz"];
    for (const s of sessions) {
      const start = s.startedAt ? s.startedAt.toLocaleString("tr-TR", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") : "-";
      const end = s.updatedAt ? s.updatedAt.toLocaleString("tr-TR", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") : "-";
      const durMin = s.startedAt && s.updatedAt ? Math.round((s.updatedAt - s.startedAt) / 60000) : "-";
      const sessionId = String(s._id).slice(-6);
      const user = s.username || String(s.userId).slice(-6);
      if (!s.handLog || s.handLog.length === 0) {
        rows.push(`${user},${sessionId},${start},${end},${durMin},${s.bankroll},${s.baseUnit},,,,,,,,`);
      } else {
        for (const h of s.handLog) {
          const hTime = h.timestamp ? h.timestamp.toLocaleString("tr-TR", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") : "-";
          const wl = h.win ? `+${h.betAmount}` : `-${h.betAmount}`;
          rows.push(`${user},${sessionId},${start},${end},${durMin},${s.bankroll},${s.baseUnit},${h.handNo},${h.suggestion},${h.unit},${h.betAmount},${h.result},${wl},${h.balanceAfter},${h.phase}`);
        }
      }
    }
    const csv = rows.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="king-report-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send("\uFEFF" + csv);
  } catch (err) { return res.status(500).json({ message: "CSV alinamadi", error: err.message }); }
});

// Kullanıcı kendi oyun raporunu CSV olarak indirir
function toLocalTime(date) {
  if (!date) return "-";
  return date.toLocaleString("tr-TR", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
}

app.get("/game/export", auth, async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user.id }).sort({ startedAt: -1 }).limit(50);
    const rows = ["\uFEFFOyuncu,Oturum,Tarih(TR),Sure(dk),Bankroll,Birim,MaxWin,Son Bakiye,El No,Oneri,Birim Katsayi,Bahis,Sonuc,Komisyon,Net Kazanc/Kayip,Bakiye Sonrasi,Faz"];
    for (const s of sessions) {
      const start = toLocalTime(s.startedAt);
      const end = toLocalTime(s.updatedAt);
      const durMin = s.startedAt && s.updatedAt ? Math.round((s.updatedAt - s.startedAt) / 60000) : "-";
      const sid = String(s._id).slice(-6);
      const user = s.username || String(s.userId).slice(-6);
      const maxWin = fmt(s.maxWin || s.bankroll);
      const finalBal = fmt(s.balance);
      if (!s.handLog || s.handLog.length === 0) {
        rows.push(`${user},${sid},${start},${durMin},${s.bankroll},${s.baseUnit},${maxWin},${finalBal},,,,,,,,`);
      } else {
        for (const h of s.handLog) {
          const hTime = toLocalTime(h.timestamp);
          const comm = h.commission != null ? h.commission : 0;
          const net = h.win ? `+${h.payout ?? h.betAmount}` : `-${h.betAmount}`;
          rows.push(`${user},${sid},${hTime},${durMin},${s.bankroll},${s.baseUnit},${maxWin},${finalBal},${h.handNo},${h.suggestion},${h.unit},${h.betAmount},${h.result},${comm},${net},${h.balanceAfter ?? ""},${h.phase}`);
        }
      }
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="rapor-${req.user.username}-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(rows.join("\n"));
  } catch (err) { return res.status(500).json({ message: "Export basarisiz", error: err.message }); }
});

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

app.post("/game/analysis", authWithPlan, async (req, res) => {
  try {
    if (!anthropic) return res.json({ ok: false, side: null, reason: "AI devre disi" });
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    const history = session.bpHistory.slice(-20);
    if (history.length < 5) return res.json({ ok: false, side: null, reason: "Yeterli veri yok" });
    const prompt = "Baccarat hand analysis. Last " + history.length + " results: " + history.join(",") + "\nBalance: " + fmt(session.balance) + ", Bankroll: " + session.bankroll + ", Risk: L" + session.lossLevel + "\nRespond only with JSON: {\"side\":\"B\"|\"P\"|\"NEUTRAL\",\"reason\":\"max 8 words English\"}";
    const msg = await anthropic.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 80, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(msg.content[0].text.trim());
    return res.json({ ok: true, side: parsed.side, reason: parsed.reason });
  } catch (err) { return res.json({ ok: false, side: null, reason: null }); }
});

// ===== DAILY EMAIL REPORT =====
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function buildCsvContent(sessions) {
  const csvRows = ["Oyuncu,Oturum No,Baslangic,Bitis,Sure(dk),Bankroll,BaseUnit,El No,Oneri,Birim,Bahis Tutari,Sonuc,Kazanc/Kayip,Bakiye,Faz"];
  for (const s of sessions) {
    const start = s.startedAt ? s.startedAt.toLocaleString("tr-TR", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") : "-";
    const end = s.updatedAt ? s.updatedAt.toLocaleString("tr-TR", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") : "-";
    const durMin = s.startedAt && s.updatedAt ? Math.round((s.updatedAt - s.startedAt) / 60000) : "-";
    const sessionId = String(s._id).slice(-6);
    const user = s.username || String(s.userId).slice(-6);
    if (!s.handLog || s.handLog.length === 0) {
      csvRows.push(`${user},${sessionId},${start},${end},${durMin},${s.bankroll},${s.baseUnit},,,,,,,,`);
    } else {
      for (const h of s.handLog) {
        const wl = h.win ? `+${h.betAmount}` : `-${h.betAmount}`;
        csvRows.push(`${user},${sessionId},${start},${end},${durMin},${s.bankroll},${s.baseUnit},${h.handNo},${h.suggestion},${h.unit},${h.betAmount},${h.result},${wl},${h.balanceAfter},${h.phase}`);
      }
    }
  }
  return "\uFEFF" + csvRows.join("\n");
}

async function sendDailyReport() {
  if (!resend) { console.log("Resend key yok"); return; }
  try {
    const sessions = await Session.find().sort({ updatedAt: -1 });
    const userMap = {};
    for (const s of sessions) {
      const key = s.username || String(s.userId);
      if (!userMap[key]) userMap[key] = { username: key, bankroll: 0, balance: 0, lastActive: null };
      const u = userMap[key];
      if (!u.lastActive || s.updatedAt > u.lastActive) { u.lastActive = s.updatedAt; u.balance = s.balance; u.bankroll = s.bankroll; }
    }
    let rows = "";
    let totalNet = 0;
    for (const u of Object.values(userMap)) {
      const net = fmt(u.balance - u.bankroll);
      totalNet = fmt(totalNet + net);
      const color = net >= 0 ? "#2ecc71" : "#e74c3c";
      rows += "<tr><td style='padding:8px;border:1px solid #ddd'>" + u.username + "</td><td style='padding:8px;border:1px solid #ddd;text-align:right'>" + u.bankroll + "</td><td style='padding:8px;border:1px solid #ddd;text-align:right'>" + u.balance + "</td><td style='padding:8px;border:1px solid #ddd;text-align:right;color:" + color + ";font-weight:bold'>" + (net >= 0 ? "+" : "") + net + "</td></tr>";
    }
    const totalColor = totalNet >= 0 ? "#2ecc71" : "#e74c3c";
    const dateStr = new Date().toLocaleDateString("tr-TR");
    const html = "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto'><h2 style='color:#333;border-bottom:2px solid #333;padding-bottom:10px'>King Gunluk Rapor - " + dateStr + "</h2><table style='border-collapse:collapse;width:100%'><tr style='background:#2c3e50;color:#fff'><th style='padding:10px;text-align:left'>Oyuncu</th><th style='padding:10px;text-align:right'>Baslangic</th><th style='padding:10px;text-align:right'>Guncel Bakiye</th><th style='padding:10px;text-align:right'>Net Kazanc/Kayip</th></tr>" + rows + "<tr style='background:#ecf0f1;font-weight:bold'><td colspan='3' style='padding:10px;border:1px solid #ddd'>TOPLAM NET</td><td style='padding:10px;border:1px solid #ddd;color:" + totalColor + ";font-size:16px'>" + (totalNet >= 0 ? "+" : "") + totalNet + "</td></tr></table><p style='color:#999;font-size:12px;margin-top:20px'>King Baccarat - Otomatik Gunluk Rapor | Full detay CSV ekte</p></div>";
    const csvContent = await buildCsvContent(sessions);
    const fileName = "king-rapor-" + new Date().toISOString().slice(0, 10) + ".csv";
    await resend.emails.send({
      from: "King Rapor <onboarding@resend.dev>",
      to: "reportofking@gmail.com",
      subject: "King Gunluk Rapor - " + dateStr,
      html,
      attachments: [{ filename: fileName, content: Buffer.from(csvContent).toString("base64") }],
    });
    console.log("Rapor gonderildi:", dateStr);
  } catch (err) { console.error("Rapor gonderilemedi:", err.message); }
}

cron.schedule("0 0 * * *", sendDailyReport);

app.get("/admin/send-report", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  await sendDailyReport();
  return res.json({ message: "Rapor gonderildi" });
});

// Admin: list players with session stats
app.get("/admin/players", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  try {
    await connectDB();
    const bacSessions = await Session.find().sort({ updatedAt: -1 });
    const rouSessions = await RouletteSession.find().sort({ updatedAt: -1 });
    const playerMap = {};
    for (const s of [...bacSessions, ...rouSessions]) {
      const key = s.username || String(s.userId).slice(-6);
      if (!playerMap[key]) playerMap[key] = { username: key, sessions: 0, lastActive: null, lastBalance: null, bankroll: null };
      playerMap[key].sessions++;
      if (!playerMap[key].lastActive || s.updatedAt > playerMap[key].lastActive) {
        playerMap[key].lastActive = s.updatedAt;
        playerMap[key].lastBalance = fmt(s.balance);
        playerMap[key].bankroll = s.bankroll;
      }
    }
    return res.json(Object.values(playerMap).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0)));
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

// Admin: per-player CSV (baccarat + roulette)
app.get("/admin/export-csv/:username", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  try {
    await connectDB();
    const { username } = req.params;
    const bacSessions = await Session.find({ username }).sort({ startedAt: -1 });
    const rouSessions = await RouletteSession.find({ username }).sort({ startedAt: -1 });
    const rows = ["\uFEFFOyun,Oturum,Tarih,Sure(dk),Bankroll,Birim,MaxWin,Son Bakiye,El No,Oneri,Birim Katsayi,Bahis,Sonuc,Net,Bakiye Sonrasi,Faz"];
    for (const s of bacSessions) {
      const start = toLocalTime(s.startedAt); const sid = String(s._id).slice(-6);
      const dur = s.startedAt && s.updatedAt ? Math.round((s.updatedAt - s.startedAt) / 60000) : "-";
      const maxWin = fmt(s.maxWin || s.bankroll); const finalBal = fmt(s.balance);
      if (!s.handLog || s.handLog.length === 0) {
        rows.push(`Baccarat,${sid},${start},${dur},${s.bankroll},${s.baseUnit},${maxWin},${finalBal},,,,,,,,`);
      } else {
        for (const h of s.handLog) {
          const net = h.win ? `+${h.payout ?? h.betAmount}` : `-${h.betAmount}`;
          rows.push(`Baccarat,${sid},${toLocalTime(h.timestamp)},${dur},${s.bankroll},${s.baseUnit},${maxWin},${finalBal},${h.handNo},${h.suggestion},${h.unit},${h.betAmount},${h.result},${net},${h.balanceAfter ?? ""},${h.phase}`);
        }
      }
    }
    for (const s of rouSessions) {
      const start = toLocalTime(s.startedAt); const sid = String(s._id).slice(-6);
      const dur = s.startedAt && s.updatedAt ? Math.round((s.updatedAt - s.startedAt) / 60000) : "-";
      const maxWin = fmt(s.maxWin || s.bankroll); const finalBal = fmt(s.balance);
      if (!s.handLog || s.handLog.length === 0) {
        rows.push(`Roulette,${sid},${start},${dur},${s.bankroll},${s.baseUnit},${maxWin},${finalBal},,,,,,,,`);
      } else {
        for (const h of s.handLog) {
          const net = h.win ? `+${h.betAmount}` : `-${h.betAmount}`;
          rows.push(`Roulette,${sid},${toLocalTime(h.timestamp)},${dur},${s.bankroll},${s.baseUnit},${maxWin},${finalBal},${h.handNo},${h.suggestion},${h.unit},${h.betAmount},${h.result},${net},${h.balanceAfter ?? ""},${h.phase}`);
        }
      }
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="rapor-${username}-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(rows.join("\n"));
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

// Catch-all: serve React frontend for any non-API route
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendBuild, "index.html"));
});

async function startServer() {
  await connectDB();
  app.listen(PORT, () => console.log("Server running on port " + PORT));
}
startServer();
module.exports = app;
