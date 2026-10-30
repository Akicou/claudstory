# claudstory

One desktop window for every [Claude Code](https://claude.com/claude-code) session on your machine.

- Lists sessions from all project folders (`~/.claude/projects`), newest-first or oldest-first
- Search by prompt or folder
- Click a session to resume it (`claude --resume <id>`) in a built-in terminal tab
- **+ New session** picks a folder and starts a fresh `claude`
- Multiple terminal tabs; Windows, macOS, Linux (Electron + xterm.js + node-pty)

## Run

Requires Node 18+ and the `claude` CLI on your `PATH`.

```
npm install
npm start
```

Set `CLAUDE_CONFIG_DIR` if your Claude config is not in `~/.claude`.

Only the first 256 KB of each session file is read and results are cached by mtime, so large histories stay fast.

## License

MIT
