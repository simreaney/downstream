/** The landing page in German. See `types.ts`. */

import type { LandingMessages } from "./types";

export const de: LandingMessages = {
  "meta.title": "Downstream – ein Spiel über diffuse Gewässerbelastung",
  "meta.description":
    "Erkunde ein prozedural erzeugtes Flusseinzugsgebiet und bring es mit Totholzdämmen, Teichen und Ufergehölzen wieder in Ordnung – geleitet von SCIMAP, einem Risikomodell für diffuse Gewässerbelastung, das live in deinem Browser läuft.",

  "hero.tagline": "Ein Spiel über diffuse Gewässerbelastung",
  "hero.pitch":
    "Erkunde ein prozedural erzeugtes Flusseinzugsgebiet und bring es wieder in Ordnung: Pflanze Ufergehölze, grab Teiche und bau durchlässige Holzdämme. Die Risikokarte, mit der du arbeitest, ist keine Dekoration. Es ist SCIMAP, ein echtes Modell für diffuse Gewässerbelastung, das nach jedem Bauen auf dem Gelände neu rechnet.",
  "hero.play": "Im Browser spielen",
  "hero.trailer": "Trailer ansehen",
  "hero.note":
    'Kostenlos, im Browser, ohne Installation. Läuft mit Tastatur und Maus oder jedem Gamecontroller und <a href="#vr">in VR auf einer Meta Quest</a>.',

  "trailer.eyebrow": "Trailer",
  "trailer.title": "So sieht es aus",
  "trailer.label": "Gameplay-Trailer von Downstream",
  "trailer.download": "Trailer herunterladen (MP4)",
  "trailer.caption":
    "Ein Weg hinunter zu einem Nebenbach: die Risikokarte, ein Totholzdamm, ein Ufergehölzstreifen und ein Teich im Nebenschluss, danach ein Bemessungsregen mit 30 Tagen Wiederkehrzeit über einem halb sanierten Einzugsgebiet. Aufgenommen in der Browserversion, ohne Ton.",

  "how.eyebrow": "So wird gespielt",
  "how.title": "Lies das Gelände, dann verändere es",
  "how.intro":
    "Jedes Einzugsgebiet entsteht aus einem Seed: Kämme, Täler, ein Gewässernetz, Felder, Wälder, ein Dorf und flussabwärts ein Fischgewässer. Es verliert Boden an seinen Fluss, und du hast drei Werkzeuge, um das zu ändern.",

  "how.map.caption": "Die Ebene Eintragsrisiko der SCIMAP-Karte",
  "how.map.alt":
    "Das Dorf und seine Bäche unter der Ebene Eintragsrisiko: violett, wo das Risiko niedrig ist, leuchtend gelb und orange, wo erodierbarer Boden an das Wasser angebunden ist.",
  "how.map.step": "1 · Die Karte",
  "how.map.title": "Finde heraus, woher das Sediment kommt",
  "how.map.body":
    'Drück <kbd data-key="KeyM">M</kbd> für die Risikokarte. Heller Boden ist erodierbar <em>und</em> an ein Gewässer angebunden – dort gelangt Sediment in den Fluss. Schalte durch Eintragsrisiko, Konnektivität, Erosion und Risiko im Gewässer, um zu sehen, warum.',

  "how.build.caption": "Ein Totholzdamm wird an einem Quellbach ausgerichtet",
  "how.build.alt":
    "Die Spielfigur steht in einem kleinen Bach und richtet einen Totholzdamm aus. Die Anzeige darüber sagt, wie viel Fläche über diese Stelle entwässert.",
  "how.build.step": "2 · Bauen",
  "how.build.title": "Jede Maßnahme dorthin, wo sie zählt",
  "how.build.body":
    "Totholzdämme gehören in kleine Quellbäche, Teiche in Senken abseits des Gerinnes und Bäume auf den hellen Boden am Wasser. Bevor du baust, zeigt dir die Anzeige, wie viel Fläche über diese Stelle entwässert. Lautet die Antwort „fast nichts“, sagt sie das auch.",
  "how.build.body2": "Sammle unterwegs Holz und Stein, und finde den Spaten, bevor du graben kannst.",

  "how.respond.caption": "Ein Ufergehölzstreifen wird am Bach gepflanzt",
  "how.respond.alt": "Junge Bäume am Ufer eines Bachs, die nächste Pflanzstelle ist hervorgehoben.",
  "how.respond.step": "3 · Sieh zu, wie es reagiert",
  "how.respond.title": "Was du oben tust, zeigt sich unten",
  "how.respond.body":
    "Jeder Baum, jeder Teich und jeder Damm rechnet das Modell neu, sodass sich die Karte und die Farbe des Flusses ändern, sobald du baust. Geschmeichelt wird dir dabei nicht: Mit den Landnutzungsgewichten des Modells macht das Bepflanzen von extensivem Weideland die Erosion etwas schlimmer. Das Spiel lässt es zu – und sagt es dir.",

  "how.test.caption": "Die Hochwasserganglinie nach einem Bemessungsregen (Wiederkehrzeit 30 Tage)",
  "how.test.alt":
    "Nach einem Starkregen: eine Abflussganglinie, die den Abfluss mit und ohne die Arbeit des Spielers vergleicht, und eine Meldung zur gesenkten Abflussspitze.",
  "how.test.step": "4 · Teste es",
  "how.test.title": "Schick einen Starkregen durch",
  "how.test.body":
    'Drück <kbd data-key="KeyR">R</kbd> für einen Bemessungsregen mit 30 Tagen Wiederkehrzeit. Die Abflussganglinie zeigt die Hochwasserspitze mit deiner Arbeit neben demselben Regen ohne sie, und Dorf und Fischgewässer reagieren auf den Unterschied. Kleinere Regenereignisse kommen auch von selbst.',

  "how.plan.caption": "Die Übersichtskarte des Einzugsgebiets",
  "how.plan.alt":
    "Die Übersichtskarte des Einzugsgebiets: ein schattiertes Relief der ganzen Landschaft mit Gewässernetz, Dorf, Fischgewässer und Markierungen für Ressourcen.",
  "how.plan.step": "5 · Planen",
  "how.plan.title": "Das ganze Einzugsgebiet im Blick",
  "how.plan.body":
    "<kbd>Tab</kbd> öffnet die Übersicht: das Gewässernetz von den Kämmen bis zum Auslass, Dorf und Fischgewässer und wo du Holz, Stein und den Spaten findest. Auch die Risikoebenen sind hier zu sehen.",

  "science.eyebrow": "Das Modell",
  "science.title": "Eine echte Risikokarte, keine Dekoration",
  "science.intro":
    "SCIMAP zeigt, woher diffuse Belastungen wahrscheinlich stammen, indem es zwei Dinge verbindet: wie erodierbar der Boden ist und wie gut jeder Punkt bei nassem Boden an den Fluss angebunden ist. Downstream berechnet es live, in einem Web Worker, auf dem Gelände, über das du gerade läufst.",
  "science.faithful.title": "Treu, wo es festgelegt ist",
  "science.faithful.body":
    "Feuchteindex, Network Index, FD8-Abflussrouting und Perzentil-Streckung sind aus der Referenzimplementierung übernommen, die Formeln wörtlich.",
  "science.honest.title": "Offen, wo es abweicht",
  "science.honest.body":
    "Es gibt drei bewusste Änderungen: einen Network Index in einem einzigen Durchlauf, ein entlang des Fließwegs aufsummiertes Risiko im Gewässer und Streckungsgrenzen, die zu Beginn eingefroren werden, damit eine Verbesserung auch als Verbesserung sichtbar wird. Jede ist im Code begründet.",
  "science.save.title": "Ein Spielstand ist ein Link",
  "science.save.body":
    'Die Erzeugung ist exakt reproduzierbar, also ist ein Spielstand nur ein Seed und eine Liste dessen, was du gebaut hast – ein paar hundert Byte. Drück <kbd data-key="KeyK">K</kbd>, um einen Link zu kopieren, der dein Einzugsgebiet für alle nachbaut.',
  "science.more":
    'Die Überlegungen dahinter und die Fehler, die plausibel aussahen und trotzdem falsch waren, stehen (auf Englisch) in <a href="https://github.com/simreaney/downstream/blob/main/DESIGN.md">DESIGN.md</a>. Mehr über SCIMAP selbst steht auf der <a href="https://simreaney.github.io/portfolio/scimap/">SCIMAP-Projektseite</a>.',

  "controls.eyebrow": "Steuerung",
  "controls.title": "Tastatur oder Gamepad",
  "controls.keys": "Tasten",
  "controls.gamepad": "Gamepad",
  "controls.does": "Funktion",
  "controls.walk.pad": "Linker Stick",
  "controls.walk": "Gehen (<kbd>Umschalt</kbd> zum Rennen); ziehen oder rechter Stick zum Umsehen",
  "controls.tools.pad": "Steuerkreuz",
  "controls.tools": "Pflanzen, Totholzdamm, Teich",
  "controls.build": "Dort bauen, wohin du schaust",
  "controls.gather": "Holz, Stein oder den Spaten sammeln",
  "controls.overlay": "Nächste Risikoebene / Ebene aus",
  "controls.map": "Übersichtskarte des Einzugsgebiets",
  "controls.storm": "Bemessungsregen auslösen (Wiederkehrzeit 30 Tage)",
  "controls.undo.pad": "Steuerkreuz links",
  "controls.undo": "Letzte Maßnahme rückgängig machen",
  "controls.save": "Speichern und einen Link zum Teilen kopieren",
  "controls.anyController.title": "Jeder Controller geht",
  "controls.anyController.body":
    "Bluetooth oder USB, Xbox oder PlayStation: Der Browser bildet sie alle auf dasselbe Layout ab. Verbinde ihn und drück einmal eine Taste, um ihn zu wecken.",
  "controls.teaching.title": "Für den Unterricht",
  "controls.teaching.body":
    "Derselbe Seed baut immer dasselbe Einzugsgebiet, also kann eine ganze Klasse an einer Landschaft arbeiten. Häng <code>?seed=132</code> an den Spiellink, <code>?size=small</code> oder <code>large</code> für die Größe und <code>?lang=en</code>, <code>es</code>, <code>de</code> oder <code>fr</code> für die Sprache.",
  "controls.teaching.link": '<a href="play/?seed=132">Einzugsgebiet 132 öffnen</a> – das aus dem Trailer.',
  "controls.runsOn.title": "Worauf es läuft",
  "controls.runsOn.body":
    'Jeder aktuelle Desktop-Browser mit WebGL. Gedacht ist es für Laptop oder Desktop: Auf dem Handy kannst du dich umsehen, zum Gehen brauchst du aber einen Controller. Auf einer Meta Quest läuft es <a href="#vr">in VR</a>.',

  "vr.eyebrow": "In VR",
  "vr.title": "Das Einzugsgebiet auf dem Tisch",
  "vr.intro":
    "Auf einer Meta Quest wird Downstream zu dem Diorama, nach dem es aussieht. Öffne das Spiel im Browser des Headsets und drück <strong>VR starten</strong>: Das Einzugsgebiet schrumpft auf einen Tisch vor dir, deine Figur steht darauf, und du siehst dich um, indem du den Kopf bewegst.",

  "vr.table.caption": "Am Tisch, der Zeiger auf dem Panel",
  "vr.table.alt":
    "In einem VR-Headset: Die Spielfigur steht auf einer Tischlandschaft neben einem Bach und einem Baum, mit einer Anzeige über dem Kopf. Ein Panel am linken Tischrand zeigt Holz, Stein, die Werkzeuge und den Zustand des Einzugsgebiets, und ein Strahl vom Controller zeigt auf dessen Starkregen-Knopf.",
  "vr.table.step": "Am Tisch",
  "vr.table.title": "Blick hinab auf dein eigenes Einzugsgebiet",
  "vr.table.body":
    "Deine Figur ist etwa so groß wie eine Schachfigur. Wenn sie geht, gleitet die Landschaft unter dir mit, und sie dreht sich in Schritten statt herumzuschwenken, damit der Horizont gerade bleibt. Die Anzeige schwebt über ihrem Kopf und sagt dir vor dem Bauen, was über eine Stelle entwässert.",
  "vr.table.body2": "Alles andere ist auf dem Panel am Tischrand: Zeig mit dem rechten Controller darauf und drück den Trigger.",

  "vr.board.caption": "Das ganze Einzugsgebiet als Tischmodell",
  "vr.board.alt":
    "Herausgezoomt in VR: das ganze Einzugsgebiet als Modell auf einem Holzsockel, darüber die Karte des Eintragsrisikos; das Gewässernetz läuft vorn an der Kerbe des Auslasses zusammen. Das Panel daneben zeigt die Legende der Risikokarte.",
  "vr.board.step": "Herausgezoomt",
  "vr.board.title": "Das ganze Modell in Reichweite",
  "vr.board.body":
    "Drück den rechten Stick, und das Einzugsgebiet liegt als etwa 1,4 m breites Modell auf eigenem Sockel auf dem Tisch, mit der Risikokarte darüber. Beug dich vor, um einem Bach vom Kamm bis zum Auslass zu folgen, oder geh in die Hocke, um das Talprofil an der Seite des Modells zu sehen.",

  "vr.controllers": "Touch-Controller",
  "vr.walk.pad": "Linker Stick",
  "vr.walk": "Gehen (linker Trigger zum Rennen)",
  "vr.turn.pad": "Rechter Stick",
  "vr.turn": "Links und rechts drehen den Tisch; hoch und runter zoomen",
  "vr.zoom.pad": "Rechten Stick drücken",
  "vr.zoom": "Zwischen nah, mittel und dem ganzen Einzugsgebiet wechseln",
  "vr.build.pad": "A oder rechter Trigger",
  "vr.grips.pad": "Griffe",
  "vr.grips": "Vorheriges und nächstes Werkzeug",
  "vr.panel.pad": "Aufs Panel zeigen",
  "vr.panel": "Starkregen, rückgängig, speichern, Werkzeug oder Ebene wählen und VR beenden",
  "vr.need.title": "Was du brauchst",
  "vr.need.body":
    "Eine Meta Quest und ihren eigenen Browser: keine App, keine Installation, derselbe Link wie überall. Der Knopf <strong>VR starten</strong> erscheint nur in einem Browser, der eine VR-Sitzung starten kann, auf einem Laptop siehst du ihn also nicht. Andere Headsets mit WebXR-Unterstützung funktionieren vielleicht auch.",
  "vr.sitting.title": "Sitzend oder stehend",
  "vr.sitting.body":
    "Der Tisch richtet sich beim Start nach deiner Augenhöhe, also geht beides. Landet er an der falschen Stelle, halte die Meta-Taste am rechten Controller gedrückt, um neu zu zentrieren.",
  "vr.lighter.title": "Leichter auf dem Headset",
  "vr.lighter.body":
    "Ein Headset zeichnet jedes Bild zweimal, einmal pro Auge, und bekommt deshalb eine leichtere Szene als ein Desktop: weniger Bäume und seltener aktualisierte Schatten. Das Modell darunter ist genau dasselbe.",

  "cta.title": "Der Fluss wartet",
  "cta.body": "Keine Installation, kein Konto. Dein Einzugsgebiet entsteht in ein, zwei Sekunden.",
  "cta.play": "Downstream spielen",
  "cta.source": "Quellcode auf GitHub",

  "footer.credit":
    'Downstream ist von <a href="https://simreaney.github.io/">Sim Reaney</a>, Department of Geography, Durham University.',
  "footer.nav": "Fußzeile",
  "footer.play": "Spielen",
  "footer.design": "Designnotizen",
  "lightbox.label": "Screenshot",
  "lightbox.close": "Schließen",
};
