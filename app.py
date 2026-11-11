from contextlib import contextmanager
import json
import math
import os
import sqlite3
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError
from flask import Flask, jsonify, request, send_file

ROOT = Path(__file__).resolve().parent
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16384
DB = Path(os.environ.get("DATABASE_PATH", ROOT / "instance" / "maceio.sqlite3"))

@contextmanager
def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()

def init_db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    seed = json.loads((ROOT / "seed.json").read_text(encoding="utf8"))
    with connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS hospitals (id INTEGER PRIMARY KEY, data TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS roads (id TEXT PRIMARY KEY, name TEXT NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL, cost REAL NOT NULL)")
        if not db.execute("SELECT 1 FROM hospitals").fetchone():
            db.executemany("INSERT INTO hospitals VALUES (?, ?)", [(i+1, json.dumps(h)) for i,h in enumerate(seed["hospitals"])])
        if not db.execute("SELECT 1 FROM roads").fetchone():
            db.executemany("INSERT INTO roads VALUES (:id,:name,:direction,:status,:cost)", seed["roads"])

@app.get("/")
def home():
    return send_file(ROOT / "index.html")

@app.get("/api/health")
def health():
    with connect() as db:
        db.execute("SELECT 1")
    return jsonify(status="ok", database="sqlite")

@app.get("/api/hospitals")
def hospitals():
    with connect() as db:
        return jsonify([dict(json.loads(r["data"]), id=r["id"]) for r in db.execute("SELECT * FROM hospitals ORDER BY id")])

@app.get("/api/roads")
def roads():
    with connect() as db:
        return jsonify([dict(r) for r in db.execute("SELECT * FROM roads ORDER BY id")])

@app.patch("/api/roads/<road_id>")
def update_road(road_id):
    body = request.get_json(silent=True) or {}
    if body.get("status") not in ("Liberada", "Bloqueada"):
        return jsonify(error="Status deve ser Liberada ou Bloqueada."), 400
    with connect() as db:
        result = db.execute("UPDATE roads SET status=? WHERE id=?", (body["status"], road_id))
        if not result.rowcount:
            return jsonify(error="Via n?o encontrada."), 404
        return jsonify(dict(db.execute("SELECT * FROM roads WHERE id=?", (road_id,)).fetchone()))

@app.post("/api/roads")
def create_road():
    body = request.get_json(silent=True) or {}
    name = body.get("name", "")
    if not isinstance(name,str) or not 1 <= len(name.strip()) <= 120:
        return jsonify(error="Informe um nome de at? 120 caracteres."),400
    with connect() as db:
        n = db.execute("SELECT COUNT(*) FROM roads").fetchone()[0]+1
        road = dict(id=f"RUA_{n:03d}", name=name.strip(),direction="Dupla",status="Liberada",cost=5)
        db.execute("INSERT INTO roads VALUES (:id,:name,:direction,:status,:cost)",road)
    return jsonify(road),201

@app.get("/api/routes")
def routes():
    try:
        lat, lon = float(request.args["lat"]), float(request.args["lon"])
        hospital_id = int(request.args["hospital_id"])
        if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise ValueError()
    except (KeyError, ValueError):
        return jsonify(error="Informe lat, lon e hospital_id v?lidos."),400
    with connect() as db:
        row = db.execute("SELECT data FROM hospitals WHERE id=?",(hospital_id,)).fetchone()
    if row is None:
        return jsonify(error="Hospital n?o encontrado."),404
    h = json.loads(row[0])
    url = f"https://router.project-osrm.org/route/v1/driving/{lon},{lat};{h['lon']},{h['lat']}?alternatives=true&overview=full&geometries=geojson"
    try:
        with urlopen(url, timeout=15) as response:
            data = json.load(response)
        if data.get("code") != "Ok" or not data.get("routes"):
            return jsonify(error="Nenhum trajeto dispon?vel."),502
        return jsonify(data, provider="OSRM", simulated_blocks_applied=False)
    except (URLError, TimeoutError, ValueError):
        return jsonify(error="Servi?o de rotas indispon?vel. Tente novamente."),502

init_db()
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT",5000)), debug=False)
