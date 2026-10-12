import subprocess, time, json, os, sys
HOME=os.path.expanduser('~')
STATE=HOME+'/.local/state/lahe'
def procs():
    out=subprocess.run(['ps','-axo','pid=,ppid=,rss=,command='],capture_output=True,text=True).stdout
    helper=[];pages=[]
    for l in out.splitlines():
        p=l.split(None,3)
        if len(p)<4: continue
        pid,ppid,rss,cmd=int(p[0]),int(p[1]),int(p[2]),p[3]
        if STATE not in cmd and 'lahe.js serve --restart' not in cmd: continue
        if 'static_servers.js --serve' in cmd: pages.append((pid,rss))
        elif 'lahe.js serve' in cmd: helper.append((pid,rss))
    return helper,pages
samples=[];seen=set()
dur=int(sys.argv[1]); step=10
t0=time.time()
while time.time()-t0<dur:
    h,p=procs()
    for pid,_ in p: seen.add(pid)
    samples.append({'t':round(time.time()-t0),'helpers':len(h),'helper_rss_kb':sum(r for _,r in h),'pages':len(p),'pages_rss_kb':sum(r for _,r in p)})
    time.sleep(step)
res={'duration_s':dur,'samples':samples,'distinct_page_server_pids':len(seen)}
open(sys.argv[2],'w').write(json.dumps(res,indent=1))
n=len(samples)
print('samples',n,'distinct page pids',len(seen))
print('avg pages',sum(s['pages'] for s in samples)/n,'avg pages MB',sum(s['pages_rss_kb'] for s in samples)/n/1024,'avg helper MB',sum(s['helper_rss_kb'] for s in samples)/n/1024)
