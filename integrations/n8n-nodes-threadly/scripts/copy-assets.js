// Copia a dist/ los assets que tsc ignora: el icono SVG y el codex (*.node.json).
// n8n los carga por la MISMA ruta relativa del .node.js compilado (icon:
// "file:threadly.svg"), asi que si no se copian el nodo aparece sin icono y sin
// categorias en la UI. Sin dependencias: los nodos verificados no pueden traer
// librerias, y un devDependency de build extra es ruido que igual hay que auditar.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

// Se copian nodes/ y credentials/: la credencial tambien declara icono y n8n lo
// busca junto al .js compilado, no junto al del nodo. El SVG esta duplicado a
// proposito (ver el comentario del campo `icon` en ThreadlyApi.credentials.ts).
const CARPETAS = ["nodes", "credentials"];

const EXTENSIONES = [".svg", ".png", ".node.json"];

function copiarAssets(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copiarAssets(srcPath, destPath);
    } else if (entry.isFile() && EXTENSIONES.some((ext) => entry.name.endsWith(ext))) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      console.log(`asset: ${path.relative(root, destPath)}`);
    }
  }
}

for (const carpeta of CARPETAS) {
  copiarAssets(path.join(root, carpeta), path.join(root, "dist", carpeta));
}
