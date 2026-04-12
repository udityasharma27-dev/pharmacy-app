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

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}

console.log(`Static site prepared in ${output}`);
