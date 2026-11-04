// Копирует веб-версию «Велокарты» (папка выше) в www/ — её покажет Android-приложение.
// Сервер (velo/server) и служебные папки в APK не попадают.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..');     // velo/
const dst = join(here, '..', 'www');    // velo/app/www

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
const files = ['index.html', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'sw.js', 'vendor', 'js'];
for (const f of files) {
  const from = join(src, f);
  if (!existsSync(from)) throw new Error('нет файла: ' + from);
  cpSync(from, join(dst, f), { recursive: true });
}
console.log('веб-версия скопирована в', dst);
