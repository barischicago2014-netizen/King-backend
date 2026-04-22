import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:10000";
const api = axios.create({ baseURL: BASE_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("bac_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const C = {
  bg: "#061a0e", card: "#0f3520", border: "#1a5a30",
  gold: "#ffd700", blue: "#4488ff", red: "#ff4444",
  green: "#44cc77", white: "#ffffff", gray: "#888888", dark: "#444444",
};
const S = {
  page: { minHeight: "100vh", backgroundColor: C.bg, color: C.white, fontFamily: "Arial,sans-serif", display: "flex", flexDirection: "column" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", backgroundColor: C.card, borderBottom: `1px solid ${C.border}` },
  content: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 16px", gap: 16, maxWidth: 480, margin: "0 auto", width: "100%" },
  btnGold: { padding: "14px 0", width: "100%", maxWidth: 300, fontSize: 17, fontWeight: "bold", backgroundColor: C.gold, color: "#000", border: "none", borderRadius: 8, cursor: "pointer" },
btnGhost: { padding: "9px 20px", fontSize: 13, backgroundColor: "transparent", color: C.gray, border: `1px solid ${C.dark}`, borderRadius: 6, cursor: "pointer" },
  input: { width: "100%", padding: "12px 14px", fontSize: 16, backgroundColor: C.bg, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: "border-box", outline: "none" },
  scoreboard: { display: "flex", gap: 20, backgroundColor: C.card, padding: "14px 32px", borderRadius: 12, textAlign: "center", border: `1px solid ${C.border}`, width: "100%", justifyContent: "center" },
  recBox: { backgroundColor: C.card, padding: "20px 32px", borderRadius: 14, textAlign: "center", border: `2px solid ${C.gold}`, width: "100%", minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
};

export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | login | signup | verify | subscribe | bankroll | game | roulette-bankroll | roulette-game
  const [selectedGame, setSelectedGame] = useState("baccarat"); // "baccarat" | "roulette"
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({ username: "", password: "" });
  const [signupForm, setSignupForm] = useState({ username: "", email: "", password: "" });
  const [verifyCode, setVerifyCode] = useState("");
  const [pendingUsername, setPendingUsername] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [formError, setFormError] = useState("");
  const [bankrollInput, setBankrollInput] = useState("");
  const [bankrollError, setBankrollError] = useState("");
  const [loading, setLoading] = useState(false);
  const resultInFlight = useRef(false);
  const [gs, setGs] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [flash, setFlash] = useState(null);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showTableLimit, setShowTableLimit] = useState(false);
  // Roulette state
  const [rgs, setRgs] = useState(null);
  const [rSessionId, setRSessionId] = useState(null);
  const [rLastResult, setRLastResult] = useState(null);
  const rResultInFlight = useRef(false);
  // King of Stand state
  const [kos, setKos] = useState(null);
  const [kosSessionId, setKosSessionId] = useState(null);
  const [kosLastResult, setKosLastResult] = useState(null);
  const kosInFlight = useRef(false);
  // Roulette King of Stand state
  const [rkos, setRkos] = useState(null);
  const [rkosSessionId, setRkosSessionId] = useState(null);
  const rkosInFlight = useRef(false);
  // Blackjack state
  const [bj, setBj] = useState(null);
  const [bjSessionId, setBjSessionId] = useState(null);
  const [bjDealer, setBjDealer] = useState(null);   // dealer upcard
  const [bjHandType, setBjHandType] = useState("hard"); // hard|soft|pair
  const [bjTotal, setBjTotal] = useState(null);      // player total
  const bjInFlight = useRef(false);

  useEffect(() => {
    const token = localStorage.getItem("bac_token");
    const username = localStorage.getItem("bac_user");
    const role = localStorage.getItem("bac_role") || "user";
    if (token && username) setUser({ token, username, role });
  }, []);

  function showFlash(text, color) {
    setFlash({ text, color });
    setTimeout(() => setFlash(null), 2000);
  }

  async function handleLogin() {
    setFormError("");
    if (!termsAccepted) { setFormError("You must accept the Terms of Use to continue"); return; }
    if (!form.username.trim() || !form.password.trim()) { setFormError("Username and password are required"); return; }
    setLoading(true);
    try {
      const res = await api.post("/login", { ...form, termsAccepted });
      localStorage.setItem("bac_token", res.data.token);
      localStorage.setItem("bac_user", res.data.username);
      localStorage.setItem("bac_role", res.data.role || "user");
      setUser({ token: res.data.token, username: res.data.username, role: res.data.role || "user" });
      setForm({ username: "", password: "" });
      setScreen(selectedGame === "roulette" ? "roulette-bankroll" : selectedGame === "kos" ? "kos-bankroll" : selectedGame === "rkos" ? "rkos-bankroll" : selectedGame === "bj" ? "bj-bankroll" : "bankroll");
    } catch (err) {
      const code = err.response?.data?.code;
      const username = err.response?.data?.username;
      if (code === "EMAIL_NOT_VERIFIED" && username) {
        setPendingUsername(username);
        setScreen("verify");
      } else if (code === "NO_PLAN") {
        setScreen("subscribe");
      } else {
        setFormError(err.response?.data?.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    setFormError("");
    if (!signupForm.username.trim() || !signupForm.email.trim() || !signupForm.password.trim()) { setFormError("All fields are required"); return; }
    if (signupForm.password.length < 6) { setFormError("Password must be at least 6 characters"); return; }
    if (!termsAccepted) { setFormError("You must accept the Terms of Use to continue"); return; }
    setLoading(true);
    try {
      await api.post("/signup", signupForm);
      setPendingUsername(signupForm.username.toLowerCase());
      setSignupForm({ username: "", email: "", password: "" });
      setScreen("verify");
    } catch (err) {
      setFormError(err.response?.data?.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setFormError("");
    if (!verifyCode.trim()) { setFormError("Please enter the verification code"); return; }
    setLoading(true);
    try {
      await api.post("/verify-email", { username: pendingUsername, code: verifyCode });
      setVerifyCode("");
      setScreen("subscribe");
    } catch (err) {
      setFormError(err.response?.data?.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    setFormError("");
    setLoading(true);
    try {
      await api.post("/resend-code", { username: pendingUsername });
      setFormError("New code sent to your email");
    } catch (err) {
      setFormError(err.response?.data?.message || "Failed to resend code");
    } finally {
      setLoading(false);
    }
  }

  async function handleBankrollStart() {
    setBankrollError("");
    const amount = parseFloat(bankrollInput);
    if (!amount || amount <= 0) { setBankrollError("Please enter a valid amount"); return; }
    setLoading(true);
    try {
      const res = await api.post("/game/start", { bankroll: amount });
      setGs(res.data);
      setSessionId(res.data.sessionId || null);
      setLastResult(null);
      setBankrollInput("");
      setScreen("game");
    } catch (err) {
      setBankrollError(err.response?.data?.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("bac_token");
    localStorage.removeItem("bac_user");
    setUser(null); setGs(null); setLastResult(null);
    setScreen("landing");
  }

  async function triggerAi() {
    setAiLoading(true);
    setAiData(null);
    try {
      const res = await api.post("/game/analysis");
      setAiData(res.data.ok ? res.data : null);
    } catch { setAiData(null); }
    finally { setAiLoading(false); }
  }

  async function addResult(result) {
    if (resultInFlight.current || gs?.gameOver) return;
    resultInFlight.current = true;
    setLoading(true);
    try {
      const res = await api.post("/game/result", { result, sessionId });
      resultInFlight.current = false;
      setLoading(false);
      setLastResult(result);
      if (res.data.sessionId) setSessionId(res.data.sessionId);
      setGs((prev) => ({ ...prev, ...res.data }));
      if (res.data.tableLimit) {
        setShowTableLimit(true);
        return;
      }
      if (res.data.win === true) {
        showFlash(`+${res.data.actualBet}`, C.green);
        setAiData(null);
      } else if (res.data.win === false) {
        showFlash(`-${res.data.actualBet}`, C.red);
        const b = res.data.balance ?? 0;
        const br = res.data.bankroll ?? gs?.bankroll ?? 0;
        if (br > 0 && b < br * 0.93) triggerAi();
      }
    } catch (err) {
      resultInFlight.current = false;
      setLoading(false);
      if (err.response?.status === 404) setScreen("bankroll");
    }
  }

  async function finishGame() {
    if (!window.confirm("Are you sure you want to end the game? A new game will start with your current balance.")) return;
    setLoading(true);
    try {
      const res = await api.post("/game/finish");
      const newBankroll = res.data.balance;
      const startRes = await api.post("/game/reset", { bankroll: newBankroll });
      setGs({ ...startRes.data, scoreboard: { B: 0, P: 0, T: 0 }, history: [] });
      setSessionId(startRes.data.sessionId || null);
      setLastResult(null);
      setAiData(null);
    } finally { setLoading(false); }
  }

  async function handleRouletteBankrollStart() {
    setBankrollError("");
    const amount = parseFloat(bankrollInput);
    if (!amount || amount <= 0) { setBankrollError("Please enter a valid amount"); return; }
    setLoading(true);
    try {
      const res = await api.post("/roulette/start", { bankroll: amount });
      setRgs(res.data);
      setRSessionId(res.data.sessionId || null);
      setRLastResult(null);
      setBankrollInput("");
      setScreen("roulette-game");
    } catch (err) {
      setBankrollError(err.response?.data?.message || "An error occurred");
    } finally { setLoading(false); }
  }

  async function addRouletteResult(result) {
    if (rResultInFlight.current || rgs?.gameOver) return;
    rResultInFlight.current = true;
    setLoading(true);
    try {
      const res = await api.post("/roulette/result", { result, sessionId: rSessionId });
      rResultInFlight.current = false;
      setLoading(false);
      setRLastResult(result);
      if (res.data.sessionId) setRSessionId(res.data.sessionId);
      setRgs((prev) => ({ ...prev, ...res.data }));
      if (res.data.phase === "active" && res.data.win === true) showFlash("+$" + res.data.baseUnit, C.green);
      else if (res.data.phase === "active" && res.data.win === false) showFlash("-$" + res.data.baseUnit, C.red);
    } catch (err) {
      rResultInFlight.current = false;
      setLoading(false);
      if (err.response?.status === 404) setScreen("roulette-bankroll");
    }
  }

  async function finishRouletteGame() {
    if (!window.confirm("Are you sure you want to end the game? A new game will start with your current balance.")) return;
    setLoading(true);
    try {
      const res = await api.post("/roulette/finish");
      const newBankroll = res.data.balance;
      const startRes = await api.post("/roulette/reset", { bankroll: newBankroll });
      setRgs(startRes.data);
      setRSessionId(startRes.data.sessionId || null);
      setRLastResult(null);
    } finally { setLoading(false); }
  }

  async function resetRouletteGame() {
    const newBankroll = rgs?.balance || rgs?.bankroll || 100;
    setLoading(true);
    try {
      const res = await api.post("/roulette/reset", { bankroll: newBankroll });
      setRgs(res.data);
      setRSessionId(res.data.sessionId || null);
      setRLastResult(null);
    } finally { setLoading(false); }
  }

  async function startKos(amount) {
    setLoading(true);
    try {
      const res = await api.post("/kos/start", { bankroll: amount });
      setKos(res.data);
      setKosSessionId(res.data.sessionId || null);
      setKosLastResult(null);
      setScreen("kos-game");
    } finally { setLoading(false); }
  }

  async function addKosResult(result) {
    if (kosInFlight.current || kos?.gameOver) return;
    kosInFlight.current = true;
    setLoading(true);
    try {
      const res = await api.post("/kos/result", { result, sessionId: kosSessionId });
      kosInFlight.current = false;
      setLoading(false);
      setKosLastResult(result);
      if (res.data.sessionId) setKosSessionId(res.data.sessionId);
      const newData = { ...res.data };
      if (res.data.balance >= (res.data.bankroll ?? 100) * 1.10) newData.dailyGameOver = true;
      setKos((prev) => ({ ...prev, ...newData }));
      if (res.data.win === true) showFlash("WIN!", C.green);
      else if (res.data.win === false) showFlash("LOSS", C.red);
    } catch (err) {
      kosInFlight.current = false;
      setLoading(false);
      if (err.response?.status === 404) setScreen("kos-bankroll");
    }
  }

  async function finishKosGame() {
    if (!window.confirm("End this game? A new game will start with your current balance.")) return;
    setLoading(true);
    try {
      const res = await api.post("/kos/finish");
      const newBankroll = res.data.balance;
      const startRes = await api.post("/kos/reset", { bankroll: newBankroll });
      setKos(startRes.data);
      setKosSessionId(startRes.data.sessionId || null);
      setKosLastResult(null);
    } finally { setLoading(false); }
  }

  async function resetKosGame() {
    const newBankroll = kos?.balance || kos?.bankroll || 100;
    setLoading(true);
    try {
      const res = await api.post("/kos/reset", { bankroll: newBankroll });
      setKos(res.data);
      setKosSessionId(res.data.sessionId || null);
      setKosLastResult(null);
    } finally { setLoading(false); }
  }

  async function startRkos(amount) {
    setLoading(true);
    try {
      const res = await api.post("/rkos/start", { bankroll: amount });
      setRkos(res.data); setRkosSessionId(res.data.sessionId || null);
      setScreen("rkos-game");
    } finally { setLoading(false); }
  }

  async function addRkosResult(result) {
    if (rkosInFlight.current || rkos?.gameOver) return;
    rkosInFlight.current = true; setLoading(true);
    try {
      const res = await api.post("/rkos/result", { result, sessionId: rkosSessionId });
      rkosInFlight.current = false; setLoading(false);
      if (res.data.sessionId) setRkosSessionId(res.data.sessionId);
      const newRData = { ...res.data };
      if (res.data.balance >= (res.data.bankroll ?? 100) * 1.10) newRData.dailyGameOver = true;
      setRkos((prev) => ({ ...prev, ...newRData }));
      if (res.data.win === true) showFlash("WIN!", C.green);
      else if (res.data.win === false) showFlash("LOSS", C.red);
    } catch (err) {
      rkosInFlight.current = false; setLoading(false);
      if (err.response?.status === 404) setScreen("rkos-bankroll");
    }
  }

  async function finishRkosGame() {
    if (!window.confirm("End this game? A new game will start with your current balance.")) return;
    setLoading(true);
    try {
      const res = await api.post("/rkos/finish");
      const startRes = await api.post("/rkos/reset", { bankroll: res.data.balance });
      setRkos(startRes.data); setRkosSessionId(startRes.data.sessionId || null);
    } finally { setLoading(false); }
  }

  async function resetRkosGame() {
    const newBankroll = rkos?.balance || rkos?.bankroll || 100;
    setLoading(true);
    try {
      const res = await api.post("/rkos/reset", { bankroll: newBankroll });
      setRkos(res.data); setRkosSessionId(res.data.sessionId || null);
    } finally { setLoading(false); }
  }

  async function startBj(amount) {
    setLoading(true);
    try {
      const res = await api.post("/bj/start", { bankroll: amount });
      setBj(res.data); setBjSessionId(res.data.sessionId || null);
      setBjDealer(null); setBjHandType("hard"); setBjTotal(null);
      setScreen("bj-game");
    } finally { setLoading(false); }
  }

  async function addBjResult(result) {
    if (bjInFlight.current || bj?.gameOver) return;
    bjInFlight.current = true; setLoading(true);
    try {
      const res = await api.post("/bj/result", { result, sessionId: bjSessionId });
      bjInFlight.current = false; setLoading(false);
      if (res.data.sessionId) setBjSessionId(res.data.sessionId);
      const newData = { ...res.data };
      if (res.data.balance >= (res.data.bankroll ?? 100) * 1.10) newData.dailyGameOver = true;
      setBj((prev) => ({ ...prev, ...newData }));
      setBjDealer(null); setBjHandType("hard"); setBjTotal(null);
      if (result === "W") showFlash("WIN!", C.green);
      else if (result === "L") showFlash("LOSS", C.red);
      else showFlash("PUSH", C.gray);
    } catch (err) {
      bjInFlight.current = false; setLoading(false);
      if (err.response?.status === 404) setScreen("bj-bankroll");
    }
  }

  async function finishBjGame() {
    if (!window.confirm("End this game? A new game will start with your current balance.")) return;
    setLoading(true);
    try {
      const res = await api.post("/bj/finish");
      const startRes = await api.post("/bj/reset", { bankroll: res.data.balance });
      setBj(startRes.data); setBjSessionId(startRes.data.sessionId || null);
      setBjDealer(null); setBjHandType("hard"); setBjTotal(null);
    } finally { setLoading(false); }
  }

  async function resetBjGame() {
    const newBankroll = bj?.balance || bj?.bankroll || 100;
    setLoading(true);
    try {
      const res = await api.post("/bj/reset", { bankroll: newBankroll });
      setBj(res.data); setBjSessionId(res.data.sessionId || null);
      setBjDealer(null); setBjHandType("hard"); setBjTotal(null);
    } finally { setLoading(false); }
  }

  async function resetGame() {
    const newBankroll = gs?.balance || gs?.bankroll || 100;
    setLoading(true);
    try {
      const res = await api.post("/game/reset", { bankroll: newBankroll });
      setGs({ ...res.data, scoreboard: { B: 0, P: 0, T: 0 }, history: [] });
      setSessionId(res.data.sessionId || null);
      setLastResult(null);
      setAiData(null);
    } finally { setLoading(false); }
  }

  function ScoreboardBlock({ sc }) {
    return (
      <div style={S.scoreboard}>
        {[{ l: "P", c: C.blue }, { l: "T", c: C.gray }, { l: "B", c: C.red }].map(({ l, c }, i) => (
          <React.Fragment key={l}>
            {i > 0 && <div style={{ width: 1, backgroundColor: C.border }} />}
            <div style={{ textAlign: "center" }}>
              <div style={{ color: c, fontSize: 20, fontWeight: "bold" }}>{l}</div>
              <div style={{ fontSize: 26, fontWeight: "bold" }}>{sc[l]}</div>
            </div>
          </React.Fragment>
        ))}
      </div>
    );
  }

  function HistoryChips({ history }) {
    if (!history || history.length === 0) return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center", maxWidth: 380 }}>
        {[...history].reverse().map((r, i) => (
          <span key={i} style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, fontWeight: "bold", fontSize: 13, backgroundColor: i === 0 ? (r === "B" ? "#5a1a1a" : r === "P" ? "#1a3a6a" : "#333") : C.card, color: r === "B" ? C.red : r === "P" ? C.blue : C.gray, border: `1px solid ${C.border}` }}>{r}</span>
        ))}
      </div>
    );
  }

  function FlashOverlay() {
    if (!flash) return null;
    return <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", backgroundColor: flash.color, color: "#000", padding: "10px 28px", borderRadius: 20, fontWeight: "bold", fontSize: 20, zIndex: 200, pointerEvents: "none" }}>{flash.text}</div>;
  }

  // ═══ LANDING ════════════════════════════════════════
  if (screen === "landing") {
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ fontSize: 64, marginBottom: 4 }}>♠</div>
          <h1 style={{ fontSize: 42, color: C.gold, margin: "0 0 8px", letterSpacing: 2 }}>BACCARAT</h1>
          <p style={{ color: C.gray, marginBottom: 48, fontSize: 14 }}>Strategy System</p>
          <button style={{ ...S.btnGold, marginBottom: 10 }} onClick={() => { setFormError(""); setSelectedGame("baccarat"); setScreen("login"); }}>Sign In — Baccarat</button>
          <button style={{ padding: "13px 0", width: "100%", maxWidth: 300, fontSize: 16, fontWeight: "bold", backgroundColor: "transparent", color: "#cc2233", border: "2px solid #cc2233", borderRadius: 8, cursor: "pointer", marginBottom: 10 }} onClick={() => { setFormError(""); setSelectedGame("roulette"); setScreen("login"); }}>Sign In — Roulette</button>
          <button style={{ padding: "13px 0", width: "100%", maxWidth: 300, fontSize: 16, fontWeight: "bold", backgroundColor: "transparent", color: "#4488ff", border: "2px solid #4488ff", borderRadius: 8, cursor: "pointer", marginBottom: 10 }} onClick={() => { setFormError(""); setSelectedGame("kos"); setScreen(user ? "kos-bankroll" : "login"); }}>Sign In — King of Stand</button>
          <button style={{ padding: "13px 0", width: "100%", maxWidth: 300, fontSize: 16, fontWeight: "bold", backgroundColor: "transparent", color: "#44bbaa", border: "2px solid #44bbaa", borderRadius: 8, cursor: "pointer", marginBottom: 10 }} onClick={() => { setFormError(""); setSelectedGame("rkos"); setScreen(user ? "rkos-bankroll" : "login"); }}>Sign In — Roulette Stand</button>
          <button style={{ padding: "13px 0", width: "100%", maxWidth: 300, fontSize: 16, fontWeight: "bold", backgroundColor: "transparent", color: "#ff9900", border: "2px solid #ff9900", borderRadius: 8, cursor: "pointer", marginBottom: 10 }} onClick={() => { setFormError(""); setSelectedGame("bj"); setScreen(user ? "bj-bankroll" : "login"); }}>Sign In — Blackjack Stand</button>
          <button style={{ padding: "13px 0", width: "100%", maxWidth: 300, fontSize: 16, fontWeight: "bold", backgroundColor: "transparent", color: C.gold, border: `2px solid ${C.gold}`, borderRadius: 8, cursor: "pointer", marginBottom: 10 }} onClick={() => { setFormError(""); setTermsAccepted(false); setScreen("signup"); }}>Create Account</button>
          {user?.role === "admin" && (
            <button style={{ padding: "9px 0", width: "100%", maxWidth: 300, fontSize: 13, backgroundColor: "transparent", color: "#888", border: "1px solid #333", borderRadius: 6, cursor: "pointer" }} onClick={() => setScreen("admin")}>Admin Panel</button>
          )}
        </div>
      </div>
    );
  }

  // ═══ LOGIN ══════════════════════════════════════════
  if (screen === "login") {
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, padding: 32, borderRadius: 14, width: "100%", maxWidth: 320 }}>
            <h2 style={{ color: C.gold, textAlign: "center", marginBottom: 24, fontSize: 22 }}>Sign In</h2>
            <input style={{ ...S.input, marginBottom: 12 }} placeholder="Username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoComplete="username" />
            <input style={{ ...S.input, marginBottom: 16 }} type="password" placeholder="Password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoComplete="current-password" />
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14, cursor: "pointer" }} onClick={() => setTermsAccepted(t => !t)}>
              <div style={{ width: 20, height: 20, minWidth: 20, border: `2px solid ${termsAccepted ? C.gold : C.border}`, borderRadius: 4, backgroundColor: termsAccepted ? C.gold : "transparent", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                {termsAccepted && <span style={{ color: "#000", fontSize: 13, fontWeight: "bold" }}>✓</span>}
              </div>
              <span style={{ color: C.gray, fontSize: 12, lineHeight: 1.5 }}>
                I have read and agree to the{" "}
                <a href="/terms.pdf" target="_blank" rel="noopener noreferrer" style={{ color: C.gold }} onClick={e => e.stopPropagation()}>Terms of Use</a>.
                {" "}I confirm I am 21+ and online gambling is legal in my jurisdiction.
              </span>
            </div>
            {formError && <p style={{ color: C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{formError}</p>}
            <button style={{ ...S.btnGold, marginBottom: 10, opacity: termsAccepted ? 1 : 0.5 }} onClick={handleLogin} disabled={loading}>{loading ? "..." : "Sign In"}</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center", marginBottom: 8 }} onClick={() => { setFormError(""); setTermsAccepted(false); setScreen("signup"); }}>Don't have an account? Sign Up</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={() => setScreen("landing")}>← Back</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ SIGNUP ═════════════════════════════════════════
  if (screen === "signup") {
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, padding: 32, borderRadius: 14, width: "100%", maxWidth: 320 }}>
            <h2 style={{ color: C.gold, textAlign: "center", marginBottom: 24, fontSize: 22 }}>Create Account</h2>
            <input style={{ ...S.input, marginBottom: 12 }} placeholder="Username" value={signupForm.username} onChange={(e) => setSignupForm(f => ({ ...f, username: e.target.value }))} autoComplete="username" />
            <input style={{ ...S.input, marginBottom: 12 }} type="email" placeholder="Email" value={signupForm.email} onChange={(e) => setSignupForm(f => ({ ...f, email: e.target.value }))} autoComplete="email" />
            <input style={{ ...S.input, marginBottom: 16 }} type="password" placeholder="Password (min 6 characters)" value={signupForm.password} onChange={(e) => setSignupForm(f => ({ ...f, password: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleSignup()} autoComplete="new-password" />
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14, cursor: "pointer" }} onClick={() => setTermsAccepted(t => !t)}>
              <div style={{ width: 20, height: 20, minWidth: 20, border: `2px solid ${termsAccepted ? C.gold : C.border}`, borderRadius: 4, backgroundColor: termsAccepted ? C.gold : "transparent", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                {termsAccepted && <span style={{ color: "#000", fontSize: 13, fontWeight: "bold" }}>✓</span>}
              </div>
              <span style={{ color: C.gray, fontSize: 12, lineHeight: 1.5 }}>
                I have read and agree to the{" "}
                <a href="/terms.pdf" target="_blank" rel="noopener noreferrer" style={{ color: C.gold }} onClick={e => e.stopPropagation()}>Terms of Use</a>.
                {" "}I confirm I am 21+ and online gambling is legal in my jurisdiction.
              </span>
            </div>
            {formError && <p style={{ color: C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{formError}</p>}
            <button style={{ ...S.btnGold, marginBottom: 10, opacity: termsAccepted ? 1 : 0.5 }} onClick={handleSignup} disabled={loading}>{loading ? "..." : "Create Account"}</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={() => { setFormError(""); setScreen("login"); }}>Already have an account? Sign In</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ VERIFY EMAIL ════════════════════════════════════
  if (screen === "verify") {
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, padding: 32, borderRadius: 14, width: "100%", maxWidth: 320 }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📧</div>
              <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 8px" }}>Check Your Email</h2>
              <p style={{ color: C.gray, fontSize: 13, margin: 0 }}>We sent a 6-digit code to your email. Enter it below.</p>
            </div>
            <input style={{ ...S.input, marginBottom: 16, fontSize: 24, textAlign: "center", letterSpacing: 8 }} placeholder="000000" maxLength={6} value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && handleVerify()} />
            {formError && <p style={{ color: formError.includes("sent") ? C.green : C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{formError}</p>}
            <button style={{ ...S.btnGold, marginBottom: 10 }} onClick={handleVerify} disabled={loading}>{loading ? "..." : "Verify Email"}</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center", marginBottom: 8 }} onClick={handleResendCode} disabled={loading}>Resend Code</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={() => setScreen("landing")}>← Back</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ SUBSCRIBE ═══════════════════════════════════════
  if (screen === "subscribe") {
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, padding: 32, borderRadius: 14, width: "100%", maxWidth: 320, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>♠</div>
            <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 8px" }}>Subscription Required</h2>
            <p style={{ color: C.gray, fontSize: 13, marginBottom: 8 }}>Get full access to King Strategy.</p>
            <div style={{ backgroundColor: "#0a2a16", borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ color: C.gold, fontSize: 32, fontWeight: "bold" }}>$24.50<span style={{ fontSize: 14, color: C.gray }}>/first month</span></div>
              <div style={{ color: C.gray, fontSize: 12, marginBottom: 4 }}>then $49/month</div>
              <div style={{ color: C.green, fontSize: 12 }}>✓ First day free trial</div>
              <div style={{ color: C.green, fontSize: 12 }}>✓ 2 hours daily access</div>
              <div style={{ color: C.green, fontSize: 12 }}>✓ Real-time strategy system</div>
            </div>
            <a href="https://whop.com/trickandtreat-org/king-strategy" target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "14px 0", width: "100%", fontSize: 17, fontWeight: "bold", backgroundColor: C.gold, color: "#000", border: "none", borderRadius: 8, cursor: "pointer", textDecoration: "none", marginBottom: 12 }}>Subscribe on Whop</a>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={() => setScreen("login")}>← Back to Sign In</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ BANKROLL ═══════════════════════════════════════
  if (screen === "bankroll") {
    const preview = parseFloat(bankrollInput);
    const unitPreview = preview > 0 ? (preview * 0.01).toFixed(2) : null;
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, padding: 32, borderRadius: 14, width: "100%", maxWidth: 320 }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ color: C.gray, fontSize: 13, marginBottom: 4 }}>👤 {user?.username}</div>
              <h2 style={{ color: C.gold, fontSize: 22, margin: 0 }}>Enter Your Bankroll</h2>
            </div>
            <input
              style={{ ...S.input, marginBottom: 8, fontSize: 22, textAlign: "center" }}
              type="number"
              placeholder="0"
              value={bankrollInput}
              onChange={(e) => setBankrollInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBankrollStart()}
              autoFocus
            />
            {unitPreview && (
              <p style={{ color: C.gray, fontSize: 13, textAlign: "center", marginBottom: 12 }}>
                Unit value: <span style={{ color: C.gold }}>{unitPreview}</span> (bankroll × 1%)
              </p>
            )}
            {bankrollError && <p style={{ color: C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{bankrollError}</p>}
            <button style={{ ...S.btnGold, marginBottom: 10 }} onClick={handleBankrollStart} disabled={loading}>{loading ? "..." : "Start Game"}</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={handleLogout}>Sign Out</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ GAME (authenticated) ════════════════════════════
  if (screen === "game") {
    const sc = gs?.scoreboard || { B: 0, P: 0, T: 0 };
    const phase = gs?.phase;
    const gameTarget = gs?.targetMax ?? (gs?.bankroll != null && gs?.baseUnit != null ? gs.bankroll + gs.baseUnit * 0.8 : null);
    return (
      <div style={S.page}>
        {showTableLimit && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
            <div style={{ background: "#1a1a2e", border: "1px solid #f5c518", borderRadius: 12, padding: 28, maxWidth: 320, textAlign: "center" }}>
              <div style={{ color: "#f5c518", fontWeight: "bold", fontSize: 16, marginBottom: 12 }}>Table Limit Reached</div>
              <div style={{ color: "#ccc", fontSize: 14, marginBottom: 20 }}>It's better to switch table. If you wish to continue press OK or Exit.</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button style={{ ...S.btn, background: C.green, padding: "10px 24px" }} onClick={() => setShowTableLimit(false)}>OK</button>
                <button style={{ ...S.btn, background: C.red, padding: "10px 24px" }} onClick={() => { setShowTableLimit(false); finishGame(); }}>Exit</button>
              </div>
            </div>
          </div>
        )}
        <div style={S.header}>
          <span style={{ color: C.gray, fontSize: 12 }}>👤 {user?.username}</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.gold, fontWeight: "bold", fontSize: 20 }}>{gs?.balance?.toFixed(2) ?? "—"}</div>
            <div style={{ color: C.gray, fontSize: 11 }}>unit: {gs?.baseUnit?.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: C.gray, fontSize: 10 }}>Target: <span style={{ color: C.green }}>{gameTarget != null ? gameTarget.toFixed(2) : "—"}</span></div>
            {gs?.lossLevel > 0 && <div style={{ color: "#ff8844", fontSize: 10 }}>Risk: L{gs.lossLevel}</div>}
          </div>
        </div>
        <div style={S.content}>
          <ScoreboardBlock sc={sc} />

          {gs && !gs.gameOver && (
            <div style={S.recBox}>
              {phase === "waiting" ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 6 }}>SETUP</div><div style={{ color: C.gray, fontSize: 18 }}>{Math.max(0, 3 - (gs?.sessionHandCount || 0))} more results needed</div></>
              ) : gs.recommendation ? (
                <>
                  <div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>SYSTEM RECOMMENDATION</div>
                  <div style={{ fontSize: 42, fontWeight: "bold", marginBottom: 4, color: gs.recommendation === "B" ? C.red : C.blue }}>{gs.recommendation === "B" ? "BANKER" : "PLAYER"}</div>
                  <div style={{ color: C.gold, fontSize: 20, fontWeight: "bold" }}>{gs.unit} units</div>
                  {gs.actualBet && <div style={{ color: C.white, fontSize: 16, marginTop: 4, opacity: 0.8 }}>({gs.actualBet})</div>}
                </>
              ) : null}
            </div>
          )}

          {gs?.message && !gs.gameOver && (
            <div style={{ fontSize: 14, fontWeight: "bold", padding: "8px 18px", borderRadius: 8, backgroundColor: C.card, color: gs.message.startsWith("WIN") ? C.green : gs.message.startsWith("LOSS") ? C.red : C.white }}>{gs.message}</div>
          )}

          {(aiLoading || aiData) && !gs?.gameOver && (
            <div style={{ width: "100%", padding: "10px 16px", borderRadius: 10, backgroundColor: "#1a1a2e", border: "1px solid #6644aa", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              {aiLoading ? (
                <span style={{ color: "#aaaadd", fontSize: 13 }}>AI analyzing...</span>
              ) : aiData ? (
                <span style={{ fontSize: 13 }}>
                  <span style={{ color: "#aaaadd" }}>AI: </span>
                  <span style={{ color: aiData.side === "B" ? C.red : aiData.side === "P" ? C.blue : C.gray, fontWeight: "bold" }}>
                    {aiData.side === "B" ? "BANKER" : aiData.side === "P" ? "PLAYER" : "NEUTRAL"}
                  </span>
                  {aiData.confidence && (
                    <span style={{ color: aiData.confidence === "HIGH" ? C.green : aiData.confidence === "LOW" ? C.red : "#ffaa44", fontSize: 11, marginLeft: 4 }}>
                      [{aiData.confidence}]
                    </span>
                  )}
                  {aiData.reason && <span style={{ color: C.gray }}> — {aiData.reason}</span>}
                </span>
              ) : null}
            </div>
          )}

          {gs?.gameOver ? (
            <div style={{ textAlign: "center", padding: 24, width: "100%" }}>
              <div style={{ fontSize: 48, fontWeight: "bold", color: C.gold, marginBottom: 8 }}>GAME OVER</div>
              <div style={{ color: C.green, fontSize: 20, marginBottom: 8 }}>Balance: {gs.balance?.toFixed(2)}</div>
              <div style={{ color: C.gray, fontSize: 13, marginBottom: 24 }}>New unit: {gs.balance ? (gs.balance * 0.01).toFixed(2) : "—"}</div>
              <button style={{ ...S.btnGold, marginBottom: 12 }} onClick={resetGame} disabled={loading}>{loading ? "..." : "Play Again"}</button>
              <button style={{ ...S.btnGhost, width: "100%", maxWidth: 300, marginBottom: 10 }} onClick={() => { const a = document.createElement("a"); a.href = `${api.defaults.baseURL}/game/export`; a.setAttribute("download", ""); const token = localStorage.getItem("bac_token"); fetch(a.href, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.blob()).then(b => { a.href = URL.createObjectURL(b); a.click(); }); }}>Download Report (CSV)</button>
              <button style={{ ...S.btnGhost, width: "100%", maxWidth: 300 }} onClick={handleLogout}>Sign Out</button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 14, width: "100%", justifyContent: "center" }}>
                {[{ l: "P", sub: "PLAYER", color: C.blue }, { l: "T", sub: "TIE", color: C.dark }, { l: "B", sub: "BANKER", color: C.red }].map(({ l, sub, color }) => (
                  <button key={l} onClick={() => addResult(l)} style={{ flex: 1, maxWidth: 120, height: 100, fontSize: 32, fontWeight: "bold", backgroundColor: color, color: C.white, border: lastResult === l ? `3px solid ${C.gold}` : "3px solid transparent", borderRadius: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}>
                    {l}<span style={{ fontSize: 11, fontWeight: "normal", opacity: 0.8 }}>{sub}</span>
                  </button>
                ))}
              </div>
              {lastResult && <div style={{ color: C.gray, fontSize: 13 }}>Last entered: <span style={{ color: lastResult === "B" ? C.red : lastResult === "P" ? C.blue : C.gray, fontWeight: "bold" }}>{lastResult}</span></div>}
              <button onClick={finishGame} disabled={loading} style={{ marginTop: 8, padding: "10px 28px", fontSize: 13, backgroundColor: "transparent", color: "#ff8844", border: "1px solid #ff8844", borderRadius: 8, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                End Game
              </button>
            </>
          )}

          <HistoryChips history={gs?.history} />
        </div>
        <FlashOverlay />
      </div>
    );
  }

  // ═══ ROULETTE BANKROLL ══════════════════════════════════════════════════════
  if (screen === "roulette-bankroll") {
    const preview = parseFloat(bankrollInput);
    const unitPreview = preview > 0 ? (preview * 0.01).toFixed(2) : null;
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: C.card, border: "1px solid #cc2233", padding: 32, borderRadius: 14, width: "100%", maxWidth: 320 }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 4 }}>🎰</div>
              <div style={{ color: C.gray, fontSize: 13, marginBottom: 4 }}>👤 {user?.username}</div>
              <h2 style={{ color: "#cc2233", fontSize: 22, margin: 0 }}>Roulette — Enter Bankroll</h2>
            </div>
            <input style={{ ...S.input, marginBottom: 8, fontSize: 22, textAlign: "center" }} type="number" placeholder="0" value={bankrollInput} onChange={(e) => setBankrollInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRouletteBankrollStart()} autoFocus />
            {unitPreview && <p style={{ color: C.gray, fontSize: 13, textAlign: "center", marginBottom: 12 }}>Unit value: <span style={{ color: "#cc2233" }}>{unitPreview}</span> (bankroll × 1%)</p>}
            {bankrollError && <p style={{ color: C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{bankrollError}</p>}
            <button style={{ ...S.btnGold, backgroundColor: "#cc2233", color: C.white, marginBottom: 10 }} onClick={handleRouletteBankrollStart} disabled={loading}>{loading ? "..." : "Start Roulette"}</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={handleLogout}>Sign Out</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ ROULETTE GAME ══════════════════════════════════════════════════════════
  if (screen === "roulette-game") {
    const rsc = rgs?.scoreboard || { L: 0, H: 0, Z: 0 };
    const rphase = rgs?.phase;
    const rTarget = (rgs?.targetMax ?? rgs?.bankroll) != null ? parseFloat(((rgs?.targetMax ?? rgs?.bankroll) + 2 * (rgs?.baseUnit ?? 0)).toFixed(2)) : null;

    const rBtnStyle = (bg, isLast) => ({
      flex: 1, maxWidth: 160, height: 90, fontSize: 22, fontWeight: "bold",
      backgroundColor: bg, color: C.white,
      border: isLast ? `3px solid ${C.gold}` : "3px solid transparent",
      borderRadius: 14, cursor: "pointer",
      WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
    });

    return (
      <div style={S.page}>
        <div style={S.header}>
          <span style={{ color: C.gray, fontSize: 12 }}>👤 {user?.username}</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#cc2233", fontWeight: "bold", fontSize: 20 }}>{rgs?.balance?.toFixed(2) ?? "—"}</div>
            <div style={{ color: C.gray, fontSize: 11 }}>unit: {rgs?.baseUnit?.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: C.gray, fontSize: 10 }}>Target: <span style={{ color: C.green }}>{rTarget ?? "—"}</span></div>
            {rgs?.lossLevel > 0 && <div style={{ color: "#ff8844", fontSize: 10 }}>Risk: L{rgs.lossLevel}</div>}
          </div>
        </div>

        <div style={S.content}>
          {/* Scoreboard */}
          <div style={S.scoreboard}>
            {[{ l: "LOW", k: "L", c: C.blue }, { l: "HIGH", k: "H", c: C.red }, { l: "ZERO", k: "Z", c: "#1a6633" }].map(({ l, k, c }) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ color: c, fontSize: 13, fontWeight: "bold" }}>{l}</div>
                <div style={{ fontSize: 22, fontWeight: "bold" }}>{rsc[k]}</div>
              </div>
            ))}
          </div>

          {/* Recommendation box */}
          {rgs && !rgs.gameOver && (
            <div style={S.recBox}>
              {rphase === "waiting" ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 6 }}>SETUP</div>
                <div style={{ color: C.gray, fontSize: 18 }}>{rgs.message}</div></>
              ) : rphase === "observation" ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 6 }}>OBSERVATION</div>
                <div style={{ color: "#ffaa44", fontSize: 16 }}>{rgs.message}</div></>
              ) : rgs.suggestion ? (
                <>
                  <div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>SYSTEM RECOMMENDATION</div>
                  <div style={{ fontSize: 32, fontWeight: "bold", color: rgs.suggestion === "L" ? C.blue : C.red }}>
                    {rgs.suggestion === "L" ? "LOW" : "HIGH"}
                  </div>
                  <div style={{ color: C.gold, fontSize: 16, marginTop: 4 }}>{rgs.unit} unit{rgs.unit > 1 ? "s" : ""} — ${((rgs.unit || 1) * (rgs.baseUnit || 0)).toFixed(2)}</div>
                </>
              ) : null}
            </div>
          )}

          {/* Message */}
          {rgs?.message && !rgs.gameOver && rphase === "active" && (
            <div style={{ fontSize: 13, fontWeight: "bold", padding: "8px 18px", borderRadius: 8, backgroundColor: C.card, color: rgs.message.startsWith("WIN") ? C.green : rgs.message.startsWith("LOSS") || rgs.message.startsWith("ZERO") ? C.red : "#ffaa44" }}>{rgs.message}</div>
          )}

          {/* Game Over or Buttons */}
          {rgs?.gameOver ? (
            <div style={{ textAlign: "center", padding: 24, width: "100%" }}>
              <div style={{ fontSize: 48, fontWeight: "bold", color: "#cc2233", marginBottom: 8 }}>GAME OVER</div>
              <div style={{ color: C.green, fontSize: 20, marginBottom: 8 }}>Balance: {rgs.balance?.toFixed(2)}</div>
              <div style={{ color: C.gray, fontSize: 13, marginBottom: 24 }}>New unit: {rgs.balance ? (rgs.balance * 0.01).toFixed(2) : "—"}</div>
              <button style={{ ...S.btnGold, backgroundColor: "#cc2233", color: C.white, marginBottom: 12 }} onClick={resetRouletteGame} disabled={loading}>{loading ? "..." : "Play Again"}</button>
              <button style={{ ...S.btnGhost, width: "100%", maxWidth: 300 }} onClick={handleLogout}>Sign Out</button>
            </div>
          ) : (
            <>
              {/* 3 buttons: LOW | HIGH | ZERO */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 10, width: "100%", justifyContent: "center" }}>
                  <button onClick={() => addRouletteResult("L")} style={rBtnStyle(C.blue, rLastResult === "L")}>LOW</button>
                  <button onClick={() => addRouletteResult("H")} style={rBtnStyle(C.red, rLastResult === "H")}>HIGH</button>
                </div>
                <button onClick={() => addRouletteResult("Z")} style={{ width: "60%", maxWidth: 200, height: 56, fontSize: 16, fontWeight: "bold", backgroundColor: "#1a6633", color: C.white, border: rLastResult === "Z" ? `3px solid ${C.gold}` : "3px solid transparent", borderRadius: 14, cursor: "pointer", WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}>
                  ZERO (0 / 00)
                </button>
              </div>
              {rLastResult && (
                <div style={{ color: C.gray, fontSize: 13 }}>Last: <span style={{ fontWeight: "bold", color: rLastResult === "Z" ? "#44cc77" : rLastResult === "L" ? C.blue : C.red }}>{rLastResult === "L" ? "LOW" : rLastResult === "H" ? "HIGH" : "ZERO"}</span></div>
              )}
              <button onClick={finishRouletteGame} disabled={loading} style={{ marginTop: 8, padding: "10px 28px", fontSize: 13, backgroundColor: "transparent", color: "#ff8844", border: "1px solid #ff8844", borderRadius: 8, cursor: "pointer" }}>End Game</button>
            </>
          )}

          {/* History chips */}
          {rgs?.history && rgs.history.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center", maxWidth: 380 }}>
              {[...rgs.history].reverse().map((r, i) => (
                <span key={i} style={{ width: 36, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, fontWeight: "bold", fontSize: 11,
                  backgroundColor: r === "Z" ? "#1a4a2a" : r === "L" ? "#1a2a4a" : "#4a1a1a",
                  color: r === "Z" ? "#44cc77" : r === "L" ? "#6699ff" : "#ff6666",
                  border: `1px solid ${C.border}` }}>
                  {r === "Z" ? "0" : r}
                </span>
              ))}
            </div>
          )}
        </div>
        <FlashOverlay />
      </div>
    );
  }

  if (screen === "admin") {
    return <AdminPanel user={user} onBack={() => setScreen("landing")} />;
  }

  // ═══ ROULETTE KING OF STAND — BANKROLL ══════════════════════════════════
  if (screen === "rkos-bankroll") {
    const unitPreview = bankrollInput ? `$${(parseFloat(bankrollInput) * 0.01).toFixed(2)}` : null;
    return (
      <div style={S.page}><div style={S.content}>
        <div style={{ backgroundColor: C.card, border: "1px solid #44bbaa", padding: 32, borderRadius: 14, width: "100%", maxWidth: 320 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 4 }}>🎡</div>
            <div style={{ color: C.gray, fontSize: 13, marginBottom: 4 }}>👤 {user?.username}</div>
            <h2 style={{ color: "#44bbaa", fontSize: 22, margin: 0 }}>Roulette Stand</h2>
            <p style={{ color: C.gray, fontSize: 12, margin: "8px 0 0" }}>Enter Bankroll</p>
          </div>
          <input style={{ ...S.input, marginBottom: 8, fontSize: 22, textAlign: "center" }} type="number" placeholder="0" value={bankrollInput} onChange={(e) => setBankrollInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && startRkos(parseFloat(bankrollInput))} autoFocus />
          {unitPreview && <p style={{ color: C.gray, fontSize: 13, textAlign: "center", marginBottom: 12 }}>Unit: <span style={{ color: "#44bbaa" }}>{unitPreview}</span> (1%)</p>}
          <button style={{ ...S.btnGold, backgroundColor: "#44bbaa", color: "#000", marginBottom: 10 }} onClick={() => startRkos(parseFloat(bankrollInput))} disabled={loading}>{loading ? "..." : "Start"}</button>
          <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={handleLogout}>Sign Out</button>
        </div>
      </div></div>
    );
  }

  // ═══ ROULETTE KING OF STAND — GAME ═══════════════════════════════════════
  if (screen === "rkos-game") {
    const sc = rkos?.scoreboard || { L: 0, H: 0, Z: 0 };
    const phase = rkos?.phase;
    const KOS_SEQ = [1, 2, 3, 5, 3, 2, 1, 2, 3, 5];
    const stepIdx = rkos?.lossStep ?? 0;
    const betAmt = rkos?.actualBet ?? (KOS_SEQ[stepIdx] * (rkos?.baseUnit ?? 1));
    const balance = rkos?.balance ?? rkos?.bankroll ?? 100;
    const bankroll = rkos?.bankroll ?? 100;
    const target10 = bankroll * 1.10;
    const pnl = balance - bankroll;
    const progress = Math.min(100, Math.max(0, ((balance - bankroll) / (target10 - bankroll)) * 100));
    const totalHands = (sc.L || 0) + (sc.H || 0) + (sc.Z || 0);
    const wins = rkos?.handLog ? rkos.handLog.filter(h => h.win).length : 0;
    const dailyTarget = rkos?.dailyGameOver;

    const btnStyle = (side) => ({
      flex: 1, height: 86, fontSize: 24, fontWeight: "bold",
      backgroundColor: side === "L" ? (rkos?.side === side ? "#0d3a2a" : "#071a14") : (rkos?.side === side ? "#2a1a0d" : "#140d07"),
      color: C.white, border: rkos?.side === side ? "2px solid #44bbaa" : "2px solid #333",
      borderRadius: 12, cursor: "pointer", WebkitTapHighlightColor: "transparent", touchAction: "manipulation", letterSpacing: 2,
    });

    return (
      <div style={S.page}>
        <div style={S.header}>
          <span style={{ color: C.gray, fontSize: 12 }}>👤 {user?.username}</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#44bbaa", fontWeight: "bold", fontSize: 20 }}>{balance.toFixed(2)}</div>
            <div style={{ color: pnl >= 0 ? C.green : C.red, fontSize: 11 }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.gray }}>Target: <span style={{ color: C.gold }}>${target10.toFixed(2)}</span></div>
            <div style={{ fontSize: 10, color: progress >= 100 ? C.green : C.gray }}>{progress.toFixed(0)}% of +10%</div>
          </div>
        </div>

        <div style={S.content}>
          <div style={S.scoreboard}>
            {[{ l: "LOW", k: "L", c: "#44bbaa" }, { l: "HIGH", k: "H", c: C.gold }, { l: "ZERO", k: "Z", c: "#556" }].map(({ l, k, c }) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ color: c, fontSize: 12, fontWeight: "bold" }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: "bold" }}>{sc[k]}</div>
              </div>
            ))}
          </div>

          <div style={{ backgroundColor: C.card, borderRadius: 12, padding: "12px 16px", marginBottom: 10, border: "1px solid #222" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              {dailyTarget ? (
                <div style={{ color: C.green, fontSize: 16, fontWeight: "bold", width: "100%", textAlign: "center" }}>Daily Target Complete! +10%</div>
              ) : phase === "waiting" ? (
                <div style={{ color: C.gray, fontSize: 13 }}>Enter scoreboard leader (L or H)</div>
              ) : phase === "observation" ? (
                <div style={{ color: "#ffaa44", fontSize: 13, fontWeight: "bold" }}>{rkos?.message}</div>
              ) : rkos?.gameOver ? (
                <div style={{ color: rkos?.win ? C.green : C.red, fontSize: 15, fontWeight: "bold" }}>
                  {rkos?.win ? "WIN ✓" : "LOSS ✗"} &nbsp; PNL: {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                </div>
              ) : (
                <>
                  <div>
                    <div style={{ color: C.gray, fontSize: 10, letterSpacing: 1 }}>BET ON</div>
                    <div style={{ color: "#44bbaa", fontSize: 20, fontWeight: "bold", lineHeight: 1 }}>{rkos?.side === "L" ? "LOW" : rkos?.side === "H" ? "HIGH" : "—"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: C.gold, fontSize: 20, fontWeight: "bold" }}>${betAmt?.toFixed ? betAmt.toFixed(2) : betAmt}</div>
                  </div>
                </>
              )}
            </div>

            <div style={{ height: 10, backgroundColor: "#1a1a2a", borderRadius: 5, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ height: "100%", borderRadius: 5, width: `${Math.max(0, progress)}%`, backgroundColor: progress >= 100 ? C.green : progress >= 60 ? C.gold : "#44bbaa", transition: "width 0.4s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: C.green }}>W: {wins}</span>
              <span style={{ color: C.gray }}>Tables: {Math.ceil(totalHands / 2) || 0}</span>
              <span style={{ color: C.red }}>L: {totalHands - wins}</span>
            </div>
          </div>

          {!rkos?.gameOver && !dailyTarget && (
            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button style={btnStyle("L")} onClick={() => addRkosResult("L")} disabled={loading}>LOW</button>
              <button style={btnStyle("H")} onClick={() => addRkosResult("H")} disabled={loading}>HIGH</button>
            </div>
          )}
          {!rkos?.gameOver && !dailyTarget && (
            <button style={{ ...S.btn, background: "#1a3a1a", color: "#44aa44", width: "100%", marginBottom: 8, fontSize: 12, border: "1px solid #2a4a2a" }} onClick={() => addRkosResult("Z")} disabled={loading}>ZERO</button>
          )}

          {(rkos?.gameOver || dailyTarget) ? (
            <button style={{ ...S.btnGold, width: "100%", marginBottom: 8 }} onClick={resetRkosGame} disabled={loading}>New Game</button>
          ) : (
            <button style={{ ...S.btnGhost, width: "100%", fontSize: 12 }} onClick={finishRkosGame} disabled={loading}>End Game</button>
          )}

          {(rkos?.history?.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10, justifyContent: "center" }}>
              {rkos.history.map((r, i) => (
                <div key={i} style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: "bold", backgroundColor: r === "L" ? "#0d3a2a" : r === "H" ? "#3a2a0d" : "#1a1a2a", color: C.white, border: "1px solid #333" }}>{r}</div>
              ))}
            </div>
          )}
        </div>
        <div style={S.footer}>
          <button style={S.btnGhost} onClick={() => setScreen("landing")}>← Menu</button>
        </div>
      </div>
    );
  }

  // ═══ KING OF STAND — BANKROLL ════════════════════════════════════════════
  if (screen === "kos-bankroll") {
    const unitPreview = bankrollInput ? `$${(parseFloat(bankrollInput) * 0.01).toFixed(2)}` : null;
    return (
      <div style={S.page}><div style={S.content}>
        <div style={{ backgroundColor: C.card, border: "1px solid #4488ff", padding: 32, borderRadius: 14, width: "100%", maxWidth: 320 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 4 }}>♠</div>
            <div style={{ color: C.gray, fontSize: 13, marginBottom: 4 }}>👤 {user?.username}</div>
            <h2 style={{ color: "#4488ff", fontSize: 22, margin: 0 }}>King of Stand</h2>
            <p style={{ color: C.gray, fontSize: 12, margin: "8px 0 0" }}>Enter Bankroll</p>
          </div>
          <input style={{ ...S.input, marginBottom: 8, fontSize: 22, textAlign: "center" }} type="number" placeholder="0" value={bankrollInput} onChange={(e) => setBankrollInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && startKos(parseFloat(bankrollInput))} autoFocus />
          {unitPreview && <p style={{ color: C.gray, fontSize: 13, textAlign: "center", marginBottom: 12 }}>Unit: <span style={{ color: "#4488ff" }}>{unitPreview}</span> (1%)</p>}
          {bankrollError && <p style={{ color: C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{bankrollError}</p>}
          <button style={{ ...S.btnGold, backgroundColor: "#4488ff", color: C.white, marginBottom: 10 }} onClick={() => startKos(parseFloat(bankrollInput))} disabled={loading}>{loading ? "..." : "Start"}</button>
          <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={handleLogout}>Sign Out</button>
        </div>
      </div></div>
    );
  }

  // ═══ KING OF STAND — GAME ════════════════════════════════════════════════
  if (screen === "kos-game") {
    const sc = kos?.scoreboard || { B: 0, P: 0, T: 0 };
    const phase = kos?.phase;
    const KOS_SEQ = [1, 2, 3, 5, 3, 2, 1, 2, 3, 5];
    const stepIdx = kos?.lossStep ?? 0;
    const betAmt = kos?.actualBet ?? (KOS_SEQ[stepIdx] * (kos?.baseUnit ?? 1));
    const balance = kos?.balance ?? kos?.bankroll ?? 100;
    const bankroll = kos?.bankroll ?? 100;
    const target10 = bankroll * 1.10;
    const pnl = balance - bankroll;
    const progress = Math.min(100, Math.max(0, ((balance - bankroll) / (target10 - bankroll)) * 100));
    const totalHands = (sc.B || 0) + (sc.P || 0);
    const wins = kos?.handLog ? kos.handLog.filter(h => h.win).length : 0;
    const dailyTarget = kos?.dailyGameOver;

    const btnStyle = (side) => ({
      flex: 1, height: 86, fontSize: 26, fontWeight: "bold",
      backgroundColor: side === "B" ? (kos?.side === side ? "#1a4a9a" : "#0d2050") : (kos?.side === side ? "#7a1a1a" : "#3a0d0d"),
      color: C.white, border: kos?.side === side ? "2px solid #4488ff" : "2px solid #333",
      borderRadius: 12, cursor: "pointer", WebkitTapHighlightColor: "transparent", touchAction: "manipulation", letterSpacing: 2,
    });

    return (
      <div style={S.page}>
        <div style={S.header}>
          <span style={{ color: C.gray, fontSize: 12 }}>👤 {user?.username}</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#4488ff", fontWeight: "bold", fontSize: 20 }}>{balance.toFixed(2)}</div>
            <div style={{ color: pnl >= 0 ? C.green : C.red, fontSize: 11 }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.gray }}>Target: <span style={{ color: C.gold }}>${target10.toFixed(2)}</span></div>
            <div style={{ fontSize: 10, color: progress >= 100 ? C.green : C.gray }}>{progress.toFixed(0)}% of +10%</div>
          </div>
        </div>

        <div style={S.content}>
          {/* Scoreboard */}
          <div style={S.scoreboard}>
            {[{ l: "BANKER", k: "B", c: "#4488ff" }, { l: "PLAYER", k: "P", c: C.red }, { l: "TIE", k: "T", c: C.green }].map(({ l, k, c }) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ color: c, fontSize: 12, fontWeight: "bold" }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: "bold" }}>{sc[k]}</div>
              </div>
            ))}
          </div>

          {/* Status card */}
          <div style={{ backgroundColor: C.card, borderRadius: 12, padding: "12px 16px", marginBottom: 10, border: "1px solid #222" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              {dailyTarget ? (
                <div style={{ color: C.green, fontSize: 16, fontWeight: "bold", width: "100%", textAlign: "center" }}>Daily Target Complete! +10%</div>
              ) : phase === "waiting" ? (
                <div style={{ color: C.gray, fontSize: 13 }}>Enter scoreboard leader</div>
              ) : phase === "observation" ? (
                <div style={{ color: "#ffaa44", fontSize: 13, fontWeight: "bold" }}>{kos?.message}</div>
              ) : kos?.gameOver ? (
                <div style={{ color: kos?.win ? C.green : C.red, fontSize: 15, fontWeight: "bold" }}>
                  {kos?.win ? "WIN ✓" : "LOSS ✗"} &nbsp; PNL: {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                </div>
              ) : (
                <>
                  <div>
                    <div style={{ color: C.gray, fontSize: 10, letterSpacing: 1 }}>BET ON</div>
                    <div style={{ color: "#4488ff", fontSize: 20, fontWeight: "bold", lineHeight: 1 }}>{kos?.side === "B" ? "BANKER" : kos?.side === "P" ? "PLAYER" : "—"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: C.gold, fontSize: 20, fontWeight: "bold" }}>${betAmt?.toFixed ? betAmt.toFixed(2) : betAmt}</div>
                  </div>
                </>
              )}
            </div>

            {/* %10 progress bar */}
            <div style={{ height: 10, backgroundColor: "#1a1a2a", borderRadius: 5, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ height: "100%", borderRadius: 5, width: `${Math.max(0, progress)}%`, backgroundColor: progress >= 100 ? C.green : progress >= 60 ? C.gold : "#4488ff", transition: "width 0.4s ease" }} />
            </div>

            {/* Win/Loss ratio */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: C.green }}>W: {wins}</span>
              <span style={{ color: C.gray }}>Tables: {sc.B + sc.P > 0 ? Math.ceil((sc.B+sc.P)/2) : 0}</span>
              <span style={{ color: C.red }}>L: {totalHands - wins}</span>
            </div>
          </div>

          {/* B / P buttons */}
          {!kos?.gameOver && !dailyTarget && (
            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button style={btnStyle("B")} onClick={() => addKosResult("B")} disabled={loading}>BANKER</button>
              <button style={btnStyle("P")} onClick={() => addKosResult("P")} disabled={loading}>PLAYER</button>
            </div>
          )}
          {!kos?.gameOver && !dailyTarget && (
            <button style={{ ...S.btn, background: "#222", color: "#555", width: "100%", marginBottom: 8, fontSize: 12, border: "1px solid #333" }} onClick={() => addKosResult("T")} disabled={loading}>TIE</button>
          )}

          {(kos?.gameOver || dailyTarget) ? (
            <button style={{ ...S.btnGold, width: "100%", marginBottom: 8 }} onClick={resetKosGame} disabled={loading}>New Game</button>
          ) : (
            <button style={{ ...S.btnGhost, width: "100%", fontSize: 12 }} onClick={finishKosGame} disabled={loading}>End Game</button>
          )}

          {/* History chips */}
          {(kos?.history?.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10, justifyContent: "center" }}>
              {kos.history.map((r, i) => (
                <div key={i} style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: "bold", backgroundColor: r === "B" ? "#1a3a6a" : r === "P" ? "#3a1a1a" : "#1a3a2a", color: C.white, border: "1px solid #333" }}>{r}</div>
              ))}
            </div>
          )}
        </div>
        <div style={S.footer}>
          <button style={S.btnGhost} onClick={() => setScreen("landing")}>← Menu</button>
        </div>
      </div>
    );
  }

  // ═══ BLACKJACK STAND — BANKROLL ═════════════════════════════════════════
  if (screen === "bj-bankroll") {
    const unitPreview = bankrollInput ? `$${(parseFloat(bankrollInput) * 0.01).toFixed(2)}` : null;
    return (
      <div style={S.page}><div style={S.content}>
        <div style={{ backgroundColor: C.card, border: "1px solid #ff9900", padding: 32, borderRadius: 14, width: "100%", maxWidth: 320 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 4 }}>🃏</div>
            <div style={{ color: C.gray, fontSize: 13, marginBottom: 4 }}>👤 {user?.username}</div>
            <h2 style={{ color: "#ff9900", fontSize: 22, margin: 0 }}>Blackjack Stand</h2>
            <p style={{ color: C.gray, fontSize: 12, margin: "8px 0 0" }}>Enter Bankroll</p>
          </div>
          <input style={{ ...S.input, marginBottom: 8, fontSize: 22, textAlign: "center" }} type="number" placeholder="0" value={bankrollInput} onChange={(e) => setBankrollInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && startBj(parseFloat(bankrollInput))} autoFocus />
          {unitPreview && <p style={{ color: C.gray, fontSize: 13, textAlign: "center", marginBottom: 12 }}>Unit: <span style={{ color: "#ff9900" }}>{unitPreview}</span> (1%)</p>}
          <button style={{ ...S.btnGold, backgroundColor: "#ff9900", color: "#000", marginBottom: 10 }} onClick={() => startBj(parseFloat(bankrollInput))} disabled={loading}>{loading ? "..." : "Start"}</button>
          <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={handleLogout}>Sign Out</button>
        </div>
      </div></div>
    );
  }

  // ═══ BLACKJACK STAND — GAME ══════════════════════════════════════════════
  if (screen === "bj-game") {
    const DEALER_OPTS = ["2","3","4","5","6","7","8","9","10","A"];
    // Basic strategy table: dealer index 0=2 .. 9=A
    // H=Hit S=Stand D=Double(else hit) Ds=Double(else stand) P=Split
    const HARD = {
      5: "HHHHHHHHHH", 6: "HHHHHHHHHH", 7: "HHHHHHHHHH", 8: "HHHHHHHHHH",
      9: "HDDDDHHHHH", 10: "DDDDDDDDHHH".slice(0,10), 11: "DDDDDDDDDH",
      12: "HHSSSHHHHHH".slice(0,10), 13: "SSSSSHHHHH", 14: "SSSSSHHHHH",
      15: "SSSSSHHHHH", 16: "SSSSSHHHHH",
      17: "SSSSSSSSSS", 18: "SSSSSSSSSS", 19: "SSSSSSSSSS", 20: "SSSSSSSSSS", 21: "SSSSSSSSSS",
    };
    // Soft totals: key = player's non-ace card (2=soft13 .. 9=soft20)
    const SOFT = {
      13: "HHHDDHHHHH", 14: "HHHDDHHHHH", 15: "HHDDDHHHHHH".slice(0,10),
      16: "HHDDDHHHHHH".slice(0,10), 17: "HDDDDHHHHH", 18: "SdddDSSHHH",
      19: "SSSSSSSSSS", 20: "SSSSSSSSSS",
    };
    // Pairs: key = card value
    const PAIR = {
      2: "PPPPPPHHHH", 3: "PPPPPPHHHH", 4: "HHHPPHHHHH",
      5: "DDDDDDDDHH", 6: "PPPPPHHHHH", 7: "PPPPPPHHHHH".slice(0,10),
      8: "PPPPPPPPPP", 9: "PPPPPSPPSSS".slice(0,10), 10: "SSSSSSSSSS", 1: "PPPPPPPPPP",
    };
    const PAIR_LABELS = ["2s","3s","4s","5s","6s","7s","8s","9s","10s","As"];
    const PAIR_VALS =   [2,   3,   4,   5,   6,   7,   8,   9,   10,   1];

    const dealerIdx = bjDealer !== null ? DEALER_OPTS.indexOf(bjDealer) : -1;

    function getStrategy() {
      if (dealerIdx < 0 || bjTotal === null) return null;
      let code;
      if (bjHandType === "hard") code = (HARD[bjTotal] || "HHHHHHHHHH")[dealerIdx];
      else if (bjHandType === "soft") code = (SOFT[bjTotal] || "HHHHHHHHHH")[dealerIdx];
      else code = (PAIR[bjTotal] || "HHHHHHHHHH")[dealerIdx];
      const map = { H: "HIT", S: "STAND", D: "DOUBLE", d: "DOUBLE", P: "SPLIT" };
      return map[code] || "HIT";
    }

    const strategy = getStrategy();
    const stratColor = { HIT: C.green, STAND: C.red, DOUBLE: C.gold, SPLIT: "#cc66ff" };

    const balance = bj?.balance ?? bj?.bankroll ?? 100;
    const bankroll = bj?.bankroll ?? 100;
    const target10 = bankroll * 1.10;
    const pnl = balance - bankroll;
    const progress = Math.min(100, Math.max(0, ((balance - bankroll) / (target10 - bankroll)) * 100));
    const KOS_SEQ = [1, 2, 3, 5, 3, 2, 1, 2, 3, 5];
    const stepIdx = bj?.lossStep ?? 0;
    const betAmt = bj?.actualBet ?? (KOS_SEQ[Math.min(stepIdx, 9)] * (bj?.baseUnit ?? 1));
    const wins = bj?.wins ?? 0;
    const losses = bj?.losses ?? 0;
    const pushes = bj?.pushes ?? 0;
    const dailyTarget = bj?.dailyGameOver;
    const phase = bj?.phase;

    const selStyle = (active) => ({
      padding: "6px 12px", fontSize: 13, fontWeight: "bold", borderRadius: 6, cursor: "pointer",
      backgroundColor: active ? "#ff9900" : C.card, color: active ? "#000" : C.gray,
      border: active ? "2px solid #ff9900" : `1px solid ${C.border}`,
    });

    return (
      <div style={S.page}>
        <div style={S.header}>
          <span style={{ color: C.gray, fontSize: 12 }}>👤 {user?.username}</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#ff9900", fontWeight: "bold", fontSize: 20 }}>{balance.toFixed(2)}</div>
            <div style={{ color: pnl >= 0 ? C.green : C.red, fontSize: 11 }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.gray }}>Target: <span style={{ color: C.gold }}>${target10.toFixed(2)}</span></div>
            <div style={{ fontSize: 10, color: progress >= 100 ? C.green : C.gray }}>{progress.toFixed(0)}% of +10%</div>
          </div>
        </div>

        <div style={S.content}>
          {/* Status card */}
          <div style={{ backgroundColor: C.card, borderRadius: 12, padding: "12px 16px", width: "100%", border: "1px solid #222" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              {dailyTarget ? (
                <div style={{ color: C.green, fontSize: 16, fontWeight: "bold", width: "100%", textAlign: "center" }}>Daily Target Complete! +10%</div>
              ) : phase === "waiting" ? (
                <div style={{ color: C.gray, fontSize: 13, width: "100%", textAlign: "center" }}>Enter scoreboard leader (B or P)</div>
              ) : phase === "observation" ? (
                <div style={{ color: "#ffaa44", fontSize: 13, fontWeight: "bold", width: "100%", textAlign: "center" }}>{bj?.message}</div>
              ) : bj?.gameOver ? (
                <div style={{ color: bj?.win ? C.green : C.red, fontSize: 15, fontWeight: "bold", width: "100%", textAlign: "center" }}>
                  {bj?.win ? "WIN ✓" : "GAME OVER"} &nbsp; PNL: {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                </div>
              ) : (
                <>
                  <div>
                    <div style={{ color: C.gray, fontSize: 10, letterSpacing: 1 }}>BET</div>
                    <div style={{ color: "#ff9900", fontSize: 20, fontWeight: "bold" }}>${betAmt?.toFixed ? betAmt.toFixed(2) : betAmt}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: C.gray, fontSize: 10 }}>W / L / P</div>
                    <div style={{ fontSize: 14, fontWeight: "bold" }}>
                      <span style={{ color: C.green }}>{wins}</span> / <span style={{ color: C.red }}>{losses}</span> / <span style={{ color: C.gray }}>{pushes}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div style={{ height: 8, backgroundColor: "#1a1a2a", borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
              <div style={{ height: "100%", borderRadius: 4, width: `${Math.max(0, progress)}%`, backgroundColor: progress >= 100 ? C.green : progress >= 60 ? C.gold : "#ff9900", transition: "width 0.4s ease" }} />
            </div>
          </div>

          {/* Strategy advisor */}
          {!bj?.gameOver && !dailyTarget && phase === "active" && (
            <div style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, width: "100%", border: "1px solid #333" }}>
              <div style={{ color: C.gray, fontSize: 11, letterSpacing: 1, marginBottom: 10, textAlign: "center" }}>BASIC STRATEGY ADVISOR</div>

              {/* Dealer upcard */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: C.gray, fontSize: 11, marginBottom: 6 }}>Dealer Upcard</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {DEALER_OPTS.map(d => (
                    <button key={d} style={selStyle(bjDealer === d)} onClick={() => setBjDealer(d)}>{d}</button>
                  ))}
                </div>
              </div>

              {/* Hand type */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: C.gray, fontSize: 11, marginBottom: 6 }}>Hand Type</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["hard","soft","pair"].map(t => (
                    <button key={t} style={selStyle(bjHandType === t)} onClick={() => { setBjHandType(t); setBjTotal(null); }}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
                  ))}
                </div>
              </div>

              {/* Player total */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.gray, fontSize: 11, marginBottom: 6 }}>Your Hand</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {bjHandType === "hard" && [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].map(n => (
                    <button key={n} style={selStyle(bjTotal === n)} onClick={() => setBjTotal(n)}>{n}</button>
                  ))}
                  {bjHandType === "soft" && [13,14,15,16,17,18,19,20].map(n => (
                    <button key={n} style={selStyle(bjTotal === n)} onClick={() => setBjTotal(n)}>A+{n-11}</button>
                  ))}
                  {bjHandType === "pair" && PAIR_LABELS.map((lbl, i) => (
                    <button key={lbl} style={selStyle(bjTotal === PAIR_VALS[i])} onClick={() => setBjTotal(PAIR_VALS[i])}>{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Recommendation */}
              {strategy ? (
                <div style={{ textAlign: "center", padding: "12px 0", borderTop: `1px solid ${C.border}` }}>
                  <div style={{ color: C.gray, fontSize: 11, marginBottom: 4 }}>PLAY</div>
                  <div style={{ fontSize: 32, fontWeight: "bold", color: stratColor[strategy] ?? C.white }}>{strategy}</div>
                </div>
              ) : (
                <div style={{ textAlign: "center", color: C.dark, fontSize: 13, paddingTop: 8 }}>Select dealer card and your hand</div>
              )}
            </div>
          )}

          {/* Result buttons */}
          {!bj?.gameOver && !dailyTarget && phase === "active" && (
            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <button style={{ flex: 1, height: 72, fontSize: 20, fontWeight: "bold", backgroundColor: "#0a3a1a", color: C.green, border: `2px solid ${C.green}`, borderRadius: 12, cursor: "pointer", WebkitTapHighlightColor: "transparent" }} onClick={() => addBjResult("W")}>WIN</button>
              <button style={{ flex: 1, height: 72, fontSize: 20, fontWeight: "bold", backgroundColor: "#3a0a0a", color: C.red, border: `2px solid ${C.red}`, borderRadius: 12, cursor: "pointer", WebkitTapHighlightColor: "transparent" }} onClick={() => addBjResult("L")}>LOSS</button>
              <button style={{ flex: 1, height: 72, fontSize: 20, fontWeight: "bold", backgroundColor: "#1a1a1a", color: C.gray, border: `2px solid ${C.dark}`, borderRadius: 12, cursor: "pointer", WebkitTapHighlightColor: "transparent" }} onClick={() => addBjResult("P")}>PUSH</button>
            </div>
          )}

          {/* Waiting/observation: W/L buttons only (no push) */}
          {!bj?.gameOver && !dailyTarget && (phase === "waiting" || phase === "observation") && (
            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <button style={{ flex: 1, height: 72, fontSize: 20, fontWeight: "bold", backgroundColor: "#0a3a1a", color: C.green, border: `2px solid ${C.green}`, borderRadius: 12, cursor: "pointer" }} onClick={() => addBjResult("W")}>WIN</button>
              <button style={{ flex: 1, height: 72, fontSize: 20, fontWeight: "bold", backgroundColor: "#3a0a0a", color: C.red, border: `2px solid ${C.red}`, borderRadius: 12, cursor: "pointer" }} onClick={() => addBjResult("L")}>LOSS</button>
            </div>
          )}

          {(bj?.gameOver || dailyTarget) ? (
            <button style={{ ...S.btnGold, backgroundColor: "#ff9900", color: "#000", width: "100%", marginBottom: 8 }} onClick={resetBjGame} disabled={loading}>New Game</button>
          ) : (
            <button style={{ ...S.btnGhost, width: "100%", fontSize: 12 }} onClick={finishBjGame} disabled={loading}>End Game</button>
          )}
        </div>
        <FlashOverlay />
      </div>
    );
  }

  return null;
}

