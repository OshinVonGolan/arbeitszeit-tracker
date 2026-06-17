# Arbeitszeit-Tracker (PWA)

Eine kleine Web-App zum Erfassen von Arbeitszeiten – läuft offline, speichert alle
Daten **lokal auf dem Gerät** (localStorage). Kein Server, kein Konto, kein Internet nötig.

## Funktionen
- **Stempeluhr**: Ein-Tap Ein-/Ausstempeln mit laufendem Timer
- **Projekte / Kunden**: jeder Eintrag wird einem Projekt zugeordnet, eigene Farben
- **Pausen**: während einer Schicht starten/beenden, werden automatisch abgezogen
- **Einträge**: nachträglich manuell anlegen, bearbeiten, löschen (Datum, Start, Ende, Pause, Notiz)
- **Übersicht**: Summen pro Woche/Monat/gesamt, je Projekt
- **CSV-Export** für Excel/Abrechnung (Semikolon-getrennt, deutsches Format)

## Auf dem Handy testen (gleiches WLAN)
Der lokale Server läuft bereits. Im Chrome am Android öffnen:

```
http://192.168.1.217:8123/
```

> Über einfaches HTTP im WLAN funktioniert die App voll als Webseite, aber der
> **Service-Worker (Offline) wird nicht aktiv** – Browser erlauben das nur über
> `https` oder `localhost`. Zum Testen reicht das; siehe unten für die „echte“ Installation.

Server bei Bedarf neu starten:
```
cd arbeitszeit-tracker
python3 -m http.server 8123
```

## Als echte App installieren (mit Offline)
Für „Installieren / Zum Startbildschirm hinzufügen“ inkl. Offline-Betrieb braucht es **HTTPS**.
Einfachste Wege:

1. **GitHub Pages** (du nutzt ohnehin GitHub): Ordnerinhalt in ein Repo pushen,
   Pages aktivieren → `https://<user>.github.io/<repo>/` → im Chrome am Handy öffnen →
   Menü ⋮ → „App installieren“.
2. **Tunnel** (lokal lassen): `cloudflared tunnel --url http://localhost:8123`
   oder `ngrok http 8123` → die `https://…`-URL am Handy öffnen.

Danach: Chrome-Menü ⋮ → **„App installieren“ / „Zum Startbildschirm“**. Die App
startet dann im Vollbild mit eigenem Icon und funktioniert offline.

## Dateien
| Datei | Zweck |
|-------|-------|
| `index.html` | App-Struktur |
| `style.css` | Styling (mobile-first, Dark Mode) |
| `app.js` | gesamte Logik & Datenhaltung |
| `manifest.webmanifest` | PWA-Metadaten (Name, Icons, Farben) |
| `sw.js` | Service-Worker (Offline-Cache) |
| `icon-*.png` | App-Icons |
| `make_icons.py` | erzeugt die Icons neu (PIL) |

## Datensicherung
Alles liegt im Browser-Speicher des Geräts. Regelmäßig per **CSV-Export** sichern.
Browserdaten löschen = Einträge weg.
