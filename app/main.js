// app/main.js - the desktop "shell" for BITWORKS (an Electron app).
// This isn't game code: Electron runs this file first, and it opens a window with the game (game/index.html)
// inside it - a mini browser with no tabs, no address bar and no menu, so it feels like a real program.
// F11 = fullscreen on/off. Your world is saved by itself, inside the app's own storage on this computer.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

Menu.setApplicationMenu(null);   // no menu bar

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 860,
    backgroundColor: '#0b0e13',
    title: 'BITWORKS',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, spellcheck: false },
  });
  win.maximize();
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.on('will-navigate', e => e.preventDefault());       // (a file dropped on the window mustn't replace the game)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'game', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
