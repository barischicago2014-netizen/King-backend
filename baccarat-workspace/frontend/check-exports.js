const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "src");

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const hasDefaultExport = /\bexport\s+default\b/.test(content);
  const hasAnyExport = /\bexport\b/.test(content);
  return { hasDefaultExport, hasAnyExport };
}

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) return scanDir(filePath);
    if (!/\.(js|jsx|ts|tsx)$/.test(file)) return;

    const { hasDefaultExport, hasAnyExport } = checkFile(filePath);
    const rel = path.relative(srcDir, filePath);

    if (rel === "App.jsx" || rel === "App.js") {
      if (!hasDefaultExport) {
        console.log(`❌ App default export yok: ${filePath}`);
      } else {
        console.log(`✅ OK: ${filePath}`);
      }
      return;
    }

    if (!hasAnyExport && rel !== "index.js" && rel !== "index.jsx") {
      console.log(`⚠️ Export yok: ${filePath}`);
    } else {
      console.log(`✅ OK: ${filePath}`);
    }
  });
}

console.log("🔍 Export kontrolü başlıyor...\n");
scanDir(srcDir);
console.log("\n✅ Kontrol tamamlandı.");