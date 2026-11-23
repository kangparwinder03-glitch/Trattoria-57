import json,sys
mode=sys.argv[1]  # preview | site
cfg=json.load(open('config.json'))
t=open('template.html').read()
t=t.replace('{{FOOD}}',open('food.json').read())
t=t.replace('{{HOURS}}',json.dumps(cfg['hours']))
t=t.replace('{{BOOKING}}',json.dumps(cfg['booking']) if mode=='site' else 'null')
for k in ['PHONE','PHONE_TEL','ADDRESS','ADDRESS_SHORT']: t=t.replace('{{%s}}'%k,cfg[k.lower()])
if mode=='preview':
  t=t.replace('<!--PREVIEW_BANNER-->','<div class="preview">Design preview. The opening hours are examples until Parwinder sends the real ones, and the booking form doesn\'t send anything yet.</div>')
else:
  t=t.replace('<span class="flag">example</span>','').replace('<title>Trattoria 57 Website</title>','<title>Trattoria 57 · Italian Kitchen &amp; Bar, Barnoldswick</title>').replace('<meta name="claude:viewport-fit-sides" content="cover">\n','')
  t='<!doctype html>\n<html lang="en-GB">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="icon" href="icon-192.png">\n'+t.replace('<!--PREVIEW_BANNER-->','</head>\n<body>',1)+'\n</body>\n</html>\n'
open(sys.argv[2],'w').write(t)
