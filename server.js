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
  result: { type: String, required: true, uppercase: true, trim: true }, // actual result: B/P/T
  bet: { type: String, required: true, uppercase: true, trim: true },    // predicted side: B/P
  balance: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Game = mongoose.model("Game", GameSchema);

// ===== In-memory session =====
let session = {
  balance: 100,
  unit: 0.5,
  history: []
};

// ===== Strategy =====
function getNextMove(history) {
  // Default fallback
  if (!history || history.length === 0) {
    return { nextMove: "B", suggestedUnit: 0.5, confidence: 0.5 };
  }

  // Get last moves (max 10)
  const lastMoves = history.slice(-10).map((h) => h.result);

  // Count streak
  let streak = 1;
  for (let i = lastMoves.length - 1; i > 0; i--) {
    if (lastMoves[i] === lastMoves[i - 1]) {
      streak++;
    } else {
      break;
    }
  }

  const last = lastMoves[lastMoves.length - 1];

  // Count occurrences
  const countB = lastMoves.filter((m) => m === "B").length;
  const countP = lastMoves.filter((m) => m === "P").length;

  // Simple probability estimation
  const total = countB + countP;
  const probB = total ? countB / total : 0.5;
  const probP = total ? countP / total : 0.5;

  let prediction = last;

  // AI decision logic
  if (streak >= 3) {
    // reversal expected
    prediction = last === "B" ? "P" : "B";
  } else {
    // follow probability
    prediction = probB > probP ? "B" : "P";
  }

  // Confidence score
  let confidence = Math.max(probB, probP);

  // Adjust confidence based on streak
  if (streak >= 3) {
    confidence += 0.1;
  }

  // Clamp confidence
  if (confidence > 1) confidence = 1;

  // Unit sizing logic
  let suggestedUnit = 0.5;
  if (confidence > 0.7) {
    suggestedUnit = 1;
  }
  if (confidence > 0.85) {
    suggestedUnit = 1.5;
  }

  return {
    nextMove: prediction,
    suggestedUnit,
    confidence: Number(confidence.toFixed(2)),
  };
}

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
    unit: session.unit
  });
});

// ===== ADD RESULT =====
app.post("/add-result", async (req, res) => {
  try {
    console.log("BODY:", req.body);

    const { result } = req.body;
    console.log("RESULT:", result);
    console.log("SESSION BEFORE:", JSON.stringify(session, null, 2));
    console.log("HISTORY BEFORE:", session.history);

    if (!["B", "P", "T"].includes(String(result || "").toUpperCase().trim())) {
      return res.status(400).json({ message: "Result must be B, P or T" });
    }

    const nextMove = getNextMove(session.history);
    console.log("NEXT MOVE:", nextMove);

    let bet = nextMove.nextMove;
    console.log("BET:", bet);

    let win = false;
    const normalizedResult = String(result).toUpperCase().trim();

    if (normalizedResult === "T") {
      console.log("TIE RESULT");
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

    console.log("GAME TO SAVE:", game);

    // await Game.create(game);

    session.history.push(game);

    console.log("SESSION AFTER:", JSON.stringify(session, null, 2));
    console.log("HISTORY AFTER:", session.history);

    const last5 = session.history.slice(-5);

    return res.json({
      message: normalizedResult === "T" ? "TIE" : win ? "WIN" : "LOSE",
      balance: session.balance,
      last5,
      nextMove: getNextMove(session.history),
    });
  } catch (err) {
    console.error("ADD RESULT ERROR:", err);
    return res.status(500).json({ message: "Add result failed", error: err.message });
  }
});

// ===== HISTORY =====
app.get("/history", async (req, res) => {
  try {
    const games = await Game.find().sort({ createdAt: -1 }).limit(200);
    return res.json(games);
  } catch (err) {
    console.error("HISTORY ERROR:", err);
    return res.status(500).json({ message: "History fetch failed", error: err.message });
  }
});

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Backend running");
});

// ===== START SERVER =====
async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

module.exports = app;