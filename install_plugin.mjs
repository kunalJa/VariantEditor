// dev.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

dotenvExpand.expand(dotenv.config());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filesToCopy = ['main.js', 'styles.css', 'manifest.json'];
const srcDir = __dirname;
const destDir = process.env.PLUGIN_INSTALL_DIR;

if (!destDir) {
  console.error("❌ PLUGIN_INSTALL_DIR not set in .env");
  process.exit(1);
}

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  console.log(`📁 Created destination directory: ${destDir}`);
}

for (const file of filesToCopy) {
  const src = path.join(srcDir, file);
  const dest = path.join(destDir, file);

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✅ Copied ${file} to ${dest}`);
  } else {
    console.warn(`⚠️  File not found: ${file}`);
  }
}