function AdminPanel({ user, onBack }) {
  const ADMIN_SECRET = "baccarat_admin_2024";
  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    fetch("/admin/players", { headers: { "x-admin-secret": ADMIN_SECRET } })
      .then(r => r.json()).then(data => { setPlayers(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError("Veri alınamadı"); setLoading(false); });
  }, []);

  function downloadCsv(username) {
    fetch(`/admin/export-csv/${encodeURIComponent(username)}`, { headers: { "x-admin-secret": ADMIN_SECRET } })
      .then(r => r.blob()).then(b => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `rapor-${username}-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
      });
  }

  const C = { bg: "#0a0a0f", card: "#12121a", gold: "#c9a84c", white: "#f0f0f0", gray: "#888", red: "#c0392b", green: "#27ae60" };
  const S = { btn: { padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, backgroundColor: C.gold, color: "#000", fontWeight: "bold" } };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: C.bg, color: C.white, padding: 24, fontFamily: "monospace" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <button onClick={onBack} style={{ ...S.btn, backgroundColor: "transparent", border: "1px solid #555", color: C.gray }}>← Geri</button>
          <h2 style={{ margin: 0, color: C.gold }}>Admin — Oyuncu Raporları</h2>
        </div>
        {loading && <p style={{ color: C.gray }}>Yükleniyor...</p>}
        {error && <p style={{ color: C.red }}>{error}</p>}
        {!loading && !error && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #333" }}>
                {["Oyuncu", "Seans", "Son Aktif", "Son Bakiye", "Bankroll", "CSV"].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.gray, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map(p => (
                <tr key={p.username} style={{ borderBottom: "1px solid #1a1a2a" }}>
                  <td style={{ padding: "10px", fontWeight: "bold" }}>{p.username}</td>
                  <td style={{ padding: "10px", color: C.gray }}>{p.sessions}</td>
                  <td style={{ padding: "10px", color: C.gray, fontSize: 12 }}>{p.lastActive ? new Date(p.lastActive).toLocaleString("tr-TR", { timeZone: "America/Chicago" }) : "-"}</td>
                  <td style={{ padding: "10px", color: p.lastBalance >= p.bankroll ? C.green : C.red }}>${p.lastBalance}</td>
                  <td style={{ padding: "10px", color: C.gray }}>${p.bankroll}</td>
                  <td style={{ padding: "10px" }}>
                    <button onClick={() => downloadCsv(p.username)} style={S.btn}>İndir</button>
                  </td>
                </tr>
              ))}
              {players.length === 0 && <tr><td colSpan={6} style={{ padding: 20, color: C.gray, textAlign: "center" }}>Kayıt yok</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
