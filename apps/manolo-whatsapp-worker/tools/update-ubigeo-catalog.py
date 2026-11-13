"""Refresh public INEI SISCONCODE data. Requires requests and beautifulsoup4.
Run from any directory with Python3. TLS validation remains enabled.
"""
from pathlib import Path
import hashlib
import json
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
URL = "https://webapp.inei.gob.pe:8443/sisconcode/ubigeo/listaBusquedaUbigeoPorUbicacionGeografica.htm"
PARAMS = dict(versionCategoriaPK="9-1", nivel="1", strVersion="2026", strDpto="TODOS", strProv="TODOS", strDist="TODOS", flagDpto="", flagProv="", flagDist="")
response = requests.get(URL, params=PARAMS, timeout=30)
response.raise_for_status()
response.encoding = "ISO-8859-1"
soup = BeautifulSoup(response.text, "html.parser")
for hidden in soup.select("div[style]"):
    if "display:none" in hidden.get("style", "").replace(" ", ""):
        hidden.decompose()
table = max(soup.find_all("tbody"), key=lambda t: len(t.find_all("tr", recursive=False)))
data = []
for row in table.find_all("tr", recursive=False):
    cells = [cell.get_text(" ", strip=True) for cell in row.find_all("td", recursive=False)]
    if len(cells) < 4 or not cells[3]:
        continue
    code, district = cells[3].split(" ", 1)
    if len(code) != 6 or not code.isdigit():
        continue
    depcode, department = cells[1].split(" ", 1)
    provcode, province = cells[2].split(" ", 1)
    if not code.startswith(provcode) or not provcode.startswith(depcode):
        raise ValueError("Invalid geographic hierarchy")
    data.append([code, department, province, district])
if len(data) < 1800 or len(data) > 2500 or len(set(row[0] for row in data)) != len(data):
    raise ValueError("Incomplete or duplicate district catalog")
content = "// INEI SISCONCODE, version 2026 (9-1), retrieved 2026-11-06. See docs/operations/manolo-gre-locations-2026-11-06.md.\nexport const UBIGEO_CATALOG: readonly (readonly [string, string, string, string])[] = " + json.dumps(sorted(data), ensure_ascii=False, separators=(",", ":")) + ";\n"
target = ROOT / "src/geography/ubigeo-catalog.ts"
target.write_text(content, encoding="utf-8")
print(json.dumps(dict(districts=len(data), source=URL, sha256=hashlib.sha256(target.read_bytes()).hexdigest())))
