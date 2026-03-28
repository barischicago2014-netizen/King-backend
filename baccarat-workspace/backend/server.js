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
  balance: { type: Number, default: 100 },
  maxWin: { type: Number, default: 100 },
  fullHistory: [{ type: String }],
  bpHistory: [{ type: String }],
  consecutiveLosses: { type: Number, default: 0 },
  lossStep: { type: Number, default: 0 },
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
const BARRIERS = [90, 80, 70, 60, 50, 40, 30, 20];
const GAME_OVER_TARGET = 103;

function getLeader(bpHistory) {
  const b = bpHistory.filter((r) => r === "B").length;
  const p = bpHistory.filter((r) => r === "P").length;
  return b >= p ? "B" : "P";
}

function applyBarrier(balance, maxWin) {
  // En küçük barajdan başla, balance'ın hemen üstündeki barajı bul
  for (const barrier of [...BARRIERS].reverse()) {
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

  // Waiting for first 3 B/P results
  if (s.bpHistory.length < 3) {
    return {
      recommendation: null, unit: null,
      balance: s.balance, scoreboard, history,
      message: `${3 - s.bpHistory.length} sonuç daha girin`,
      phase: "waiting",
    };
  }

  const leader = getLeader(s.bpHistory);

  // T: no balance change, same recommendation
  if (r === "T") {
    if (!s.currentSuggestion && s.phase !== "observation") {
      s.currentSuggestion = leader;
      s.currentUnit = 1;
      s.phase = "active";
    }
    return {
      recommendation: s.phase === "observation" ? null : s.currentSuggestion,
      unit: s.phase === "observation" ? null : s.currentUnit,
      balance: s.balance, scoreboard, history,
      message: "TIE — Değişiklik yok",
      phase: s.phase,
      observationLeft: s.phase === "observation" ? Math.max(0, 3 - s.observationCount) : 0,
    };
  }

  // Observation mode
  if (s.phase === "observation") {
    s.observationCount++;
    if (s.observationCount >= 3) {
      const recoveryBet = Math.max(1, (s.maxWin + 1) - s.balance);
      s.phase = "active";
      s.currentSuggestion = leader;
      s.currentUnit = recoveryBet;
      s.consecutiveLosses = 0;
      s.lossStep = 0;
      s.observationCount = 0;
      return {
        recommendation: s.currentSuggestion, unit: s.currentUnit,
        balance: s.balance, scoreboard, history,
        message: `Sistem devreye girdi — Öneri: ${s.currentSuggestion} × ${recoveryBet} birim`,
        phase: "active", observationLeft: 0,
      };
    }
    return {
      recommendation: null, unit: null,
      balance: s.balance, scoreboard, history,
      message: `Gözlem: ${3 - s.observationCount} el kaldı`,
      phase: "observation",
      observationLeft: 3 - s.observationCount,
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
    s.balance += s.currentUnit;
    if (s.balance > s.maxWin) s.maxWin = s.balance;
    const msg = `KAZANÇ +${s.currentUnit} birim`;
    s.consecutiveLosses = 0;
    s.lossStep = 0;
    s.currentSuggestion = leader;
    s.currentUnit = 1;

    if (s.balance >= GAME_OVER_TARGET) {
      s.phase = "gameover";
      return {
        gameOver: true, win: true,
        recommendation: null, unit: null,
        balance: s.balance, scoreboard, history,
        message: "GAME OVER! +3 birim hedefine ulaşıldı!",
        phase: "gameover",
      };
    }

    return {
      win: true, recommendation: s.currentSuggestion, unit: s.currentUnit,
      balance: s.balance, scoreboard, history, message: msg, phase: "active", observationLeft: 0,
    };
  } else {
    s.balance -= s.currentUnit;
    s.maxWin = applyBarrier(s.balance, s.maxWin);
    const msg = `KAYIP -${s.currentUnit} birim`;
    s.consecutiveLosses++;

    if (s.consecutiveLosses >= 3) {
      s.phase = "observation";
      s.observationCount = 0;
      s.currentSuggestion = null;
      s.currentUnit = null;
      return {
        win: false, recommendation: null, unit: null,
        balance: s.balance, scoreboard, history,
        message: "3 üst üste kayıp — 3 el gözlem modu",
        phase: "observation", observationLeft: 3,
      };
    }

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
      balance: s.balance, scoreboard, history, message: msg, phase: "active", observationLeft: 0,
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

// In-memory demo session (stateless per deal)
function newDemoSession() {
  return {
    balance: 100, maxWin: 100,
    fullHistory: [], bpHistory: [],
    consecutiveLosses: 0, lossStep: 0,
    phase: "waiting", observationCount: 0,
    currentSuggestion: null, currentUnit: 1,
  };
}
let demoSession = newDemoSession();

// ===== HEALTH =====
app.get("/", (req, res) => res.send("Backend running"));

// ===== AUTH =====
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Kullanıcı adı ve şifre gerekli" });
    if (password.length < 4) return res.status(400).json({ message: "Şifre en az 4 karakter olmalı" });
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) return res.status(400).json({ message: "Bu kullanıcı adı zaten alınmış" });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    const token = jwt.sign({ id: String(user._id), username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, username: user.username });
  } catch (err) {
    return res.status(500).json({ message: "Kayıt başarısız", error: err.message });
  }
});

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
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const session = await Session.create({ userId: req.user.id, username: req.user.username });
    return res.json({
      balance: session.balance, maxWin: session.maxWin,
      scoreboard: { B: 0, P: 0, T: 0 }, recommendation: null,
      unit: null, phase: "waiting", history: [],
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
      balance: session.balance, maxWin: session.maxWin,
      scoreboard: getScoreboard(session.fullHistory),
      recommendation: session.currentSuggestion, unit: session.currentUnit,
      phase: session.phase, history: session.fullHistory.slice(-20),
      observationLeft: session.phase === "observation" ? Math.max(0, 3 - session.observationCount) : 0,
    });
  } catch (err) {
    return res.status(500).json({ message: "State alınamadı", error: err.message });
  }
});

app.post("/game/result", auth, async (req, res) => {
  try {
    const { result } = req.body;
    const session = await Session.findOne({ userId: req.user.id, isActive: true }).sort({ updatedAt: -1 });
    if (!session) return res.status(404).json({ message: "Aktif oyun yok. Önce /game/start çağırın." });
    const state = processResult(result, session);
    await session.save();
    return res.json(state);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

app.post("/game/reset", auth, async (req, res) => {
  try {
    await Session.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    const session = await Session.create({ userId: req.user.id, username: req.user.username });
    return res.json({ message: "Oyun sıfırlandı", balance: session.balance });
  } catch (err) {
    return res.status(500).json({ message: "Reset başarısız", error: err.message });
  }
});

// ===== START =====
async function startServer() {
  await connectDB();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
startServer();
module.exports = app;
