import datetime,os,glob
T=".agents/norn/trace"
for f in glob.glob(T+"/????-??-??*.jsonl"): os.remove(f)
today=datetime.datetime.now(datetime.timezone.utc).date()
for a in range(0,46):
    d=(today-datetime.timedelta(days=a)).isoformat()
    open(f"{T}/{d}.jsonl","w").write('{"type":"pad"}\n'*100)
    if a%2==0: open(f"{T}/{d}.chunks.jsonl","w").write('{"c":1}\n'*10)
