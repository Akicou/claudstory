const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const pty = require('@lydell/node-pty')
const fs = require('fs/promises')
const path = require('path')
const os = require('os')

const ROOT = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
const cache = new Map() // file -> {mtime, meta}; avoids re-reading unchanged sessions
const ptys = new Map()
let win

// Only the head of each file is read: sessions can be hundreds of MB.
async function readMeta(file, st) {
  const c = cache.get(file)
  if (c && c.mtime === st.mtimeMs) return c.meta
  const fh = await fs.open(file, 'r')
  const buf = Buffer.alloc(Math.min(st.size, 256 * 1024))
  await fh.read(buf, 0, buf.length, 0)
  await fh.close()
  let cwd = '', title = '', first = ''
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.startsWith('{')) continue
    let o
    try { o = JSON.parse(line) } catch { continue } // last line is likely truncated
    if (!cwd && o.cwd) cwd = o.cwd
    if (o.type === 'ai-title' && o.aiTitle) title = o.aiTitle
    if (o.type === 'custom-title' && o.customTitle) title = o.customTitle
    if (!first && o.type === 'user' && !o.isMeta && typeof o.message?.content === 'string' && !o.message.content.startsWith('<'))
      first = o.message.content.replace(/\s+/g, ' ').slice(0, 160)
  }
  const meta = { cwd, title: title || first || '(no prompt)' }
  cache.set(file, { mtime: st.mtimeMs, meta })
  return meta
}

async function listSessions() {
  const out = []
  let dirs = []
  try { dirs = await fs.readdir(ROOT, { withFileTypes: true }) } catch { return out }
  await Promise.all(dirs.filter(d => d.isDirectory()).map(async d => {
    const dir = path.join(ROOT, d.name)
    for (const f of await fs.readdir(dir).catch(() => [])) {
      if (!f.endsWith('.jsonl')) continue
      const file = path.join(dir, f)
      try {
        const st = await fs.stat(file)
        if (!st.size) continue
        const m = await readMeta(file, st)
        out.push({ id: f.slice(0, -6), cwd: m.cwd || d.name, title: m.title, mtime: st.mtimeMs, size: st.size })
      } catch {}
    }
  }))
  return out
}

ipcMain.handle('sessions', listSessions)
ipcMain.handle('pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.on('pty-open', (_e, { key, cwd, resume, cols, rows }) => {
  const args = resume ? ['--resume', resume] : []
  // cmd /c resolves claude.exe or claude.cmd alike; ponytail: assumes `claude` is on PATH
  const p = process.platform === 'win32'
    ? pty.spawn('cmd.exe', ['/c', 'claude', ...args], { cwd, cols, rows, name: 'xterm-256color', env: process.env })
    : pty.spawn('claude', args, { cwd, cols, rows, name: 'xterm-256color', env: process.env })
  ptys.set(key, p)
  p.onData(d => win?.webContents.send('pty-data', key, d))
  p.onExit(() => { ptys.delete(key); win?.webContents.send('pty-exit', key) })
})
ipcMain.on('pty-write', (_e, key, d) => ptys.get(key)?.write(d))
ipcMain.on('pty-resize', (_e, key, c, r) => { try { ptys.get(key)?.resize(c, r) } catch {} })
ipcMain.on('pty-close', (_e, key) => { ptys.get(key)?.kill(); ptys.delete(key) })

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1400, height: 880, backgroundColor: '#14151a', title: 'claudstory', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }, // local-only UI, loads no remote content
  })
  win.removeMenu()
  win.loadFile('index.html')
})
app.on('window-all-closed', () => { ptys.forEach(p => p.kill()); app.quit() })
