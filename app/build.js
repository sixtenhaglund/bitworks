// app/build.js - makes the DESKTOP APP: BITWORKS.exe (Windows).
//   1) copies the game (index.html, sim.js, main.js from the folder above) into app/game
//   2) "packages" it with Electron into app/dist/BITWORKS-win32-x64 (BITWORKS.exe + everything it needs)
//   3) puts a BITWORKS shortcut on the Desktop
// Run with:  npm run build      (in this app folder). Run it again after changing the game to update the app.
"use strict";
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');

(async () => {
  const game = path.join(__dirname, 'game');
  fs.mkdirSync(game, { recursive: true });
  for (const f of ['index.html', 'sim.js', 'main.js']) fs.copyFileSync(path.join(__dirname, '..', f), path.join(game, f));
  console.log('Game copied');

  const out = path.join(__dirname, 'dist');
  fs.rmSync(out, { recursive: true, force: true });
  const [dir] = await packager({
    dir: __dirname, name: 'BITWORKS', executableName: 'BITWORKS',
    platform: 'win32', arch: 'x64', out, overwrite: true, asar: true,
    icon: path.join(__dirname, 'icon.ico'),
    ignore: [/^\/dist($|\/)/, /^\/build\.js$/, /^\/make-icon\.js$/, /^\/node_modules($|\/)/, /^\/package-lock\.json$/, /^\/icon\.ico$/],
    appVersion: '1.0.0',
    win32metadata: { ProductName: 'BITWORKS', FileDescription: 'BITWORKS' },
  });
  const exe = path.join(dir, 'BITWORKS.exe');
  console.log('App: ' + exe);

  // the Desktop shortcut (made by Windows' own scripting, so it has the icon)
  const desktop = path.join(process.env.USERPROFILE, 'Desktop', 'BITWORKS.lnk');
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${desktop}');$s.TargetPath='${exe}';$s.WorkingDirectory='${dir}';$s.IconLocation='${exe},0';$s.Save()`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps]);
  console.log('Shortcut: ' + desktop);
})().catch(e => { console.error(e); process.exit(1); });
