"""Read the public Kwara dropdowns used by INEC's polling-unit locator."""
import concurrent.futures, datetime, json, urllib.parse, urllib.request, time
from pathlib import Path

BASE = 'https://cvr.inecnigeria.org/PublicApi/'
OUT = Path(__file__).parent / 'data' / 'inec-kwara-polling-units.json'

def options(kind, field, value):
    url = BASE + kind + '/1/Search?' + urllib.parse.urlencode({'data[Search][' + field + ']': str(value)})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = json.load(response)
            entries = data if isinstance(data, list) else [data]
            return [(k, v) for obj in entries for k, v in obj.items() if k not in ('0', '', 'selected')]
        except Exception:
            if attempt == 2: raise
            time.sleep(1)

def split(label):
    code, name = label.split(' - ', 1)
    return code.strip(), name.strip()

lgas = options('lgas', 'state_id', 24)
def wards_for(lga):
    ident, label = lga
    code, name = split(label)
    return [(wid, code, name, *split(wlabel)) for wid, wlabel in options('wards', 'local_government_id', ident)]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    wards = [w for group in pool.map(wards_for, lgas) for w in group]
print(json.dumps({'lgas': len(lgas), 'wards': len(wards)}), flush=True)

def units_for(ward):
    ident, lcode, lname, wcode, wname = ward
    return [{'lga_code': lcode, 'lga': lname, 'ward_code': wcode, 'ward': wname,
             'unit_code': split(label)[0], 'name': split(label)[1], 'id': uid}
            for uid, label in options('pus', 'registration_area_id', ident)]
records = []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for group in pool.map(units_for, wards):
        records.extend(group)
        if len(records) // 1000 != (len(records) - len(group)) // 1000:
            print(json.dumps({'units': len(records)}), flush=True)
if len(lgas) != 16 or len(wards) != 193 or len(records) < 2887:
    raise ValueError('Incomplete Kwara directory; no reference file written')
OUT.write_text(json.dumps({'source': 'https://cvr.inecnigeria.org/pu',
  'retrieved_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'lgas': len(lgas), 'wards': len(wards), 'units': len(records), 'records': records}, ensure_ascii=False), encoding='utf8')
print(json.dumps({'saved': str(OUT), 'units': len(records)}), flush=True)
