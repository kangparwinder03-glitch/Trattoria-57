# Static files + a tiny one-at-a-time JSON database for the tests (like Postgres: each write is atomic).
import http.server, json, sys, os
DB = {}
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        if self.path != "/__db": return self.send_error(404)
        n = int(self.headers.get("Content-Length", 0)); q = json.loads(self.rfile.read(n) or b"{}"); op = q.get("op")
        if op == "all": out = DB
        elif op == "upsert":
            r = q["row"]; DB[r["coll"] + "/" + r["id"]] = r; out = {}
            if r["coll"].endswith("tickets"): open(os.environ.get("DBLOG","/tmp/dblog.txt"),"a").write("UPSERT "+r["id"]+" "+r["data"].get("label","")+" closed="+str(r["data"].get("closed"))+"\n")
        elif op == "merge":
            k = q["c"] + "/" + q["i"]; cur = DB.get(k) or {"coll": q["c"], "id": q["i"], "data": {}}
            cur["data"] = {**cur["data"], **q["patch"]}; DB[k] = cur; out = {}
        elif op == "del":
            if any(k.startswith(("tickets/","train_tickets/")) for k in q["keys"]): open(os.environ.get("DBLOG","/tmp/dblog.txt"),"a").write("DEL "+json.dumps(q["keys"])+"\n")
            for k in q["keys"]: DB.pop(k, None)
            out = {}
        elif op == "clear": DB.clear(); out = {}
        else: return self.send_error(400)
        b = json.dumps(out).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
os.chdir(sys.argv[2]); http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
