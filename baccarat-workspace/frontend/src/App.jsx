import React, { useState } from "react";
import { api } from "./api";

function App() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const dealCards = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get("/game/deal");
      setResult(response.data);
    } catch (err) {
      setError("Sunucuya bağlanılamadı. Backend çalışıyor mu?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>♠ Baccarat</h1>

      <button style={styles.button} onClick={dealCards} disabled={loading}>
        {loading ? "Dağıtılıyor..." : "Kart Dağıt"}
      </button>

      {error && <p style={styles.error}>{error}</p>}

      {result && (
        <div style={styles.result}>
          <div style={styles.hand}>
            <h2>Player</h2>
            <p>Kartlar: {result.player?.cards?.join(", ")}</p>
            <p>Puan: {result.player?.score}</p>
          </div>
          <div style={styles.hand}>
            <h2>Banker</h2>
            <p>Kartlar: {result.banker?.cards?.join(", ")}</p>
            <p>Puan: {result.banker?.score}</p>
          </div>
          <h2 style={styles.winner}>
            Sonuç:{" "}
            {result.winner === "player"
              ? "Player Kazandı! 🎉"
              : result.winner === "banker"
              ? "Banker Kazandı!"
              : "Berabere!"}
          </h2>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#0a2e1a",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "Arial, sans-serif",
    padding: "20px",
  },
  title: {
    fontSize: "48px",
    marginBottom: "30px",
    color: "#ffd700",
  },
  button: {
    padding: "15px 40px",
    fontSize: "20px",
    backgroundColor: "#ffd700",
    color: "#000",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    marginBottom: "30px",
  },
  error: {
    color: "#ff6b6b",
    fontSize: "16px",
  },
  result: {
    textAlign: "center",
    backgroundColor: "#1a4a2e",
    padding: "30px",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "500px",
  },
  hand: {
    marginBottom: "20px",
    padding: "15px",
    backgroundColor: "#0a2e1a",
    borderRadius: "8px",
  },
  winner: {
    color: "#ffd700",
    fontSize: "24px",
  },
};

export default App;

