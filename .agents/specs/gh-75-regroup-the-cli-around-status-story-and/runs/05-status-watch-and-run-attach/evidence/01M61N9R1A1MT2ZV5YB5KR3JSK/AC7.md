# AC7 (B11) — real terminal
`python3 pty_watch.py` forks a real pty (TERM=xterm-256color, HERDR_* removed), runs `bun packages/cli/src/main.ts status --watch --interval 1s` in the throwaway repo, sends a key after 3.5s.
- q: exit 0, quit within 0.03s, 4 frames drawn (refreshes at 1s) — AC7-q.txt (raw bytes AC7-q.raw)
- Esc: exit 0, quit within 0.03s, 4 frames — AC7-esc.txt
Last frame: header, "no stories yet" list column, preview column, key bar `/ filter · ? keys · q quit`.
