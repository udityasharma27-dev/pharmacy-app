const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "web-dist");
const files = [
  "index.html",
  "app.html",
  "checkout.html",
  "app.css",
  "app.js",
  "pwa.js",
  "api-base.js",
  "manifest.webmanifest",
  "sw.js",
  "qr.png"
];

function copyDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}

copyDirectory(path.join(root, "assets"), path.join(output, "assets"));

console.log(`Static site prepared in ${output}`);
