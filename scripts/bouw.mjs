// Bouwt kleine bestanden met openbare laadpalen en hun ad-hoc prijs, per tegel van 0,1 x 0,1 graad.
// Bron: NDW DOT-NL (open data, AFIR). Draait in GitHub Actions; de EcoBuddy-app haalt alleen de tegels rond je postcode op.
// Gebruik: node scripts/bouw.mjs <uitmap>   (optioneel GEO_BESTAND en TARIEF_BESTAND voor lokale tests)
import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const GEO = 'https://opendata.ndw.nu/charging_point_locations.geojson.gz';
const TAR = 'https://opendata.ndw.nu/charging_point_tariffs_ocpi.json.gz';
const uit = process.argv[2] || 'uit';
const BTW = 21;

async function lees(url, lokaal) {
  let buf;
  if (lokaal) buf = readFileSync(lokaal);
  else {
    const r = await fetch(url, { headers: { 'User-Agent': 'EcoBuddy-data (bemmm.nl)' } });
    if (!r.ok) throw new Error(`${url} gaf ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
  }
  const tekst = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return JSON.parse(tekst);
}

const getal = (x) => (typeof x === 'string' ? Number(x.replace(',', '.')) : Number(x));
const rond = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;

// Eén OCPI-tarief samenvatten tot: e = per kWh, u = per uur laden, f = starttarief, p = per uur parkeren (alles met btw)
// r = 1 als de prijs afhangt van tijd/dag/duur (dan tonen we "vanaf"), b = 1 als de btw expliciet in de data stond.
function samenvatting(t) {
  const elementen = Array.isArray(t.elements) ? t.elements : [];
  if (!elementen.length) return null;
  const vrij = elementen.filter((el) => !el.restrictions || !Object.keys(el.restrictions).length);
  const kies = vrij.length ? vrij : elementen;
  const s = { r: elementen.length > vrij.length ? 1 : 0 };
  for (const el of kies) {
    for (const c of el.price_components ?? []) {
      const veld = { ENERGY: 'e', TIME: 'u', FLAT: 'f', PARKING_TIME: 'p' }[c.type];
      if (!veld || s[veld] !== undefined) continue;
      const prijs = getal(c.price);
      if (!Number.isFinite(prijs)) continue;
      const btw = c.vat !== undefined && c.vat !== null && Number.isFinite(getal(c.vat)) ? getal(c.vat) : null;
      if (btw !== null) s.b = 1;
      s[veld] = rond(prijs * (1 + (btw ?? BTW) / 100));
    }
  }
  if (s.e === undefined && s.u === undefined && s.f === undefined) return null;
  if (t.currency && t.currency !== 'EUR') s.v = t.currency;
  return s;
}

const geo = await lees(GEO, process.env.GEO_BESTAND);
const ruw = await lees(TAR, process.env.TARIEF_BESTAND);
const tarieven = Array.isArray(ruw) ? ruw : ruw.data ?? ruw.tariffs ?? ruw.items ?? [];
console.log('Tarievenbestand:', Array.isArray(ruw) ? 'lijst' : `object met ${Object.keys(ruw).join(', ')}`, `(${tarieven.length} tarieven)`);
if (tarieven[0]) console.log('Voorbeeld tarief:', JSON.stringify(tarieven[0]).slice(0, 800));

const perId = new Map(); // "PARTIJ|id" -> samenvatting, en "id" -> samenvatting als terugval
let adHoc = 0;
for (const t of tarieven) {
  const s = samenvatting(t);
  if (!s) continue;
  const voorkeur = t.type === 'AD_HOC_PAYMENT';
  if (voorkeur) adHoc++;
  for (const k of [`${t.party_id}|${t.id}`, `|${t.id}`]) {
    if (!perId.has(k) || voorkeur) perId.set(k, s);
  }
}
console.log(`Bruikbare tarieven: ${perId.size / 2 | 0}, waarvan ad hoc: ${adHoc}`);

const features = geo.features ?? [];
if (features[0]) console.log('Voorbeeld laadpaal:', JSON.stringify(features[0]).slice(0, 800));
const tegels = new Map();
let palen = 0, metPrijs = 0;
for (const f of features) {
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  const p = f.properties ?? {};
  const k = (p.availabilities ?? []).map((a) => {
    let tarief = null;
    for (const id of a.tariff_ids ?? []) {
      tarief = perId.get(`${p.cpo_id}|${id}`) ?? perId.get(`|${id}`) ?? null;
      if (tarief) break;
    }
    palen += a.total ?? 0;
    if (tarief) metPrijs += a.total ?? 0;
    return {
      t: String(a.power_type ?? '').startsWith('DC') ? 'DC' : 'AC',
      kw: Math.round((getal(a.power_max) || 0) / 1000),
      s: a.connector_type ?? '',
      n: a.total ?? 0,
      v: a.available ?? 0,
      ...(tarief ? { $: tarief } : {}),
    };
  });
  if (!k.length) continue;
  const sleutel = `${Math.floor(lat * 10)}_${Math.floor(lon * 10)}`;
  if (!tegels.has(sleutel)) tegels.set(sleutel, []);
  tegels.get(sleutel).push({
    id: f.id,
    o: p.operator_name ?? p.owner_name ?? p.cpo_id ?? '',
    a: p.address ?? '',
    c: [rond(lon, 5), rond(lat, 5)],
    k,
  });
}

mkdirSync(`${uit}/tegels`, { recursive: true });
for (const [s, lijst] of tegels) writeFileSync(`${uit}/tegels/${s}.json`, JSON.stringify(lijst));
const meta = {
  gebouwd: new Date().toISOString(),
  locaties: features.length,
  tegels: tegels.size,
  laadpunten: palen,
  laadpuntenMetPrijs: metPrijs,
  bron: 'NDW DOT-NL (opendata.ndw.nu), ad-hoc prijzen volgens AFIR',
};
writeFileSync(`${uit}/meta.json`, JSON.stringify(meta, null, 2));
console.log(meta);
