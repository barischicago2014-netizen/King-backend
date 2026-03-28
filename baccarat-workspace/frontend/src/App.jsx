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
  const [screen, setScreen] = useState("landing");
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab] = useState("login");
  const [form, setForm] = useState({ username: "", password: "" });
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const [gs, setGs] = useState(null);
  const [dealCards, setDealCards] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("bac_token");
    const username = localStorage.getItem("bac_user");
    if (token && username) setUser({ token, username });
  }, []);

  function showFlash(text, color) {
    setFlash({ text, color });
    setTimeout(() => setFlash(null), 2000);
  }

  async function handleAuth() {
    setFormError("");
    if (!form.username.trim() || !form.password.trim()) { setFormError("Kullanıcı adı ve şifre gerekli"); return; }
    setLoading(true);
    try {
      const endpoint = authTab === "login" ? "/login" : "/register";
      const res = await api.post(endpoint, form);
      localStorage.setItem("bac_token", res.data.token);
      localStorage.setItem("bac_user", res.data.username);
      setUser({ token: res.data.token, username: res.data.username });
      setShowAuth(false);
      setForm({ username: "", password: "" });
      await api.post("/game/start");
      const stateRes = await api.get("/game/state");
      setGs(stateRes.data);
      setLastResult(null);
      setDealCards(null);
      setScreen("game");
    } catch (err) {
      setFormError(err.response?.data?.message || "Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("bac_token");
    localStorage.removeItem("bac_user");
    setUser(null); setGs(null); setLastResult(null); setScreen("landing");
  }

  async function startDemo() {
    setLoading(true);
    try {
      await api.post("/demo/reset");
      setGs({ balance: 100, scoreboard: { B: 0, P: 0, T: 0 }, phase: "waiting", history: [], recommendation: null, unit: null, message: "Kart çekmek için dokun" });
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
      if (res.data.win === true) showFlash(`+${res.data.unit || 1}`, C.green);
      else if (res.data.win === false) showFlash(`-${res.data.unit || 1}`, C.red);
    } finally { setLoading(false); }
  }

  async function addResult(result) {
    if (loading || gs?.gameOver) return;
    setLoading(true);
    try {
      const res = await api.post("/game/result", { result });
      setLastResult(result);
      setGs((prev) => ({ ...prev, ...res.data }));
      if (res.data.win === true) showFlash(`+${res.data.unit || 1} birim`, C.green);
      else if (res.data.win === false) showFlash(`-${res.data.unit || 1} birim`, C.red);
    } catch (err) {
      if (err.response?.status === 404) {
        await api.post("/game/start");
        const stateRes = await api.get("/game/state");
        setGs(stateRes.data);
      }
    } finally { setLoading(false); }
  }

  async function resetGame() {
    setLoading(true);
    try {
      await api.post("/game/reset");
      const stateRes = await api.get("/game/state");
      setGs(stateRes.data); setLastResult(null);
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
          <span key={i} style={{
            width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 4, fontWeight: "bold", fontSize: 13,
            backgroundColor: i === 0 ? (r === "B" ? "#1a3a6a" : r === "P" ? "#5a1a1a" : "#333") : C.card,
            color: r === "B" ? C.blue : r === "P" ? C.red : C.gray,
            border: `1px solid ${C.border}`,
          }}>{r}</span>
        ))}
      </div>
    );
  }

  function FlashOverlay() {
    if (!flash) return null;
    return (
      <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", backgroundColor: flash.color, color: "#000", padding: "10px 28px", borderRadius: 20, fontWeight: "bold", fontSize: 20, zIndex: 200 }}>
        {flash.text}
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // LANDING
  // ═══════════════════════════════════════════
  if (screen === "landing") {
    return (
      <div style={S.page}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ fontSize: 64, marginBottom: 4 }}>♠</div>
          <h1 style={{ fontSize: 42, color: C.gold, margin: "0 0 8px", letterSpacing: 2 }}>BACCARAT</h1>
          <p style={{ color: C.gray, marginBottom: 48, fontSize: 14 }}>Strateji Sistemi</p>
          <button style={{ ...S.btnGold, marginBottom: 14 }} onClick={() => { setAuthTab("login"); setShowAuth(true); }}>Giriş Yap</button>
          <button style={{ ...S.btnOutline, marginBottom: 10 }} onClick={startDemo} disabled={loading}>{loading ? "..." : "Demo Oyna"}</button>
          <button style={{ ...S.btnGhost, marginTop: 4 }} onClick={() => { setAuthTab("register"); setShowAuth(true); }}>Hesap Oluştur</button>
        </div>

        {showAuth && (
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, padding: 32, borderRadius: 14, width: 320 }}>
              <div style={{ display: "flex", marginBottom: 24, gap: 8 }}>
                {["login", "register"].map((tab) => (
                  <button key={tab} onClick={() => { setAuthTab(tab); setFormError(""); }}
                    style={{ flex: 1, padding: "10px 0", fontSize: 14, fontWeight: "bold", borderRadius: 6, cursor: "pointer", border: "none", backgroundColor: authTab === tab ? C.gold : C.dark, color: authTab === tab ? "#000" : C.gray }}>
                    {tab === "login" ? "Giriş Yap" : "Kayıt Ol"}
                  </button>
                ))}
              </div>
              <input style={{ ...S.input, marginBottom: 12 }} placeholder="Kullanıcı adı" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleAuth()} autoComplete="username" />
              <input style={{ ...S.input, marginBottom: 16 }} type="password" placeholder="Şifre" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleAuth()} autoComplete="current-password" />
              {formError && <p style={{ color: C.red, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{formError}</p>}
              <button style={{ ...S.btnGold, marginBottom: 10 }} onClick={handleAuth} disabled={loading}>{loading ? "..." : authTab === "login" ? "Giriş Yap" : "Kayıt Ol"}</button>
              <button style={{ ...S.btnGhost, width: "100%", textAlign: "center" }} onClick={() => { setShowAuth(false); setFormError(""); setForm({ username: "", password: "" }); }}>İptal</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // DEMO
  // ═══════════════════════════════════════════
  if (screen === "demo") {
    const sc = gs?.scoreboard || { B: 0, P: 0, T: 0 };
    return (
      <div style={S.page}>
        <div style={S.header}>
          <button style={S.btnGhost} onClick={() => setScreen("landing")}>← Geri</button>
          <span style={{ color: C.gold, fontWeight: "bold", letterSpacing: 1 }}>DEMO MODU</span>
          <span style={{ color: C.gold, fontWeight: "bold", fontSize: 18 }}>{gs?.balance?.toFixed(1) ?? "100.0"}</span>
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
              {gs.phase === "observation" ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>GÖZLEM MODU</div><div style={{ fontSize: 36 }}>⏸</div>{gs.observationLeft > 0 && <div style={{ color: C.gray }}>{gs.observationLeft} el kaldı</div>}</>
              ) : gs.recommendation ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>SİSTEM ÖNERİSİ</div><div style={{ fontSize: 38, fontWeight: "bold", color: gs.recommendation === "B" ? C.blue : C.red, marginBottom: 4 }}>{gs.recommendation === "B" ? "BANKER" : "PLAYER"}</div><div style={{ color: C.gold, fontSize: 20 }}>{gs.unit} birim</div></>
              ) : (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>BEKLENIYOR</div><div style={{ color: C.gray, fontSize: 18 }}>{gs.message}</div></>
              )}
            </div>
          )}

          {gs?.message && !gs.gameOver && (
            <div style={{ fontSize: 15, fontWeight: "bold", padding: "8px 20px", borderRadius: 8, backgroundColor: C.card, color: gs.message.includes("KAZANÇ") ? C.green : gs.message.includes("KAYIP") ? C.red : C.white }}>
              {gs.message}
            </div>
          )}

          {gs?.gameOver ? (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 44, fontWeight: "bold", color: C.gold, marginBottom: 8 }}>GAME OVER</div>
              <div style={{ color: C.white, marginBottom: 24, fontSize: 18 }}>Bakiye: {gs.balance?.toFixed(1)}</div>
              <button style={{ ...S.btnGold, marginBottom: 12 }} onClick={startDemo}>Yeniden Oyna</button>
              <button style={S.btnGhost} onClick={() => setScreen("landing")}>Ana Sayfa</button>
            </div>
          ) : (
            <button style={{ ...S.btnGold, fontSize: 20, padding: "18px 0", maxWidth: 260 }} onClick={demoDeal} disabled={loading}>
              {loading ? "..." : "🂠  Kart Çek"}
            </button>
          )}

          <HistoryChips history={gs?.history} />
        </div>
        <FlashOverlay />
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // GAME (authenticated)
  // ═══════════════════════════════════════════
  if (screen === "game") {
    const sc = gs?.scoreboard || { B: 0, P: 0, T: 0 };
    const phase = gs?.phase;

    return (
      <div style={S.page}>
        <div style={S.header}>
          <span style={{ color: C.gray, fontSize: 13 }}>👤 {user?.username}</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.gold, fontWeight: "bold", fontSize: 20 }}>{gs?.balance?.toFixed(1) ?? "100.0"}</div>
            {gs?.maxWin && gs.maxWin > 100 && <div style={{ color: C.gray, fontSize: 11 }}>max: {gs.maxWin.toFixed(1)}</div>}
          </div>
          <button style={S.btnGhost} onClick={handleLogout}>Çıkış</button>
        </div>

        <div style={S.content}>
          <ScoreboardBlock sc={sc} />

          {gs && !gs.gameOver && (
            <div style={S.recBox}>
              {phase === "observation" ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 6 }}>GÖZLEM MODU</div><div style={{ fontSize: 34 }}>⏸</div>{gs.observationLeft > 0 && <div style={{ color: C.gray, marginTop: 6 }}>{gs.observationLeft} el kaldı — sonuçları girmeye devam edin</div>}</>
              ) : phase === "waiting" ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 6 }}>BAŞLANGIÇ</div><div style={{ color: C.gray, fontSize: 18 }}>{Math.max(0, 3 - (sc.B + sc.P))} sonuç daha girin</div></>
              ) : gs.recommendation ? (
                <><div style={{ color: C.gray, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>SİSTEM ÖNERİSİ</div><div style={{ fontSize: 42, fontWeight: "bold", marginBottom: 6, color: gs.recommendation === "B" ? C.blue : C.red }}>{gs.recommendation === "B" ? "BANKER" : "PLAYER"}</div><div style={{ color: C.gold, fontSize: 22, fontWeight: "bold" }}>{gs.unit} birim</div></>
              ) : null}
            </div>
          )}

          {gs?.message && !gs.gameOver && (
            <div style={{ fontSize: 14, fontWeight: "bold", padding: "8px 18px", borderRadius: 8, backgroundColor: C.card, color: gs.message.includes("KAZANÇ") ? C.green : gs.message.includes("KAYIP") ? C.red : C.white }}>
              {gs.message}
            </div>
          )}

          {gs?.gameOver ? (
            <div style={{ textAlign: "center", padding: 24, width: "100%" }}>
              <div style={{ fontSize: 48, fontWeight: "bold", color: C.gold, marginBottom: 8 }}>GAME OVER</div>
              <div style={{ color: C.green, fontSize: 20, marginBottom: 24 }}>Bakiye: {gs.balance?.toFixed(1)} birim</div>
              <button style={{ ...S.btnGold, marginBottom: 12 }} onClick={resetGame} disabled={loading}>{loading ? "..." : "Yeniden Oyna"}</button>
              <button style={{ ...S.btnGhost, width: "100%", maxWidth: 300 }} onClick={handleLogout}>Çıkış Yap</button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, width: "100%", justifyContent: "center" }}>
                {[{ l: "B", sub: "BANKER", color: C.blue }, { l: "P", sub: "PLAYER", color: C.red }, { l: "T", sub: "TIE", color: C.dark }].map(({ l, sub, color }) => (
                  <button key={l} onClick={() => addResult(l)} disabled={loading} style={{ flex: 1, maxWidth: 110, height: 90, fontSize: 28, fontWeight: "bold", backgroundColor: color, color: C.white, border: lastResult === l ? `3px solid ${C.gold}` : "none", borderRadius: 12, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                    {l}<span style={{ fontSize: 10, fontWeight: "normal", opacity: 0.8 }}>{sub}</span>
                  </button>
                ))}
              </div>
              {lastResult && (
                <div style={{ color: C.gray, fontSize: 13 }}>
                  Son girilen: <span style={{ color: lastResult === "B" ? C.blue : lastResult === "P" ? C.red : C.gray, fontWeight: "bold" }}>{lastResult}</span>
                </div>
              )}
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
