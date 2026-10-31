import os, pty, sys, time, select, re
w, repo, key, out = sys.argv[1:5]
env = {k:v for k,v in os.environ.items() if not k.startswith("HERDR")}
env["TERM"]="xterm-256color"; env["COLUMNS"]="120"; env["LINES"]="30"
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo); os.execvpe("bun", ["bun", w+"/packages/cli/src/main.ts", "status", "--watch", "--interval", "1s"], env)
buf=b""; t0=time.time(); sent=None
while True:
    r,_,_ = select.select([fd],[],[],0.1)
    if r:
        try: d=os.read(fd,65536)
        except OSError: break
        if not d: break
        buf+=d
    if sent is None and time.time()-t0>3.5:
        os.write(fd, b"q" if key=="q" else b"\x1b"); sent=time.time()
    if time.time()-t0>12: os.kill(pid,9); print("TIMEOUT"); break
_,st=os.waitpid(pid,0)
open(out,"wb").write(buf)
txt=buf.decode("utf8","replace")
print("key",repr(key),"exit",os.waitstatus_to_exitcode(st),"quit_after_s",round(time.time()-sent,2) if sent else None)
print("frames(clear-screen/home seqs):", txt.count("\x1b[H"), "bytes", len(buf))
print("timestamps seen:", sorted(set(re.findall(r"\d\d:\d\d:\d\d", txt))))
clean=re.sub(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Z0-9]","",txt)
print("--- last frame text ---"); print(clean[-1500:])
