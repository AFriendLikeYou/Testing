# Bandit für Paywalls in Wally: Entscheidungsgrundlage

> **Wichtig:** Alle Zahlen unten beruhen auf **Annahmen**, nicht auf Wally-Daten: 50.000
> Paywall-Impressions pro Tag, 0,5 % Abschlussrate, 4 Varianten, Kampagnen über 28 Tage.
> Die Scripts sind so gebaut, dass sie mit euren Zahlen neu laufen (siehe „Reproduzieren“).
> Welche Daten fehlen, steht im Abschnitt „Was wir noch brauchen“.

## Empfehlung

**Ja, aber in zwei Rollen und erst nach einer Vorprüfung.**

1. **Bandit für laufende Kampagnen** mit mehreren Varianten und begrenzter Laufzeit. In der
   Simulation holt er 45–71 % des möglichen Zugewinns, ein klassischer A/B-Test 3–35 %.
2. **A/B-Tests bleiben für Grundsatzfragen.** Der Bandit findet den Gewinner **nicht** besser
   als ein A/B-Test, die Trefferquote ist praktisch gleich. Sein Vorteil ist, dass er schon
   *während* des Tests mehr Traffic auf gute Varianten lenkt. Er ist ein Werkzeug zum
   Geldverdienen, nicht zum Lernen.
3. **Vorher klären, ob es sich lohnt.** Der Nutzen hängt fast vollständig davon ab, wie stark
   sich eure Varianten wirklich unterscheiden. Das zeigt erst die Auswertung eures Testarchivs.
   Liegen die echten Unterschiede bei ±3 %, geht es um ~100 zusätzliche Abos pro Kampagne. Dann
   liegt der größere Hebel woanders, nämlich darin, wer die Paywall wann sieht.

## 1. Zielmetrik

**Vorschlag:** Zusätzlicher Netto-Umsatz pro 1.000 Paywall-Impressions über 90 Tage, gemessen
gegen die Kontrollgruppe:

```
Abo-Umsatz aus dem Abrechnungssystem nach 90 Tagen (nach Kündigungen)
− verlorener Werbeumsatz durch Absprünge
```

**Warum:** Abschlüsse allein belohnen billige Angebote mit hoher Kündigung. Einstiege in die
Bestellstrecke belohnen Neugier. 90 Tage erfassen die erste Kündigungswelle nach Probeabos.
Der Werbeverlust verhindert, dass aggressive Interstitials „gewinnen“.

**Im Betrieb** kann der Bandit darauf nicht 90 Tage warten. Er optimiert deshalb Abschlüsse ×
*erwarteter* 90-Tage-Wert des Angebots (aus der Historie geschätzt). Einstiege in die
Bestellstrecke dienen als frühes Signal (`REWARD=checkout`). Die Zielmetrik prüft dann im
Nachhinein, ob diese Abkürzung stimmt.

## 2. Testarchiv: Wie stark unterscheiden sich Varianten wirklich?

`analysis/archive.js` schätzt aus abgeschlossenen Tests die Streuung der *wahren*
Unterschiede (tau) und schrumpft jedes Einzelergebnis entsprechend. Der Abstand zwischen
beobachtetem und geschrumpftem Wert ist der Teil eines „Gewinns“, der wahrscheinlich Zufall war.

**Noch offen:** Mit den erfundenen Beispieldaten (4 Vergleiche) ist das Ergebnis bedeutungslos.
Belastbar wird tau ab etwa 10–20 Vergleichen aus echten Tests.

## 3. Was bei eurem Traffic überhaupt messbar ist

`analysis/power.js`, 50.000 Impressions/Tag auf 4 Varianten, 5 % Fehlerniveau, 80 % Power:

| Abschlussrate | +5 % erkennen | +10 % erkennen | +20 % erkennen |
|---|---|---|---|
| 0,5 % | 137 Tage | 35 Tage | 9 Tage |
| 1,0 % | 68 Tage | 17 Tage | 5 Tage |
| 2,0 % | 34 Tage | 9 Tage | 2 Tage |

**Folgerung:** Ein zweiwöchiger A/B-Test bei 0,5 % Abschlussrate erkennt nur Unterschiede von
grob 15 % und mehr. Kleinere Unterschiede bleiben unentdeckt. Und wenn ein solcher Test trotzdem
einen „Gewinner“ meldet, ist dessen Effekt meist überschätzt. Es lohnt sich, frühere Gewinner
daraufhin zu prüfen.

## 4. Vergleich: A/B-Test, sequenzieller A/B-Test und Bandit

`analysis/compare.js`, 200 simulierte Kampagnen pro Szenario. Die wahren Raten werden je
Kampagne neu gezogen, nicht fest gesetzt. Der A/B-Test entscheidet nach 14 Tagen und rollt den
Gewinner für die restlichen 14 Tage aus. Der Bandit läuft mit 10 % Kontrollgruppe, 5 %
Exploration und täglicher Aktualisierung.

