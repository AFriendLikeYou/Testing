# Portfolio Bandit

Ein Prototyp: dasselbe Portfolio in mehreren Layouts, und ein Multi-Armed Bandit
(Thompson Sampling) entscheidet, welches Layout neue Besucher sehen. Der Traffic
wandert zu dem Layout, das am besten konvertiert, und verschiebt sich weiter,
sobald neue Varianten dazukommen.

```
npm start            # http://localhost:3000  (Dashboard: /?dashboard oder Taste "d")
npm run simulate     # Simulation: wie der Bandit Traffic umverteilt
npm test
```

Keine Dependencies, nur Node ≥ 18.

## So funktioniert's

| Teil | Datei |
| --- | --- |
| Thompson Sampling, P(best), Traffic-Anteile | `lib/bandit.js` |
| Zuweisung, Events, Stats-API, Persistenz in `data/state.json` | `server.js` |
| Die vier Layouts, Tracking, Dashboard | `public/app.js` |
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

### Was zählt als Engagement?

20 Sekunden sichtbare Zeit **oder** eine Interaktion mit einem Projekt (Karte wegwerfen,
Carousel wischen, Projekt öffnen). Scrolltiefe zählt bewusst nicht: Das Stack-Layout ist
eine lange Sticky-Seite und würde dadurch automatisch „gewinnen“. Die Metrik muss in
jedem Layout dasselbe bedeuten.

### Dashboard

`/?dashboard` zeigt pro Layout Visits, Conversion, Engagement, **P(best)** (wie
wahrscheinlich dieses Layout das beste ist) und den Anteil am neuen Traffic, dazu eine
Live-Vorschau. „Use this layout ↗“ öffnet `/?layout=<id>`. Das ist ein Preview-Modus,
der nichts zählt.

## Neues Layout hinzufügen (der „Endless Loop“)

1. Eine Render-Funktion in `LAYOUTS` in `public/app.js` ergänzen.
2. Einen Eintrag in `layouts.json` mit `"active": true` anlegen. Der Server liest die
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
- **Persistenz** ist eine JSON-Datei und reicht für einen einzelnen Server. Für Serverless
  braucht es KV/Redis.
- **Kleine Fallzahlen:** Bei 2–5 % Conversion und ~1.200 Visits pro Layout gibt es nur
  ~25–60 Conversions pro Arm. Thompson Sampling kommt damit gut klar, aber „Top“ ist erst
  verlässlich, wenn P(best) deutlich über 90 % liegt.
