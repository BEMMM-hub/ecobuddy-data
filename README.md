# EcoBuddy data

Openbare laadpalen in Nederland met hun ad-hoc prijs, voor de EcoBuddy-app.

- Bron: NDW DOT-NL open data (AFIR). Laadpuntdata: NDW / DOT-NL.
- Elke 4 uur bouwt GitHub Actions kleine bestanden per tegel van 0,1 x 0,1 graad op de tak `data`:
  `https://raw.githubusercontent.com/BEMMM-hub/ecobuddy-data/data/tegels/<lat*10>_<lon*10>.json`
- Prijzen zijn de ad-hoc prijs (betalen zonder abonnement), met btw. Niet de prijs via een laadpas.
- Handmatig starten: tab Actions > Laadpalen bijwerken > Run workflow.
