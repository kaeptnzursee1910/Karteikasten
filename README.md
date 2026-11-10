# Karteikasten

Karteikarten-App für iPad und Browser. Du lernst mit dem Leitner-System und lässt Karten von einem **lokalen KI-Modell** oder einer **Cloud-KI wie Claude** erstellen, auch aus PDFs, Word-Dokumenten und Fotos deiner Notizen. Bilder aus den Dokumenten können dabei auf den Karten landen.

Die Karten liegen im Browser (IndexedDB). Mit einem lokalen Modell bleiben auch die Dokumente bei dir. Mit einer Cloud-KI gehen Dokumente, Bilder und Hinweise zum Erstellen an den gewählten Anbieter.

## Funktionen

- **Stapel und Karten:** anlegen, bearbeiten, löschen. Jede Seite einer Karte kann ein Bild haben, ein Foto oder einen Ausschnitt aus einem Dokument.
- **Lernen:** Karte antippen zum Umdrehen, dann mit „Nochmal“, „Schwer“, „Gut“ oder „Leicht“ bewerten. Die Karten wandern durch 6 Fächer und kommen nach 0, 1, 3, 7, 16 oder 35 Tagen wieder. Auf dem iPad geht das auch per Wischen (rechts = Gut, links = Nochmal), am Rechner mit Leertaste und den Tasten 1 bis 4.
- **Karten mit KI erstellen:** aus einem Thema, eingefügtem Text oder importierten Dokumenten (PDF, .docx, Bilder, .txt/.md/.csv).
  - **Anzahl frei wählbar** (1–200). Größere Mengen erstellt das Modell in Durchgängen zu je 20 Karten (im Browser: 10), ohne Karten zu wiederholen.
  - **Modell frei wählbar:** Im Erstellen-Fenster stehen alle auf dem Server installierten Modelle zur Auswahl. Im Browser-Modus kannst du in den Einstellungen jedes WebLLM-Modell über seine ID eintragen.
  - **Vision-Modelle** (z. B. `gemma3`, `qwen2.5vl`, `llava`) sehen die Seiten mit Abbildungen und schneiden passende Abbildungen für die Karten aus.
  - **Andere Modelle** ordnen Abbildungen anhand des Textes zu.
  - In der Vorschau kannst du jeden Ausschnitt ändern, ein Bild auf die andere Seite legen, entfernen oder eines hinzufügen.
- **Von der KI erklären lassen:** beim Lernen eine kurze Erklärung mit Eselsbrücke.
- **Sicherung:** Export und Import als JSON-Datei, auch um Karten auf ein anderes Gerät zu bringen.
- **Als App installierbar:** in Safari über „Teilen“ → „Zum Home-Bildschirm“.

## Starten

Die App ist eine statische Webseite ohne Build-Schritt. Sie muss über `http://` bzw. `https://` geöffnet werden, nicht als Datei.

### Variante A: mit Ollama auf deinem Rechner (empfohlen)

