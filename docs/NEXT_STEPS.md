# Stand und nächste Schritte

Ziel: Aus dem Prototyp ein sinnvolles Werkzeug für Paywall- und Abo-Optimierung in Wally
(unserem CMS für Paywalls und Interstitials) machen. Heute laufen dort klassische A/B-Tests,
gemessen werden Aboabschlüsse oder Einstiege in die Bestellstrecke.

## Was steht

- Entscheidungsgrundlage mit Simulationen: `docs/ENTSCHEIDUNGSGRUNDLAGE.md`, Scripts in `analysis/`
- Thompson-Sampling-Bandit mit Exploration-Floor (`lib/bandit.js`)
- Paywall-Modus (`MODE=paywall`): Rewards `revenue`, `subscribed`, `checkout` (gewichtet mit
  Abschlussquote je Variante), feste Kontrollgruppe, Zuweisungswahrscheinlichkeit im Log
- `scripts/replay.js`: alte A/B-Tests aus CSV nachspielen, Gleichverteilung vs. Bandit

## Schritt 2: Leitplanken (noch offen)

- Verzögerte Abschlüsse: Zuordnungsfenster (z. B. 7 Tage), nur reife Daten zählen
- Aufwärmphase und Prior aus früheren Kampagnen
- Discount-Faktor bzw. gleitendes Fenster
- Gegenmetriken (Absprungrate, Wiederkehr) mit automatischer Bremse
- Regeln für Gewinner (P(best) > 95 % + Mindestzahl) und Abschalten (< 1 %), Not-Aus

## Schritt 3: Kontext (noch offen)

- Bandit pro Segment (neu, Stammleser, registriert) und Ressort, hierarchischer Prior
- Später: Score für Kaufbereitschaft als Kontext, Uplift pro Segment

## Weitere Testmethoden, die wir uns ansehen wollen

- Top-Two Thompson Sampling (Gewinner sicher bestimmen)
- Kontextuelle Bandits (z. B. LinUCB, logistisches Thompson Sampling)
- Off-Policy-Evaluation auf den geloggten Zuweisungen
- Faktorielle Tests bzw. faktorisierte Bandits (Bausteine statt ganzer Varianten)
- Sequenzielle A/B-Tests (früh stoppen ohne falsche Gewinner) und CUPED (Varianzreduktion)
- Uplift-Modelle (wem eine Paywall wirklich zusätzliche Abos bringt)
- Optimierung von Zeitpunkt/Häufigkeit (nach wie vielen Artikeln, wie oft pro Woche)

## Offene Fragen zu Wally

1. Gibt es dort schon A/B-Tests eingebaut, oder läuft das über ein externes Tool?
2. Wo fällt die Entscheidung, welche Paywall jemand sieht: Server, Edge oder Browser?
3. Wie kommen Abschlüsse aus dem Bestellsystem zurück, und lassen sie sich einer Impression zuordnen?
4. Was soll zuerst getestet werden: Text/Gestaltung, Zeitpunkt oder Angebote?

## Mitbringen

- CSV-Export abgeschlossener A/B-Tests für `scripts/replay.js`
  (`test,variant,impressions,checkouts,subscriptions[,value][,control]`, gerne gerundet/anonymisiert)
