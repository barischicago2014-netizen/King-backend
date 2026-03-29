import React, { useState, useEffect } from "react";
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
  btnOutline: { padding: "13px 0", width: "100%", maxWidth: 300, fontSize: 16, fontWeight: "bold", backgroundColor: "transparent", color: C.gold, border: `2px solid ${C.gold}`, borderRadius: 8, cursor: "pointer" },
  btnGhost: { padding: "9px 20px", fontSize: 13, backgroundColor: "transparent", color: C.gray, border: `1px solid ${C.dark}`, borderRadius: 6, cursor: "pointer" },
  input: { width: "100%", padding: "12px 14px", fontSize: 16, backgroundColor: C.bg, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: "border-box", outline: "none" },
  scoreboard: { display: "flex", gap: 20, backgroundColor: C.card, padding: "14px 32px", borderRadius: 12, textAlign: "center", border: `1px solid ${C.border}`, width: "100%", justifyContent: "center" },
  recBox: { backgroundColor: C.card, padding: "20px 32px", borderRadius: 14, textAlign: "center", border: `2px solid ${C.gold}`, width: "100%" },
};

export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | login | bankroll | demo | game
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({ username: "", password: "" });
  const [formError, setFormError] = useState("");
  const [bankrollInput, setBankrollInput] = useState("");
  const [bankrollError, setBankrollError] = useState("");
  const [loading, setLoading] = useState(false);
  const [gs, setGs] = useState(null);
  const [dealCards, setDealCards] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [flash, setFlash] = useState(null);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("bac_token");
    const username = localStorage.getItem("bac_user");
    if (token && username) setUser({ token, username });
  }, []);

  function showFlash(text, color) {
    setFlash({ text, color });
    setTimeout(() => setFlash(null), 2000);
  }

  async function handleLogin() {
    setFormError("");
    if (!form.username.trim() || !form.password.trim()) { setFormError("Kullanıcı adı ve şifre gerekli"); return; }
    setLoading(true);
    try {
      const res = await api.post("/login", form);
      localStorage.setItem("bac_token", res.data.token);
      localStorage.setItem("bac_user", res.data.username);
      setUser({ token: res.data.token, username: res.data.username });
      setForm({ username: "", password: "" });
      setScreen("bankroll");
    } catch (err) {
      setFormError(err.response?.data?.message || "Giriş başarısız");
    } finally {
      setLoading(false);
    }
  }

  async function handleBankrollStart() {
    setBankrollError("");
    const amount = parseFloat(bankrollInput);
    if (!amount || amount <= 0) { setBankrollError("Geçerli bir miktar girin"); return; }
    setLoading(true);
    try {
      const res = await api.post("/game/start", { bankroll: amount });
      setGs(res.data);
      setLastResult(null);
      setDealCards(null);
      setBankrollInput("");
      setScreen("game");
    } catch (err) {
      setBankrollError(err.response?.data?.message || "Hata oluştu");
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

  async function startDemo() {
    setLoading(true);
    try {
      await api.post("/demo/reset");
      setGs({ balance: 100, bankroll: 100, baseUnit: 0.5, scoreboard: { B: 0, P: 0, T: 0 }, phase: "waiting", history: [], recommendation: null, unit: null, message: "Kart çekmek için dokun" });
      setDealCards(null); setLastResult(null); setScreen("demo");
    } finally { setLoading(false); }
  }

  async function demoDeal() {
    if (loading || gs?.gameOver) return;
    setLoading(true);
    try {
      const res = await api.post("/demo/deal");
      setDealCards(res.data.cards);
      setLastResult(res.data.result);
      setGs((prev) => ({ ...prev, ...res.data }));
      if (res.data.win === true) showFlash(`+${res.data.actualBet || res.data.unit}`, C.green);
      else if (res.data.win === false) showFlash(`-${res.data.actualBet || res.data.unit}`, C.red);
    } finally { setLoading(false); }
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
    if (loading || gs?.gameOver) return;
    setLoading(true);
    try {
      const res = await api.post("/game/result", { result });
      setLastResult(result);
      setGs((prev) => ({ ...prev, ...res.data }));
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
      if (err.response?.status === 404) setScreen("bankroll");
    } finally { setLoading(false); }
  }

  async function finishGame() {
    if (!window.confirm("Oyunu bitirmek istediğine emin misin? Mevcut bakiyenle yeni oyun başlayacak.")) return;
    setLoading(true);
    try {
      const res = await api.post("/game/finish");
      const newBankroll = res.data.balance;
      const startRes = await api.post("/game/reset", { bankroll: newBankroll });
      setGs(startRes.data);
      setLastResult(null);
    } finally { setLoading(false); }
  }

  async function resetGame() {
    // pass current balance as new bankroll (accumulate across games)
    const newBankroll = gs?.balance || gs?.bankroll || 100;
    setLoading(true);
    try {
      const res = await api.post("/game/reset", { bankroll: newBankroll });
      setGs(res.data);
      setLastResult(null);
    } finally { setLoading(false); }
  }

  function ScoreboardBlock({ sc }) {
    return (
      <div style={S.scoreboard}>
        {[{ l: "B", c: C.blue }, { l: "P", c: C.red }, { l: "T", c: C.gray }].map(({ l, c }, i) => (
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
          <span key={i} style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, fontWeight: "bold", fontSize: 13, backgroundColor: i === 0 ? (r === "B" ? "#1a3a6a" : r === "P" ? "#5a1a1a" : "#333") : C.card, color: r === "B" ? C.blue : r === "P" ? C.red : C.gray, border: `1px solid ${C.border}` }}>{r}</span>
        ))}
      </div>
    );
  }

  function FlashOverlay() {
    if (!flash) return null;
    return <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", backgroundColor: flash.color, color: "#000", padding: "10px 28px", borderRadius: 20, fontWeight: "bold", fontSize: 20, zIndex: 200 }}>{flash.text}</div>;
  }

  // ═══ LANDING ════════════════════════════════════════
  if (screen === "landing") {
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ fontSize: 64, marginBottom: 4 }}>♠</div>
          <h1 style={{ fontSize: 42, color: C.gold, margin: "0 0 8px", letterSpacing: 2 }}>BACCARAT</h1>
          <p style={{ color: C.gray, marginBottom: 48, fontSize: 14 }}>Strateji Sistemi</p>
          <button style={{ ...S.btnGold, marginBottom: 14 }} onClick={() => setScreen("login")}>Giriş Yap</button>
          <button style={S.btnOutline} onClick={startDemo} disabled={loading}>{loading ? "..." : "Demo Oyna"}</button>
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
            <h2 style={{ color: C.gold, textAlign: "center", marginBottom: 24, fontSize: 22 }}>Giriş Yap</h2>
            <input style={{ ...S.input, marginBottom: 12 }} placeholder="Kullanıcı adı" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoComplete="username" />
            <input style={{ ...S.input, marginBottom: 16 }} type="password" placeholder="Şifre" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoComplete="current-password" />
            {formError && <p style={{ color: C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{formError}</p>}
            <button style={{ ...S.btnGold, marginBottom: 10 }} onClick={handleLogin} disabled={loading}>{loading ? "..." : "Giriş Yap"}</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={() => setScreen("landing")}>← Geri</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ BANKROLL ═══════════════════════════════════════
  if (screen === "bankroll") {
    const preview = parseFloat(bankrollInput);
    const unitPreview = preview > 0 ? (preview * 0.005).toFixed(2) : null;
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
                Birim değeri: <span style={{ color: C.gold }}>{unitPreview}</span> (bankroll × 0.5%)
              </p>
            )}
            {bankrollError && <p style={{ color: C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{bankrollError}</p>}
            <button style={{ ...S.btnGold, marginBottom: 10 }} onClick={handleBankrollStart} disabled={loading}>{loading ? "..." : "Oyuna Başla"}</button>
            <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={handleLogout}>Çıkış</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ DEMO ═══════════════════════════════════════════
  if (screen === "demo") {
    const sc = gs?.scoreboard || { B: 0, P: 0, T: 0 };
    const demoTarget = gs?.targetMax ?? (gs?.bankroll != null ? gs.bankroll + 3 * (gs.baseUnit ?? 0.5) : 101.5);
    return (
      <div style={S.page}>
        <div style={S.header}>
          <button style={S.btnGhost} onClick={() => setScreen("landing")}>← Geri</button>
          <span style={{ color: C.gold, fontWeight: "bold", letterSpacing: 1 }}>DEMO MODU</span>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: C.gold, fontWeight: "bold", fontSize: 18 }}>{gs?.balance?.toFixed(2) ?? "100.00"}</div>
            <div style={{ color: C.gray, fontSize: 10 }}>Hedef: <span style={{ color: C.green }}>{demoTarget.toFixed(2)}</span>{gs?.lossLevel > 0 ? <span style={{ color: "#ff8844" }}> L{gs.lossLevel}</span> : null}</div>
          </div>
        </div>
        <div style={S.content}>
          <ScoreboardBlock sc={sc} />
          {dealCards && (
            <div style={{ display: "flex", gap: 12, width: "100%" }}>
              {[{ label: "PLAYER", data: dealCards.player, color: C.red }, { label: "BANKER", data: dealCards.banker, color: C.blue }].map(({ label, data, color }) => (
                <div key={label} style={{ flex: 1, backgroundColor: C.card, border: `2px solid ${color}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                  <div style={{ color: C.gray, fontSize: 11, marginBottom: 8, letterSpacing: 1 }}>{label}</div>
                  <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 8 }}>
                    {data.cards.map((c, i) => <span key={i} style={{ backgroundColor: "#fff", color: "#000", padding: "4px 8px", borderRadius: 4, fontWeight: "bold", fontSize: 15 }}>{c}</span>)}
                  </div>
                  <div style={{ color, fontSize: 28, fontWeight: "bold" }}>{data.score}</div>
                </div>
              ))}
            </div>
          )}
          {lastResult && (
            <div style={{ padding: "6px 24px", borderRadius: 20, fontWeight: "bold", fontSize: 16, backgroundColor: lastResult === "B" ? C.blue : lastResult === "P" ? C.red : C.dark }}>
              {lastResult === "B" ? "BANKER KAZANDI" : lastResult === "P" ? "PLAYER KAZANDI" : "BERABERE"}
            </div>
          )}
          {gs && !gs.gameOver && (
            <div style={S.recBox}>
              {gs.recommendation ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>SİSTEM ÖNERİSİ</div><div style={{ fontSize: 38, fontWeight: "bold", color: gs.recommendation === "B" ? C.blue : C.red, marginBottom: 4 }}>{gs.recommendation === "B" ? "BANKER" : "PLAYER"}</div><div style={{ color: C.gold, fontSize: 18 }}>{gs.unit} birim{gs.actualBet ? ` (${gs.actualBet})` : ""}</div></>
              ) : (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>BEKLENIYOR</div><div style={{ color: C.gray, fontSize: 18 }}>{gs.message}</div></>
              )}
            </div>
          )}
          {gs?.message && !gs.gameOver && (
            <div style={{ fontSize: 15, fontWeight: "bold", padding: "8px 20px", borderRadius: 8, backgroundColor: C.card, color: gs.message.includes("KAZANÇ") ? C.green : gs.message.includes("KAYIP") ? C.red : C.white }}>{gs.message}</div>
          )}
          {gs?.gameOver ? (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 44, fontWeight: "bold", color: C.gold, marginBottom: 8 }}>GAME OVER</div>
              <div style={{ color: C.white, marginBottom: 24, fontSize: 18 }}>Bakiye: {gs.balance?.toFixed(2)}</div>
              <button style={{ ...S.btnGold, marginBottom: 12 }} onClick={startDemo}>Yeniden Oyna</button>
              <button style={S.btnGhost} onClick={() => setScreen("landing")}>Ana Sayfa</button>
            </div>
          ) : (
            <button style={{ ...S.btnGold, fontSize: 20, padding: "18px 0", maxWidth: 260 }} onClick={demoDeal} disabled={loading}>{loading ? "..." : "🂠  Kart Çek"}</button>
          )}
          <HistoryChips history={gs?.history} />
        </div>
        <FlashOverlay />
      </div>
    );
  }

  // ═══ GAME (authenticated) ════════════════════════════
  if (screen === "game") {
    const sc = gs?.scoreboard || { B: 0, P: 0, T: 0 };
    const phase = gs?.phase;
    const gameTarget = gs?.targetMax ?? (gs?.bankroll != null && gs?.baseUnit != null ? gs.bankroll + 3 * gs.baseUnit : null);
    return (
      <div style={S.page}>
        <div style={S.header}>
          <span style={{ color: C.gray, fontSize: 12 }}>👤 {user?.username}</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.gold, fontWeight: "bold", fontSize: 20 }}>{gs?.balance?.toFixed(2) ?? "—"}</div>
            <div style={{ color: C.gray, fontSize: 11 }}>birim: {gs?.baseUnit?.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: C.gray, fontSize: 10 }}>Hedef: <span style={{ color: C.green }}>{gameTarget != null ? gameTarget.toFixed(2) : "—"}</span></div>
            {gs?.lossLevel > 0 && <div style={{ color: "#ff8844", fontSize: 10 }}>Risk: L{gs.lossLevel}</div>}
          </div>
        </div>
        <div style={S.content}>
          <ScoreboardBlock sc={sc} />

          {gs && !gs.gameOver && (
            <div style={S.recBox}>
              {phase === "waiting" ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 6 }}>BAŞLANGIÇ</div><div style={{ color: C.gray, fontSize: 18 }}>{Math.max(0, 3 - (sc.B + sc.P))} sonuç daha girin</div></>
              ) : gs.recommendation ? (
                <>
                  <div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>SİSTEM ÖNERİSİ</div>
                  <div style={{ fontSize: 42, fontWeight: "bold", marginBottom: 4, color: gs.recommendation === "B" ? C.blue : C.red }}>{gs.recommendation === "B" ? "BANKER" : "PLAYER"}</div>
                  <div style={{ color: C.gold, fontSize: 20, fontWeight: "bold" }}>{gs.unit} birim</div>
                  {gs.actualBet && <div style={{ color: C.white, fontSize: 16, marginTop: 4, opacity: 0.8 }}>({gs.actualBet})</div>}
                </>
              ) : null}
            </div>
          )}

          {gs?.message && !gs.gameOver && (
            <div style={{ fontSize: 14, fontWeight: "bold", padding: "8px 18px", borderRadius: 8, backgroundColor: C.card, color: gs.message.includes("KAZANÇ") ? C.green : gs.message.includes("KAYIP") ? C.red : C.white }}>{gs.message}</div>
          )}

          {(aiLoading || aiData) && !gs?.gameOver && (
            <div style={{ width: "100%", padding: "10px 16px", borderRadius: 10, backgroundColor: "#1a1a2e", border: "1px solid #6644aa", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              {aiLoading ? (
                <span style={{ color: "#aaaadd", fontSize: 13 }}>AI analiz yapıyor...</span>
              ) : aiData ? (
                <span style={{ fontSize: 13 }}>
                  <span style={{ color: "#aaaadd" }}>AI: </span>
                  <span style={{ color: aiData.side === "B" ? C.blue : aiData.side === "P" ? C.red : C.gray, fontWeight: "bold" }}>
                    {aiData.side === "B" ? "BANKER" : aiData.side === "P" ? "PLAYER" : "NÖTR"}
                  </span>
                  {aiData.reason && <span style={{ color: C.gray }}> — {aiData.reason}</span>}
                </span>
              ) : null}
            </div>
          )}

          {gs?.gameOver ? (
            <div style={{ textAlign: "center", padding: 24, width: "100%" }}>
              <div style={{ fontSize: 48, fontWeight: "bold", color: C.gold, marginBottom: 8 }}>GAME OVER</div>
              <div style={{ color: C.green, fontSize: 20, marginBottom: 8 }}>Bakiye: {gs.balance?.toFixed(2)}</div>
              <div style={{ color: C.gray, fontSize: 13, marginBottom: 24 }}>Yeni birim: {gs.balance ? (gs.balance * 0.005).toFixed(2) : "—"}</div>
              <button style={{ ...S.btnGold, marginBottom: 12 }} onClick={resetGame} disabled={loading}>{loading ? "..." : "Yeniden Oyna"}</button>
              <button style={{ ...S.btnGhost, width: "100%", maxWidth: 300 }} onClick={handleLogout}>Çıkış Yap</button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 14, width: "100%", justifyContent: "center" }}>
                {[{ l: "B", sub: "BANKER", color: C.blue }, { l: "P", sub: "PLAYER", color: C.red }, { l: "T", sub: "TIE", color: C.dark }].map(({ l, sub, color }) => (
                  <button key={l} onClick={() => addResult(l)} disabled={loading} style={{ flex: 1, maxWidth: 120, height: 100, fontSize: 32, fontWeight: "bold", backgroundColor: color, color: C.white, border: lastResult === l ? `3px solid ${C.gold}` : "none", borderRadius: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, WebkitTapHighlightColor: "transparent" }}>
                    {l}<span style={{ fontSize: 11, fontWeight: "normal", opacity: 0.8 }}>{sub}</span>
                  </button>
                ))}
              </div>
              {lastResult && <div style={{ color: C.gray, fontSize: 13 }}>Son girilen: <span style={{ color: lastResult === "B" ? C.blue : lastResult === "P" ? C.red : C.gray, fontWeight: "bold" }}>{lastResult}</span></div>}
              <button onClick={finishGame} disabled={loading} style={{ marginTop: 8, padding: "10px 28px", fontSize: 13, backgroundColor: "transparent", color: "#ff8844", border: "1px solid #ff8844", borderRadius: 8, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                Oyunu Bitir
              </button>
            </>
          )}

          <HistoryChips history={gs?.history} />
        </div>
        <FlashOverlay />
      </div>
    );
  }

  return null;
}