1. [Ollama](https://ollama.com) installieren und ein Modell laden:
   ```sh
   ollama pull gemma3:4b      # sieht Bilder, läuft auf den meisten Rechnern
   # oder größer/genauer: ollama pull gemma3:12b, qwen2.5vl:7b, qwen2.5:7b (nur Text)
   ```
2. Im Ordner dieses Repos starten:
   ```sh
   python3 server.py
   ```
   Unter Windows reicht ein Doppelklick auf **`Start.bat`**. Beim ersten Start in der Windows-Firewall „Private Netzwerke“ erlauben. Für den Start mit Windows eine Verknüpfung zu `Start.bat` in den Autostart-Ordner legen (Win+R → `shell:startup`).

   Der Server zeigt die Adressen an, z. B. `http://192.168.178.20:8080`.
3. Diese Adresse auf dem iPad in Safari öffnen (iPad und Rechner im selben WLAN). Unter **KI einrichten** auf „Verbinden & Modelle laden“ tippen, das Modell wählen und speichern.

`server.py` braucht nur Python 3 und leitet alle KI-Anfragen unter `/ki/` an Ollama weiter. Damit sind keine CORS-Einstellungen nötig.

Optionen:

| Option | Bedeutung |
| --- | --- |
| `--port 9000` | anderer Port (Standard 8080) |
| `--ziel http://127.0.0.1:1234` | anderer Modellserver, z. B. LM Studio. In der App dann „OpenAI-kompatibel“ wählen. |
| `--nur-lokal` | nur auf diesem Rechner erreichbar |

### Variante B: LM Studio, llama.cpp oder ein anderer OpenAI-kompatibler Server

In der App unter **KI-Modell** die Schnittstelle „OpenAI-kompatibel“ wählen und die Adresse eintragen, z. B. `http://localhost:1234/v1`. Wenn die App über `server.py --ziel …` läuft, das Adressfeld leer lassen.

### Variante C: Modell direkt im Browser (WebGPU)

Unter **KI-Modell** „Direkt im Browser“ wählen. Das Modell wird einmal heruntergeladen (1–2,2 GB) und läuft dann offline auf dem Gerät. Voraussetzung ist WebGPU: Safari ab iPadOS 26, am Rechner aktuelles Chrome oder Edge. Die kleinen Modelle sehen keine Bilder und schaffen nur kürzere Dokumente (etwa 5 Seiten Text).

### Variante D: Cloud-KI (Claude, OpenAI, Gemini, Mistral, OpenRouter)

Unter **KI-Modell** „Cloud-KI“ wählen, den Anbieter auswählen, den API-Schlüssel eintragen und auf „Verbinden & Modelle laden“ tippen. Dafür ist kein Rechner nötig, nur Internet. Das funktioniert auch über GitHub Pages.

- **Claude** läuft über das offizielle Anthropic-SDK. Voreingestellt ist `claude-opus-5-5`; alle Modelle deines Kontos stehen zur Auswahl. Claude sieht die Seiten mit Abbildungen und schneidet passende Ausschnitte aus. Einen API-Schlüssel gibt es unter console.anthropic.com. Ein claude.ai-Abo (Pro, Max) enthält keine API-Nutzung.
  - Bei Claude Opus 5.5, Opus 5, Sonnet 5.5 und Fable 5.1/5.2 ist das serverseitige Ersatzmodell bei Ablehnungen eingeschaltet (`fallbacks: "default"`): Lehnt das Modell eine Anfrage ab, beantwortet Anthropic sie automatisch mit einem passenden anderen Modell.
  - Bei mehreren Durchgängen wird der Lernstoff zwischengespeichert (Prompt-Caching). Folgedurchgänge kosten dadurch deutlich weniger.
- **OpenAI, Google Gemini, Mistral, OpenRouter** und andere Dienste mit OpenAI-kompatibler Schnittstelle laufen über diese Schnittstelle. Für einen anderen Dienst die Adresse der API selbst eintragen.

Der API-Schlüssel wird nur im Browser des Geräts gespeichert und direkt an den Anbieter geschickt. Gib die App mit eingetragenem Schlüssel nicht an andere weiter. Lege beim Anbieter am besten ein Ausgabenlimit fest. Nicht jeder Dienst erlaubt Anfragen direkt aus dem Browser; dann erscheint ein Verbindungsfehler.

### Ohne `server.py` direkt mit Ollama

Ollama muss Anfragen von der Seite erlauben, und für den Zugriff vom iPad im Netzwerk erreichbar sein:

```sh
OLLAMA_ORIGINS="*" OLLAMA_HOST=0.0.0.0 ollama serve
```

In der App als Adresse `http://<IP-des-Rechners>:11434` eintragen.

**Wichtig:** Wenn die App über `https://` läuft (z. B. GitHub Pages), blockiert der Browser Verbindungen zu `http://`-Adressen im Netzwerk. Am Rechner selbst geht `http://localhost:11434`. Auf dem iPad nimm dann `server.py` (Variante A) oder das Modell im Browser (Variante C).

### Über GitHub Pages veröffentlichen

Im Repo unter *Settings → Pages* „Deploy from a branch“ mit `main` und `/ (root)` wählen. Die App ist dann unter `https://<name>.github.io/Karteikasten/` erreichbar. Am besten passt das zum Modell im Browser oder zu Ollama auf demselben Rechner.

## Aufbau

```
index.html            Einstieg
css/app.css           Gestaltung (hell/dunkel nach Systemeinstellung)
js/app.js             Oberfläche: Stapel, Lernen, Karten-Editor, KI-Erstellung
js/ai.js              Anbindung der Modelle (Ollama, OpenAI-kompatibel, WebLLM, Claude, Cloud-Dienste)
js/docs.js            Import von PDF, Word, Bildern und Text
js/store.js           Speicher im Browser (IndexedDB)
sw.js                 Offline-Cache (nur über https oder localhost)
server.py             Bereitstellung im Heimnetz und Proxy zum Modellserver
Start.bat             Start per Doppelklick unter Windows
vendor/               pdf.js 3.11.174, mammoth 1.6.0 und das Anthropic-SDK 1.3.0 als Browser-Bundle (mit Lizenzen)
```

WebLLM (0.2.86) wird bei Bedarf von jsDelivr geladen.

## Hinweise

- Die Daten liegen im Browser des jeweiligen Geräts. Safari kann Website-Daten nach längerer Nichtnutzung löschen; als Home-Bildschirm-App ist das weniger wahrscheinlich. Mach ab und zu eine Sicherung über „⋯“ → „Sicherung exportieren“.
- Importierte Dokumente bleiben nur geladen, solange die Seite offen ist. Die Bilder auf den Karten werden dauerhaft gespeichert.
- Für lange Dokumente in Ollama die Kontextlänge in den KI-Einstellungen erhöhen (braucht mehr Arbeitsspeicher). Ist ein Dokument zu lang, wird es gekürzt und die App sagt Bescheid.
