const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Anthropic = require("@anthropic-ai/sdk");
const { Resend } = require("resend");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "baccarat_jwt_secret_2024";

app.use(express.json());
app.use(cors());
mongoose.set("strictQuery", true);

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

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model("User", UserSchema);

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
  currentSuggestion: { type: String, default: null },
  currentUnit: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now },
});
const Session = mongoose.model("Session", SessionSchema);

function auth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token gerekli" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: "Gecersiz token" }); }
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
  const threshold = getLossThreshold(s.bankroll, s.lossLevel);
  if (s.balance < threshold) { s.lossLevel = Math.min(s.lossLevel + 1, 7); s.targetMax = fmt(threshold); }
  else { s.lossLevel = Math.max(0, s.lossLevel - 1); }
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
  if (s.targetMax === null || s.targetMax === undefined) s.targetMax = fmt(s.bankroll + 3 * s.baseUnit);
  if (s.phase === "observation") { s.phase = "active"; s.observationCount = 0; }
  if (s.bpHistory.length < 3) return { recommendation: null, unit: null, actualBet: null, balance: fmt(s.balance), scoreboard, history, message: (3 - s.bpHistory.length) + " sonuc daha girin", phase: "waiting", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: fmt(s.targetMax) };
  const leader = getLeader(s.bpHistory);
  if (r === "T") {
    if (!s.currentSuggestion) { s.currentSuggestion = leader; s.currentUnit = 1; s.phase = "active"; }
    return { recommendation: s.currentSuggestion, unit: s.currentUnit, actualBet: s.currentUnit ? fmt(s.currentUnit * s.baseUnit) : null, balance: fmt(s.balance), scoreboard, history, message: "TIE", phase: s.phase, baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: fmt(s.targetMax) };
  }
  if (!s.currentSuggestion) { s.currentSuggestion = leader; s.currentUnit = 1; s.phase = "active"; s.lossStep = 0; }
  const win = r === s.currentSuggestion;
  if (win) {
    s.balance = fmt(s.balance + s.currentUnit * s.baseUnit);
    if (s.balance > s.maxWin) s.maxWin = s.balance;
    applyLossLevel(s);
    s.consecutiveLosses = 0; s.lossStep = 0; s.currentSuggestion = leader;
    let target = s.lossLevel > 0 ? s.targetMax + s.baseUnit : s.maxWin + s.baseUnit;
    let nextUnit = Math.ceil((target - s.balance) / s.baseUnit);
    if (nextUnit < 1) nextUnit = 1;
    s.currentUnit = nextUnit;
    const gTarget = s.lossLevel > 0 ? s.targetMax + 3 * s.baseUnit : s.maxWin + 3 * s.baseUnit;
    if (s.balance >= gTarget) { s.phase = "gameover"; return { gameOver: true, win: true, balance: fmt(s.balance), scoreboard, history, message: "GAME OVER!", phase: "gameover", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: fmt(s.targetMax) }; }
    return { win: true, recommendation: s.currentSuggestion, unit: s.currentUnit, actualBet: fmt(s.currentUnit * s.baseUnit), balance: fmt(s.balance), scoreboard, history, message: "KAZANC +" + s.currentUnit + " birim", phase: "active", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: fmt(s.targetMax) };
  } else {
    s.balance = fmt(s.balance - s.currentUnit * s.baseUnit);
    applyLossLevel(s);
    s.consecutiveLosses++;
    s.lossStep = (s.lossStep + 1) % 2;
    if (s.lossStep === 1) { s.currentSuggestion = s.currentSuggestion === "B" ? "P" : "B"; s.currentUnit = 2; }
    else { s.currentSuggestion = leader; s.currentUnit = 1; }
    return { win: false, recommendation: s.currentSuggestion, unit: s.currentUnit, actualBet: fmt(s.currentUnit * s.baseUnit), balance: fmt(s.balance), scoreboard, history, message: "KAYIP -" + s.currentUnit + " birim", phase: "active", baseUnit: s.baseUnit, bankroll: s.bankroll, lossLevel: s.lossLevel, targetMax: fmt(s.targetMax) };
  }
}

