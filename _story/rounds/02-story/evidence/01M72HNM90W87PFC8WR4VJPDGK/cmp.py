import json,glob,re,sys,os
def load(d,norm):
    out={};wt=set()
    for f in glob.glob(d+'/packages/core/test/golden/*.json'):
        c=json.load(open(f)); wt.add(c['facts']['repo'].get('worktrees'))
        s=json.dumps(c['decisions'],sort_keys=True)
        if norm: s=re.sub(r'<dir>/home/repos/[^/"]+/worktrees/','W/',s); s=s.replace('<dir>/repo-worktrees/','W/')
        out[c['tick_id']]=s
    return out,wt
q=sys.argv[1]
b,bw=load(q+'/g/base',False); s,sw=load(q+'/g/s01',False); h,hw=load(q+'/g/head',True); bn,_=load(q+'/g/base',True)
print('cases base/s01/head',len(b),len(s),len(h))
print('01.AC2 slice01 worktrees facts:',sorted(map(str,sw))[:3],'decisions identical to base:',s==b)
print('03.AC10 head worktrees facts distinct:',len(hw),'all machine-dir:',all(re.match(r'<dir>/home/repos/[^/]+/worktrees$',x or '') for x in hw))
print('03.AC10 head decisions mention repo-worktrees:',any('repo-worktrees' in v for v in h.values()))
print('03.AC10 normalised decisions identical to base:',h==bn, 'same tick ids:', set(h)==set(bn))
