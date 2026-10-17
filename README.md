# Portfolio Bandit

Ein Prototyp: Ein Multi-Armed Bandit (Thompson Sampling) entscheidet, welche Variante
neue Besucher sehen. Der Traffic wandert zur Variante, die am besten konvertiert, und
verschiebt sich weiter, sobald neue Varianten dazukommen.

Zwei Modi, umschaltbar per `MODE`:

| Modus | Varianten | Optimiert auf |
| --- | --- | --- |
| `portfolio` (Standard) | Portfolio-Layouts aus `layouts.json` | Conversion oder Engagement |
| `paywall` | Paywalls/Interstitials aus `paywalls.json` | Umsatz, Abschlüsse oder gewichtete Einstiege |

```
npm start                 # Portfolio-Modus, http://localhost:3000
npm run start:paywall     # Paywall-Modus (= MODE=paywall npm start)
                          # Dashboard jeweils unter /?dashboard oder mit Taste "d"
npm run replay            # Alte A/B-Tests nachspielen: Gleichverteilung vs. Bandit
npm run simulate          # Simulation: wie der Bandit Traffic umverteilt
npm test
```

Keine Dependencies, nur Node ≥ 18. Eine Variante lässt sich ohne Zählung ansehen mit `/?variant=<id>`.

## Paywall-Modus

Eine Demo-Artikelseite zeigt eine von vier Paywall-Varianten. Klick auf den Button =
Einstieg in die Bestellstrecke (`checkout`), Bestellen = Abschluss (`subscribed`).

**Was der Bandit optimiert** (`REWARD=…`):

| Reward | Bedeutung |
| --- | --- |
| `revenue` (Standard) | Abschlussrate × `value` der Variante, also erwarteter Umsatz pro Impression |
| `subscribed` | Abschlüsse pro Impression |
| `checkout` | Einstiege in die Bestellstrecke, gewichtet mit der Abschlussquote *dieser* Variante. Lernt schnell, belohnt aber keine Varianten, die nur neugierig machen. Bis eine Variante eigene Daten hat, gilt die durchschnittliche Abschlussquote als Prior. |

**Kontrollgruppe:** Die Variante mit `"control": true` bekommt fest `HOLDOUT` (Standard 10 %)
des Traffics, außerhalb des Bandits. Das Dashboard zeigt für jede Variante den Uplift gegenüber
der Kontrollgruppe.

**Zuweisungswahrscheinlichkeit:** Jede Zuweisung landet mit der Wahrscheinlichkeit, mit der
sie gewählt wurde, in `data/impressions-paywall.jsonl`. Damit lassen sich Effekte später
unverzerrt schätzen (Inverse Propensity Weighting) und neue Strategien offline prüfen.

**Felder in `paywalls.json`:** `id`, `name`, `tagline`, `active`, `control`, `value`
(Umsatz pro Abschluss), `style` (`inline` oder `sheet`), `headline`, `text`, `offer`, `cta`.

### Alte A/B-Tests nachspielen

```
node scripts/replay.js meine-tests.csv --reward revenue --runs 20 --holdout 0.1
```

CSV-Spalten: `test,variant,impressions,checkouts,subscriptions[,value][,control]`.
Die beobachteten Raten jeder Variante gelten als Wahrheit. Das Script simuliert dieselbe Zahl
an Impressions einmal gleichverteilt (wie im A/B-Test) und einmal mit Bandit und zeigt die
Differenz an Abschlüssen und Umsatz. `examples/ab-tests.csv` enthält **erfundene** Beispieldaten.

Im Beispiel sieht man auch, warum die Wahl des Rewards wichtig ist: Mit `revenue` schiebt der
Bandit Traffic zum Jahresabo. Das bringt weniger Abschlüsse, aber mehr Umsatz.

## So funktioniert's

| Teil | Datei |
| --- | --- |
| Thompson Sampling, P(best), Traffic-Anteile | `lib/bandit.js` |
| Modi: Events, Rewards, Kennzahlen | `lib/modes.js` |
| Zuweisung, Kontrollgruppe, Events, Stats-API, Persistenz in `data/` | `server.js` |
| Tracking und Dashboard (beide Modi) | `public/shared.js` |
| Die vier Portfolio-Layouts | `public/app.js` |
| Paywall-Demoseite | `public/paywall.*` |
| Welche Layouts aktiv sind | `layouts.json` |