function drawCard() { const cards = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"]; return cards[Math.floor(Math.random() * cards.length)]; }
function cardValue(c) { if (c === "A") return 1; if (["10","J","Q","K"].includes(c)) return 0; return Number(c); }
function handScore(cards) { return cards.reduce((s, c) => s + cardValue(c), 0) % 10; }
function newDemoSession() { return { bankroll: 100, baseUnit: 0.5, balance: 100, maxWin: 100, fullHistory: [], bpHistory: [], consecutiveLosses: 0, lossStep: 0, lossLevel: 0, targetMax: null, phase: "waiting", observationCount: 0, currentSuggestion: null, currentUnit: 1 }; }
let demoSession = newDemoSession();

app.get("/", (req, res) => res.send("Backend running"));

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Kullanici adi ve sifre gerekli" });
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(400).json({ message: "Kullanici bulunamadi" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Sifre yanlis" });
    const token = jwt.sign({ id: String(user._id), username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, username: user.username });
  } catch (err) { return res.status(500).json({ message: "Giris basarisiz", error: err.message }); }
});

async function createUser(username, password) {
  const existing = await User.findOne({ username: username.toLowerCase() });
  if (existing) return { error: "Zaten var" };
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ username, password: hashed });
  return { ok: true, id: user._id };
}

app.post("/demo/reset", (req, res) => { demoSession = newDemoSession(); return res.json({ message: "Demo sifirland" }); });
app.post("/demo/deal", (req, res) => {
  if (demoSession.phase === "gameover") demoSession = newDemoSession();
  const playerCards = [drawCard(), drawCard()];
  const bankerCards = [drawCard(), drawCard()];
  const pScore = handScore(playerCards);
  const bScore = handScore(bankerCards);
  let result = "T";
  if (pScore > bScore) result = "P";
  else if (bScore > pScore) result = "B";
  return res.json({ cards: { player: { cards: playerCards, score: pScore }, banker: { cards: bankerCards, score: bScore } }, result, ...processResult(result, demoSession) });
});

app.post("/game/start", auth, async (req, res) => {
  try {
    const bankroll = Number(req.body.bankroll);
    if (!bankroll || bankroll <= 0) return res.status(400).json({ message: "Gecerli bir bankroll girin" });
    const baseUnit = fmt(bankroll * 0.005);
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const targetMax = fmt(bankroll + 3 * baseUnit);
    const session = await Session.create({ userId: req.user.id, username: req.user.username, bankroll, baseUnit, balance: bankroll, maxWin: bankroll, lossLevel: 0, targetMax });
    return res.json({ balance: session.balance, maxWin: session.maxWin, bankroll, baseUnit, lossLevel: 0, targetMax, scoreboard: { B: 0, P: 0, T: 0 }, recommendation: null, unit: null, actualBet: null, phase: "waiting", history: [], message: "3 sonuc girin, sistem baslasın" });
  } catch (err) { return res.status(500).json({ message: "Oyun baslatılamadi", error: err.message }); }
});

app.get("/game/state", auth, async (req, res) => {
  try {
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    return res.json({ balance: fmt(session.balance), maxWin: fmt(session.maxWin), bankroll: session.bankroll, baseUnit: session.baseUnit, scoreboard: getScoreboard(session.fullHistory), recommendation: session.currentSuggestion, unit: session.currentUnit, actualBet: session.currentUnit ? fmt(session.currentUnit * session.baseUnit) : null, phase: session.phase, history: session.fullHistory.slice(-20), lossLevel: session.lossLevel ?? 0, targetMax: session.targetMax != null ? fmt(session.targetMax) : fmt(session.bankroll + 3 * session.baseUnit) });
  } catch (err) { return res.status(500).json({ message: "State alinamadi", error: err.message }); }
});

app.post("/game/result", auth, async (req, res) => {
  try {
    const { result } = req.body;
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    const state = processResult(result, session);
    await session.save();
    return res.json(state);
  } catch (err) { return res.status(400).json({ message: err.message }); }
});

