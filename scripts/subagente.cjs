#!/usr/bin/env node
'use strict';

/**
 * Puente de Subagentes Reales por Suscripción (Cero API Keys)
 * Ejecuta los binarios locales ya logueados en la PC de Juan:
 *   - codex: usa el binario de la extensión de VS Code (openai.chatgpt-*) con `codex exec`
 *   - claude: usa el CLI global de Claude Code (`claude -p`)
 *
 * Uso:
 *   node scripts/subagente.cjs codex "<instrucción acotada>"
 *   node scripts/subagente.cjs claude "<instrucción acotada>"
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function findCodexBinary() {
  const home = os.homedir();
  const extDirs = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.antigravity', 'extensions')
  ];
  const candidates = [];
  for (const dir of extDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (/^openai\.chatgpt-/i.test(entry)) {
        const bin = path.join(dir, entry, 'bin', 'windows-x86_64', 'codex.exe');
        if (fs.existsSync(bin)) {
          candidates.push({ bin, mtime: fs.statSync(bin).mtimeMs });
        }
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.bin || 'codex';
}

function main() {
  const [target, ...rest] = process.argv.slice(2);
  const prompt = rest.join(' ').trim();
  if (!target || !prompt || !['codex', 'claude'].includes(target.toLowerCase())) {
    console.error('Uso: node scripts/subagente.cjs <codex|claude> "<instrucción acotada>"');
    process.exit(1);
  }

  const header = 'Regla obligatoria: Leé AGENTS.md. Usá `npm run codigo` antes de abrir archivos. No leas ni edites renderer/generated/** ni el HTML compilado. Respondé corto con qué archivos tocaste y evidencia.\n\nTarea:\n';
  const fullPrompt = header + prompt;

  if (target.toLowerCase() === 'codex') {
    const bin = findCodexBinary();
    const res = cp.spawnSync(bin, ['exec', '--full-auto', '-C', ROOT, fullPrompt], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.status ?? 0);
  }

  if (target.toLowerCase() === 'claude') {
    const res = cp.spawnSync('claude', ['-p', fullPrompt, '--permission-mode', 'acceptEdits'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.status ?? 0);
  }
}

main();