| Szenario | | A/B-Test | Sequenzieller A/B | Bandit |
|---|---|---|---|---|
| **Kein echter Unterschied** | falscher Gewinner | 4 % | 2 % | 0 % |
| **Unterschiede ±3 %** (max. +209 Abos) | zusätzliche Abos | 7 | 14 | 95 |
| | Anteil am Möglichen | 3 % | 6 % | 45 % |
| | besten gefunden | 16 % | 16 % | 14 % |
| **Unterschiede ±10 %** (max. +699 Abos) | zusätzliche Abos | 246 | 286 | 497 |
| | Anteil am Möglichen | 35 % | 41 % | 71 % |
| | besten gefunden | 49 % | 46 % | 48 % |

Bei 10.000 Impressions/Tag (±10 %) wird der Abstand größer: A/B-Test 11 %, Bandit 51 % des
möglichen Zugewinns.

**Was das heißt:**
- **Der Bandit ist sicher.** Ohne echten Unterschied erklärt er keinen falschen Gewinner und
  wählt in keinem Szenario etwas Schlechteres als die Kontrolle.
- **Er verdient mehr, findet aber nicht besser.** Alle drei Verfahren finden den echten
  Gewinner etwa gleich oft.
- **Je weniger Traffic, desto größer sein Vorteil**, weil A/B-Tests dann kaum signifikant werden
  und bis zum Ende gleich verteilen.

**Kalibrierung:** Sagt der Bandit „P(best) = 99 %“, ist die Variante in 97 % der Fälle wirklich
die beste. Bei 89 % sind es 87 %, bei 65 % sind es 61 %. Die Wahrscheinlichkeiten sind also
brauchbar, oben leicht zu optimistisch.

**Hinweis zum Replay:** `scripts/replay.js` nimmt beobachtete Raten als Wahrheit und
**überschätzt** dadurch den Nutzen des Bandits. Für Entscheidungen gilt `analysis/compare.js`.

## 5. Liegt der größere Hebel woanders?

Das lässt sich ohne Daten nicht beantworten. Zu prüfen ist:
- **Wer und wann:** Wie stark unterscheidet sich die Abschlussrate nach Besuchshäufigkeit,
  Herkunft und Ressort? Wenn die Unterschiede zwischen Segmenten deutlich größer sind als
  zwischen Varianten (tau), bringt Steuern nach Segment mehr als die Wahl der Variante.
- **Bestellstrecke:** Wie viele brechen nach dem Einstieg ab und an welchem Schritt? Ist die
  Abschlussquote ab Einstieg niedrig, gewinnt man dort mehr als an der Paywall.

## 6. Woran wir Erfolg erkennen (vorab festgelegt)

| Prüfung | Bestanden, wenn |
|---|---|
| A/A-Test (1 Woche, 2 identische Varianten über den Bandit) | Verteilung wie geplant (Chi-Quadrat p > 0,01), kein erklärter Gewinner |
| Kalibrierung auf künstlichen Daten | P(best) innerhalb ±5 Prozentpunkte der echten Trefferquote (siehe oben: erfüllt) |
| Prognose vs. Realität | Nach dem Pilot liegt der gemessene Uplift im vorher simulierten Bereich |
| Kontrollgruppe gegen Finanzzahlen | Uplift aus dem Abrechnungssystem, nicht aus dem Tracking, nach 90 Tagen |
| Unabhängige Prüfung | Jemand aus BI/Controlling rechnet die Auswertung nach |

**Ehrliche Einschränkung:** Den Gesamteffekt gegen die 10-%-Kontrollgruppe *statistisch
nachzuweisen* dauert lange. Ein Uplift von +5 % bei 0,5 % Abschlussrate und 50.000
Impressions/Tag braucht rund 4–5 Monate. Die Kontrollgruppe muss also dauerhaft laufen, nicht
nur im Pilot.

## Kleinster sinnvoller Pilot

1. **Woche 0:** Testarchiv auswerten (`archive.js`), Zahlen in `compare.js` einsetzen.
   Entscheidung: Lohnt es sich?
2. **Woche 1:** A/A-Test über den Bandit in Wally.
3. **Wochen 2–5:** Eine Kampagne, 3 Varianten + 10 % Kontrollgruppe, Reward = Abschlüsse ×
   erwarteter Wert. Parallel läuft wie gewohnt ein A/B-Test in einer vergleichbaren Kampagne.
4. **Nach 90 Tagen:** Abgleich mit dem Abrechnungssystem.

## Was wir noch brauchen

- Export abgeschlossener Tests: `test,variant,impressions,checkouts,subscriptions,value,control`
- Paywall-Impressions pro Tag und typische Abschlussrate je Paywall-Typ
- Abschlussrate nach Segment (Besuchshäufigkeit, Herkunft, Ressort, eingeloggt)
- Abbruchquoten je Schritt der Bestellstrecke
- Kündigungsquote nach 90 Tagen je Angebot, Werbeumsatz pro Seitenaufruf
- Wo Wally entscheidet (Server/Edge/Browser) und wie Bestellungen einer Impression zugeordnet werden

## Reproduzieren

```
node analysis/archive.js eure-tests.csv                  # → tau (Streuung echter Unterschiede)
node analysis/power.js --daily <Impressions/Tag> --variants 4
node analysis/compare.js --daily <Impressions/Tag> --base <Abschlussrate> --sigma 0,<tau>
```