1. **Start bei 25/25/25/25.** Jedes Layout startet mit dem Prior Beta(1,1), also „keine Ahnung“.
2. **Zuweisung.** Für jeden neuen Besucher wird pro Layout ein Wert aus
   Beta(1 + Conversions, 1 + Visits − Conversions) gezogen, und das Layout mit dem höchsten
   Wert gewinnt. Unsichere Layouts streuen stark und bekommen deshalb weiter Traffic
   (Exploration), klar bessere gewinnen fast immer (Exploitation).
3. **Sticky.** Ein wiederkehrender Besucher behält sein Layout (Visitor-ID in `localStorage`).
4. **Exploration-Floor.** 5 % des Traffics werden immer gleichverteilt (`EXPLORE=0.05`).
   So bleiben Verlierer messbar, falls sich das Publikum ändert.
5. **Reward.** Standardmäßig *Conversion* (Klick auf „View case“ oder „Get in touch“).
   Mit `REWARD=engagement npm start` optimiert der Bandit stattdessen auf Engagement.

## Portfolio-Modus

### Was zählt als Engagement?

20 Sekunden sichtbare Zeit **oder** eine Interaktion mit einem Projekt (Karte wegwerfen,
Carousel wischen, Projekt öffnen). Scrolltiefe zählt bewusst nicht: Das Stack-Layout ist
eine lange Sticky-Seite und würde dadurch automatisch „gewinnen“. Die Metrik muss in
jedem Layout dasselbe bedeuten.

### Dashboard

`/?dashboard` zeigt pro Variante Visits, Conversion, Engagement, **P(best)** (wie
wahrscheinlich dieses Layout das beste ist) und den Anteil am neuen Traffic, dazu eine
Live-Vorschau. „Preview ↗“ öffnet `/?variant=<id>`. Das ist ein Preview-Modus,
der nichts zählt.

## Neues Layout hinzufügen (der „Endless Loop“)

1. Portfolio: eine Render-Funktion in `LAYOUTS` in `public/app.js` ergänzen. Paywall: nur einen
   Eintrag in `paywalls.json`.
2. Den Eintrag mit `"active": true` anlegen. Der Server liest die
   Datei bei jedem Request neu, ein Neustart ist nicht nötig.
3. Das neue Layout startet mit einem breiten Prior und bekommt sofort viel Traffic.
   Ist es schlechter, verliert es den Traffic schnell wieder. Ist es besser, übernimmt es.
4. Verlierer abschalten (`"active": false`), wenn ihr P(best) dauerhaft unter ~1 % liegt.

`npm run simulate` zeigt genau das: Nach der Hälfte der Besucher geht eine Variante
`ai-v1` live und übernimmt innerhalb weniger hundert Besucher den Großteil des Traffics.

## Bewusste Vereinfachungen / nächste Schritte

- **Bots** werden nicht gefiltert, sie verwässern die Raten.
- **Nicht-Stationarität:** Alte Daten zählen ewig. Wenn sich das Publikum ändert
  (z. B. ein Post geht viral), helfen ein Discount-Faktor oder ein gleitendes Fenster.
- **Kontext:** Mobile und Desktop teilen sich einen Bandit. Ein Bandit pro Gerätetyp
  (oder ein kontextueller Bandit) ist der naheliegende nächste Schritt.
- **Ein Reward:** Conversion und Engagement könnte man gewichtet kombinieren, aber
  ein binärer Reward hält das Beta-Modell sauber.
- **Verzögerte Abschlüsse, Aufwärmphase, Discount-Faktor, Gegenmetriken und Segmente** fehlen
  noch. Das sind die nächsten Schritte für den Paywall-Modus.
- **Persistenz** ist eine JSON-Datei und reicht für einen einzelnen Server. Für Serverless
  braucht es KV/Redis.
- **Kleine Fallzahlen:** Bei 2–5 % Conversion und ~1.200 Visits pro Layout gibt es nur
  ~25–60 Conversions pro Arm. Thompson Sampling kommt damit gut klar, aber „Top“ ist erst
  verlässlich, wenn P(best) deutlich über 90 % liegt.
