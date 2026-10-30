const { ipcRenderer: ipc } = require('electron')
const { Terminal } = require('@xterm/xterm')
const { FitAddon } = require('@xterm/addon-fit')
const $ = id => document.getElementById(id)

let sessions = [], newest = true, active = null, seq = 0
const open = new Map() // key -> {term, fit, el, tab}

const ago = ms => {
  const s = (Date.now() - ms) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  if (s < 86400 * 60) return Math.floor(s / 86400) + 'd ago'
  return new Date(ms).toLocaleDateString()
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function render() {
  const q = $('q').value.toLowerCase()
  const rows = sessions.filter(s => !q || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q))
    .sort((a, b) => newest ? b.mtime - a.mtime : a.mtime - b.mtime)
  $('list').innerHTML = rows.map(s =>
    `<div class="item${open.has(s.id) ? ' open' : ''}${active === s.id ? ' active' : ''}" data-id="${s.id}">
      <div class="t">${esc(s.title)}</div>
      <div class="m"><span title="${esc(s.cwd)}">${esc(s.cwd)}</span><span>${ago(s.mtime)}</span></div></div>`).join('')
}

async function refresh() {
  sessions = await ipc.invoke('sessions')
  render()
}

function openTerm(key, label, cwd, resume) {
  if (open.has(key)) return show(key)
  const el = document.createElement('div'); el.className = 'term'
  $('terms').appendChild(el)
  const term = new Terminal({
    fontFamily: "'Cascadia Mono', Consolas, monospace", fontSize: 13, cursorBlink: true, scrollback: 10000,
    theme: { background: '#14151a', foreground: '#d7d9e0', cursor: '#d97757', selectionBackground: '#3a3f4f' },
  })
  const fit = new FitAddon(); term.loadAddon(fit); term.open(el)
  const tab = document.createElement('div'); tab.className = 'tab'
  tab.innerHTML = `<span class="n">${esc(label)}</span><span class="x">✕</span>`
  tab.onclick = e => e.target.className === 'x' ? close(key) : show(key)
  $('tabs').appendChild(tab)
  open.set(key, { term, fit, el, tab })
  show(key)
  ipc.send('pty-open', { key, cwd, resume, cols: term.cols, rows: term.rows })
  term.onData(d => ipc.send('pty-write', key, d))
  term.onResize(({ cols, rows }) => ipc.send('pty-resize', key, cols, rows))
}

function show(key) {
  active = key
  for (const [k, t] of open) {
    t.el.classList.toggle('active', k === key); t.tab.classList.toggle('active', k === key)
  }
  $('empty').style.display = open.size ? 'none' : 'flex'
  const t = open.get(key)
  if (t) requestAnimationFrame(() => { t.fit.fit(); t.term.focus() })
  render()
}

function close(key) {
  const t = open.get(key); if (!t) return
  ipc.send('pty-close', key); t.term.dispose(); t.el.remove(); t.tab.remove(); open.delete(key)
  if (active === key) active = null
  const next = [...open.keys()].pop()
  next ? show(next) : ($('empty').style.display = 'flex', render())
}

ipc.on('pty-data', (_e, key, d) => open.get(key)?.term.write(d))
ipc.on('pty-exit', (_e, key) => { open.get(key)?.term.write('\r\n\x1b[90m[session ended - close tab or pick another]\x1b[0m'); refresh() })

$('list').onclick = e => {
  const id = e.target.closest('.item')?.dataset.id; if (!id) return
  const s = sessions.find(x => x.id === id)
  openTerm(id, s.title.slice(0, 28), s.cwd, id)
}
$('new').onclick = async () => {
  const dir = await ipc.invoke('pick-dir'); if (!dir) return
  openTerm('new-' + ++seq, 'New · ' + dir.split(/[\\/]/).pop(), dir, null)
}
$('sort').onclick = () => { newest = !newest; $('sort').textContent = newest ? 'Newest ↓' : 'Oldest ↑'; render() }
$('q').oninput = render
new ResizeObserver(() => open.get(active)?.fit.fit()).observe($('terms'))
window.onfocus = refresh
setInterval(() => document.hasFocus() && refresh(), 5000)
refresh()