app.post("/game/reset", auth, async (req, res) => {
  try {
    const bankroll = Number(req.body.bankroll);
    if (!bankroll || bankroll <= 0) return res.status(400).json({ message: "Gecerli bir bankroll girin" });
    const baseUnit = fmt(bankroll * 0.005);
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const targetMax = fmt(bankroll + 3 * baseUnit);
    const session = await Session.create({ userId: req.user.id, username: req.user.username, bankroll, baseUnit, balance: bankroll, maxWin: bankroll, lossLevel: 0, targetMax });
    return res.json({ balance: session.balance, maxWin: session.maxWin, bankroll, baseUnit, lossLevel: 0, targetMax, scoreboard: { B: 0, P: 0, T: 0 }, recommendation: null, unit: null, actualBet: null, phase: "waiting", history: [], message: "3 sonuc girin" });
  } catch (err) { return res.status(500).json({ message: "Reset basarisiz", error: err.message }); }
});

app.post("/game/finish", auth, async (req, res) => {
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

app.get("/admin/report", async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "baccarat_admin_2024";
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ message: "Yetkisiz" });
  try {
    const sessions = await Session.find().sort({ updatedAt: -1 });
    const userMap = {};
    for (const s of sessions) {
      const key = s.username || String(s.userId);
      if (!userMap[key]) userMap[key] = { username: s.username || "-", sessions: 0, totalHands: 0, lastBalance: 0, lastBankroll: 0, lastActive: null, bestBalance: 0 };
      const u = userMap[key];
      u.sessions++; u.totalHands += s.fullHistory.length;
      if (!u.lastActive || s.updatedAt > u.lastActive) { u.lastActive = s.updatedAt; u.lastBalance = fmt(s.balance); u.lastBankroll = s.bankroll; }
      if (s.balance > u.bestBalance) u.bestBalance = fmt(s.balance);
    }
    const players = Object.values(userMap).map((u) => ({ ...u, pnl: fmt(u.lastBalance - u.lastBankroll), lastActive: u.lastActive ? u.lastActive.toISOString().slice(0, 16).replace("T", " ") : "-" }));
    return res.json({ totalPlayers: players.length, totalSessions: sessions.length, players });
  } catch (err) { return res.status(500).json({ message: "Rapor alinamadi", error: err.message }); }
});

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

app.post("/game/analysis", auth, async (req, res) => {
  try {
    if (!anthropic) return res.json({ ok: false, side: null, reason: "AI devre disi" });
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok" });
    const history = session.bpHistory.slice(-20);
    if (history.length < 5) return res.json({ ok: false, side: null, reason: "Yeterli veri yok" });
    const prompt = "Baccarat el analizi. Son " + history.length + " sonuc: " + history.join(",") + "\nBakiye: " + fmt(session.balance) + ", Bankroll: " + session.bankroll + ", Risk: L" + session.lossLevel + "\nSadece JSON: {\"side\":\"B\"|\"P\"|\"NEUTRAL\",\"reason\":\"max 8 kelime Turkce\"}";
    const msg = await anthropic.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 80, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(msg.content[0].text.trim());
    return res.json({ ok: true, side: parsed.side, reason: parsed.reason });
  } catch (err) { return res.json({ ok: false, side: null, reason: null }); }
});

// ===== DAILY EMAIL REPORT =====
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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
    const html = "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto'><h2 style='color:#333;border-bottom:2px solid #333;padding-bottom:10px'>King Gunluk Rapor - " + dateStr + "</h2><table style='border-collapse:collapse;width:100%'><tr style='background:#2c3e50;color:#fff'><th style='padding:10px;text-align:left'>Oyuncu</th><th style='padding:10px;text-align:right'>Baslangic</th><th style='padding:10px;text-align:right'>Guncel Bakiye</th><th style='padding:10px;text-align:right'>Net Kazanc/Kayip</th></tr>" + rows + "<tr style='background:#ecf0f1;font-weight:bold'><td colspan='3' style='padding:10px;border:1px solid #ddd'>TOPLAM NET</td><td style='padding:10px;border:1px solid #ddd;color:" + totalColor + ";font-size:16px'>" + (totalNet >= 0 ? "+" : "") + totalNet + "</td></tr></table><p style='color:#999;font-size:12px;margin-top:20px'>King Baccarat - Otomatik Gunluk Rapor</p></div>";
    await resend.emails.send({ from: "King Rapor <onboarding@resend.dev>", to: "reportofking@gmail.com", subject: "King Gunluk Rapor - " + dateStr, html });
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

async function startServer() {
  await connectDB();
  app.listen(PORT, () => console.log("Server running on port " + PORT));
}
startServer();
module.exports = app;
