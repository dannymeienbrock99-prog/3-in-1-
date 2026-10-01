import json, sys, time, os
for line in sys.stdin:
    job = json.loads(line)
    time.sleep(job.get('delay', 0))
    print(json.dumps({'pid': os.getpid(), 'text': job.get('text', '')}), flush=True)
