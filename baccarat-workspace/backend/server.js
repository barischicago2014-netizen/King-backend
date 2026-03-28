const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

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

// ===== Schema =====
const GameSchema = new mongoose.Schema({
  result: { type: String, required: true, uppercase: true, trim: true },
  bet: { type: String, required: true, uppercase: true, trim: true },
  balance: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Game = mongoose.model("Game", GameSchema);

// ===== In-memory session =====
let session = {
  balance: 100,
  unit: 0.5,
  history: [],
};

// ===== Strategy =====
function getNextMove(history) {
  if (!history || history.length === 0) {
    return { nextMove: "B", suggestedUnit: 0.5, confidence: 0.5 };
  }

  const allMoves = history.slice(-10).map((h) => h.result);
  // T (tie) sonuçlarını strateji hesabından çıkar
  const lastMoves = allMoves.filter((m) => m === "B" || m === "P");

  if (lastMoves.length === 0) {
    return { nextMove: "B", suggestedUnit: 0.5, confidence: 0.5 };
  }

  let streak = 1;

  for (let i = lastMoves.length - 1; i > 0; i--) {
    if (lastMoves[i] === lastMoves[i - 1]) streak++;
    else break;
  }

  const last = lastMoves[lastMoves.length - 1];
  const countB = lastMoves.filter((m) => m === "B").length;
  const countP = lastMoves.filter((m) => m === "P").length;
  const total = countB + countP;

  const probB = total ? countB / total : 0.5;
  const probP = total ? countP / total : 0.5;

  let prediction = last;
  if (streak >= 3) prediction = last === "B" ? "P" : "B";
  else prediction = probB > probP ? "B" : "P";

  let confidence = Math.max(probB, probP);
  if (streak >= 3) confidence += 0.1;
  if (confidence > 1) confidence = 1;

  let suggestedUnit = 0.5;
  if (confidence > 0.7) suggestedUnit = 1;
  if (confidence > 0.85) suggestedUnit = 1.5;

  return {
    nextMove: prediction,
    suggestedUnit,
    confidence: Number(confidence.toFixed(2)),
  };
}

// ===== Simple Baccarat deal =====
function drawCard() {
  const cards = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  return cards[Math.floor(Math.random() * cards.length)];
}

function cardValue(card) {
  if (card === "A") return 1;
  if (["10", "J", "Q", "K"].includes(card)) return 0;
  return Number(card);
}

function handScore(cards) {
  const total = cards.reduce((sum, c) => sum + cardValue(c), 0);
  return total % 10;
}

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("Backend running");
});

// ===== GAME DEAL =====
app.get("/game/deal", (req, res) => {
  const playerCards = [drawCard(), drawCard()];
  const bankerCards = [drawCard(), drawCard()];

  const playerScore = handScore(playerCards);
  const bankerScore = handScore(bankerCards);

  let winner = "tie";
  if (playerScore > bankerScore) winner = "player";
  else if (bankerScore > playerScore) winner = "banker";

  return res.json({
    player: { cards: playerCards, score: playerScore },
    banker: { cards: bankerCards, score: bankerScore },
    winner,
  });
});

// ===== INIT =====
app.post("/init", (req, res) => {
  const balanceInput = Number(req.body.balanceInput);
  const unitInput = Number(req.body.unitInput);

  session.balance = Number.isFinite(balanceInput) && balanceInput > 0 ? balanceInput : 100;
  session.unit = Number.isFinite(unitInput) && unitInput > 0 ? unitInput : 0.5;
  session.history = [];

  return res.json({
    message: "Session initialized",
    balance: session.balance,
    unit: session.unit,
  });
});

// ===== ADD RESULT =====
app.post("/add-result", async (req, res) => {
  try {
    const { result } = req.body;
    const normalizedResult = String(result || "").toUpperCase().trim();

    if (!["B", "P", "T"].includes(normalizedResult)) {
      return res.status(400).json({ message: "Result must be B, P or T" });
    }

    const nextMove = getNextMove(session.history);
    const bet = nextMove.nextMove;

    let win = false;
    if (normalizedResult === "T") {
      // tie: no balance change
    } else if (normalizedResult === bet) {
      win = true;
      session.balance += session.unit;
    } else {
      session.balance -= session.unit;
    }

    const game = {
      result: normalizedResult,
      bet,
      balance: session.balance,
    };

    // await Game.create(game); // DB save açmak istersen bunu aç
    session.history.push(game);

    return res.json({
      message: normalizedResult === "T" ? "TIE" : win ? "WIN" : "LOSE",
      balance: session.balance,
      last5: session.history.slice(-5),
      nextMove: getNextMove(session.history),
    });
  } catch (err) {
    return res.status(500).json({ message: "Add result failed", error: err.message });
  }
});

// ===== HISTORY =====
app.get("/history", (req, res) => {
  return res.json(session.history.slice().reverse());
});

// ===== START =====
async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

module.exports = app;