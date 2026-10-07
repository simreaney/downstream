/**
 * The landing page in French. See `types.ts`.
 *
 * ` ` is a non-breaking space, which French typography puts before a
 * colon or semicolon and inside « », so neither mark is ever left alone at the
 * start of a line.
 */

import type { LandingMessages } from "./types";

export const fr: LandingMessages = {
  "meta.title": "Downstream — un jeu sur la pollution diffuse",
  "meta.description":
    "Parcourez un bassin versant généré procéduralement et restaurez-le avec des barrages filtrants, des mares et des arbres de berge, guidé par SCIMAP, un modèle de risque de pollution diffuse qui tourne en direct dans votre navigateur.",

  "hero.tagline": "Un jeu sur la pollution diffuse",
  "hero.pitch":
    "Parcourez un bassin versant généré procéduralement et restaurez-le\u00a0: plantez des arbres en bord de rivière, creusez des mares et construisez des barrages filtrants en bois. La carte des risques sur laquelle vous travaillez n’a rien de décoratif. C’est SCIMAP, un vrai modèle de pollution diffuse, recalculé sur le terrain à chaque construction.",
  "hero.play": "Jouer dans le navigateur",
  "hero.trailer": "Voir la bande-annonce",
  "hero.note":
    'Gratuit, dans le navigateur, sans rien installer. Fonctionne avec un clavier et une souris ou n’importe quelle manette, et <a href="#vr">en VR sur Meta Quest</a>.',

  "trailer.eyebrow": "Bande-annonce",
  "trailer.title": "Le jeu en mouvement",
  "trailer.label": "Bande-annonce de Downstream",
  "trailer.download": "Télécharger la bande-annonce (MP4)",
  "trailer.caption":
    "Une descente vers un affluent\u00a0: la carte des risques, un barrage filtrant, une bande boisée en bord de cours d’eau et une mare en dérivation, puis une pluie de projet de période de retour 30 jours sur un bassin versant en cours de restauration. Enregistré dans la version navigateur, sans son.",

  "how.eyebrow": "Comment on joue",
  "how.title": "Lisez le terrain, puis changez-le",
  "how.intro":
    "Chaque bassin versant est généré à partir d’une graine\u00a0: crêtes, vallées, réseau hydrographique, champs, bois, un village et, en aval, une zone de pêche. Il perd sa terre dans sa rivière, et vous avez trois outils pour y remédier.",

  "how.map.caption": "La couche «\u00a0risque à la source\u00a0» de la carte SCIMAP",
  "how.map.alt":
    "Le village et ses ruisseaux sous la couche de risque à la source\u00a0: violet là où le risque est faible, jaune et orange vifs là où un sol érodable est relié à l’eau.",
  "how.map.step": "1 · La carte",
  "how.map.title": "Trouvez d’où viennent les sédiments",
  "how.map.body":
    'Appuyez sur <kbd data-key="KeyM">M</kbd> pour la carte des risques. Les sols clairs sont à la fois érodables <em>et</em> reliés à un cours d’eau\u00a0: c’est là que les sédiments rejoignent la rivière. Passez du risque à la source à la connectivité, à l’érosion puis au risque dans le cours d’eau pour comprendre pourquoi.',

  "how.build.caption": "Mise en place d’un barrage filtrant sur un ruisseau de tête de bassin",
  "how.build.alt":
    "Le joueur, debout dans un petit ruisseau, aligne un barrage filtrant. L’indicateur au-dessus donne la surface qui s’écoule par cet endroit.",
  "how.build.step": "2 · Construire",
  "how.build.title": "Chaque solution là où elle compte",
  "how.build.body":
    "Les barrages filtrants vont dans les petits ruisseaux de tête de bassin, les mares dans les creux à l’écart du lit, et les arbres sur les sols clairs au bord de l’eau. Avant de vous engager, l’indicateur vous dit quelle surface s’écoule par cet endroit. Si la réponse est «\u00a0presque rien\u00a0», il le dit.",
  "how.build.body2": "Ramassez du bois et de la pierre en chemin, et trouvez la bêche avant de pouvoir creuser.",

  "how.respond.caption": "Plantation d’une bande boisée au bord du ruisseau",
  "how.respond.alt":
    "De jeunes arbres plantés sur la berge d’un ruisseau, avec le prochain emplacement de plantation en surbrillance.",
  "how.respond.step": "3 · Observez la réaction",
  "how.respond.title": "Le travail en amont se voit en aval",
  "how.respond.body":
    "Chaque arbre, mare et barrage relance le modèle\u00a0: la carte et la couleur de la rivière changent dès que vous construisez. Et il ne vous flatte pas\u00a0: avec les coefficients d’occupation du sol du modèle, planter des arbres sur des pâturages extensifs aggrave légèrement l’érosion. Le jeu vous laisse faire, et vous le dit.",

  "how.test.caption": "L’hydrogramme de crue après une pluie de projet (période de retour 30 jours)",
  "how.test.alt":
    "Après un orage\u00a0: un hydrogramme qui compare le débit de la rivière avec et sans le travail du joueur, et un message indiquant la baisse du débit de pointe.",
  "how.test.step": "4 · Testez",
  "how.test.title": "Déclenchez un orage",
  "how.test.body":
    'Appuyez sur <kbd data-key="KeyR">R</kbd> pour lancer une pluie de projet de période de retour 30 jours. L’hydrogramme compare la pointe de crue avec vos travaux à celle du même orage sans eux, et le village et la zone de pêche réagissent à la différence. Des orages plus petits arrivent aussi d’eux-mêmes.',

  "how.plan.caption": "La carte d’ensemble du bassin versant",
  "how.plan.alt":
    "La carte d’ensemble du bassin versant\u00a0: un relief ombré de tout le paysage avec le réseau de ruisseaux, le village, la zone de pêche et les marqueurs de ressources.",
  "how.plan.step": "5 · Planifiez",
  "how.plan.title": "Voyez tout le bassin versant",
  "how.plan.body":
    "<kbd>Tab</kbd> ouvre la vue d’ensemble\u00a0: le réseau de drainage des crêtes jusqu’à l’exutoire, le village et la zone de pêche, et où trouver du bois, de la pierre et la bêche. Les couches de risque s’y affichent aussi.",

  "science.eyebrow": "Le modèle",
  "science.title": "Une vraie carte des risques, pas un décor",
  "science.intro":
    "SCIMAP repère d’où la pollution diffuse risque de venir en combinant deux choses\u00a0: l’érodabilité du sol, et la qualité de la connexion de chaque point à la rivière quand le sol est humide. Downstream le fait tourner en direct, dans un Web Worker, sur le terrain que vous parcourez.",
  "science.faithful.title": "Fidèle là où il est spécifié",
  "science.faithful.body":
    "L’indice d’humidité, le Network Index, le routage des écoulements FD8 et l’étirement par percentiles sont transcrits de l’implémentation de référence, avec les formules à l’identique.",
  "science.honest.title": "Transparent là où il s’en écarte",
  "science.honest.body":
    "Il y a trois changements délibérés\u00a0: un Network Index calculé en une seule passe, un risque dans le cours d’eau cumulé le long du chemin d’écoulement, et des bornes d’étirement figées au départ pour qu’une amélioration apparaisse comme une amélioration. Chacun est justifié dans le code.",
  "science.save.title": "Une sauvegarde est un lien",
  "science.save.body":
    'La génération est exactement reproductible\u00a0: une sauvegarde n’est donc qu’une graine et la liste de ce que vous avez construit, soit quelques centaines d’octets. Appuyez sur <kbd data-key="KeyK">K</kbd> pour copier un lien qui reconstruit votre bassin versant pour n’importe qui.',
  "science.more":
    'Le raisonnement, et les bugs qui semblaient plausibles tout en étant faux, sont détaillés (en anglais) dans <a href="https://github.com/simreaney/downstream/blob/main/DESIGN.md">DESIGN.md</a>. Pour en savoir plus sur SCIMAP, voir la <a href="https://simreaney.github.io/portfolio/scimap/">page du projet SCIMAP</a>.',

  "controls.eyebrow": "Commandes",
  "controls.title": "Clavier ou manette",
  "controls.keys": "Touches",
  "controls.gamepad": "Manette",
  "controls.does": "Action",
  "controls.walk.pad": "Stick gauche",
  "controls.walk": "Marcher (<kbd>Maj</kbd> pour courir)\u00a0; faites glisser ou utilisez le stick droit pour regarder",
  "controls.tools.pad": "Croix directionnelle",
  "controls.tools": "Planter, barrage filtrant, mare",
  "controls.build": "Construire face à vous",
  "controls.gather": "Ramasser du bois, de la pierre ou la bêche",
  "controls.overlay": "Couche de risque suivante / masquer la couche",
  "controls.map": "Carte d’ensemble du bassin versant",
  "controls.storm": "Lancer une pluie de projet (retour 30 jours)",
  "controls.undo.pad": "Croix, gauche",
  "controls.undo": "Annuler le dernier aménagement",
  "controls.save": "Sauvegarder et copier un lien de partage",
  "controls.anyController.title": "Toutes les manettes conviennent",
  "controls.anyController.body":
    "Bluetooth ou USB, Xbox ou PlayStation\u00a0: le navigateur les ramène toutes à la même disposition. Connectez-la et appuyez une fois sur un bouton pour la réveiller.",
  "controls.teaching.title": "Pour l’enseignement",
  "controls.teaching.body":
    "La même graine construit toujours le même bassin versant\u00a0: toute une classe peut donc travailler sur un même paysage. Ajoutez <code>?seed=132</code> au lien du jeu, <code>?size=small</code> ou <code>large</code> pour changer sa taille, et <code>?lang=en</code>, <code>es</code>, <code>de</code> ou <code>fr</code> pour choisir la langue.",
  "controls.teaching.link":
    '<a href="play/?seed=132">Ouvrir le bassin versant 132</a>, celui de la bande-annonce.',
  "controls.runsOn.title": "Sur quoi ça tourne",
  "controls.runsOn.body":
    'N’importe quel navigateur de bureau récent avec WebGL. Le jeu est conçu pour un ordinateur portable ou de bureau\u00a0: sur un téléphone, vous pouvez regarder autour de vous, mais il vous faudra une manette pour marcher. Sur Meta Quest, il tourne <a href="#vr">en VR</a>.',

  "vr.eyebrow": "En VR",
  "vr.title": "Posez le bassin versant sur une table",
  "vr.intro":
    "Sur Meta Quest, Downstream devient le diorama qu’il imite. Ouvrez le jeu dans le navigateur du casque et appuyez sur <strong>Entrer en VR</strong>\u00a0: le bassin versant se réduit sur une table devant vous, votre personnage s’y tient, et vous regardez autour de vous en bougeant la tête.",

  "vr.table.caption": "À la table, en visant le panneau",
  "vr.table.alt":
    "Dans un casque VR\u00a0: le personnage du joueur se tient sur un paysage posé sur une table, près d’un ruisseau et d’un arbre, avec un indicateur au-dessus de la tête. Un panneau au bord gauche de la table affiche le bois, la pierre, les outils et la santé du bassin versant, et un rayon partant de la manette vise son bouton d’orage.",
  "vr.table.step": "À la table",
  "vr.table.title": "Votre bassin versant vu d’en haut",
  "vr.table.body":
    "Votre personnage a à peu près la taille d’une pièce d’échecs. Quand il marche, le paysage glisse sous vous, et il tourne par crans plutôt que de pivoter en continu, pour que l’horizon reste droit. L’indicateur flotte au-dessus de sa tête et vous dit ce qui s’écoule par un endroit avant que vous construisiez.",
  "vr.table.body2":
    "Tout le reste se trouve sur le panneau au bord de la table\u00a0: visez-le avec la manette droite et appuyez sur la gâchette.",

  "vr.board.caption": "Tout le bassin versant en maquette sur la table",
  "vr.board.alt":
    "Vue d’ensemble en VR\u00a0: tout le bassin versant en maquette sur un socle en bois, recouvert de la carte du risque à la source, avec le réseau hydrographique qui converge vers l’encoche de l’exutoire à l’avant. Le panneau à côté affiche la légende de la carte des risques.",
  "vr.board.step": "Vue d’ensemble",
  "vr.board.title": "Tout le modèle, à portée de main",
  "vr.board.body":
    "Poussez le stick droit et le bassin versant se pose sur la table comme une maquette d’environ 1,4 m de large, sur son propre socle, avec la carte des risques par-dessus. Penchez-vous pour suivre un ruisseau de la crête à l’exutoire, ou accroupissez-vous pour voir le profil de la vallée sur le côté de la maquette.",

  "vr.controllers": "Manettes Touch",
  "vr.walk.pad": "Stick gauche",
  "vr.walk": "Marcher (gâchette gauche pour courir)",
  "vr.turn.pad": "Stick droit",
  "vr.turn": "Gauche et droite font tourner la table\u00a0; haut et bas zooment",
  "vr.zoom.pad": "Clic du stick droit",
  "vr.zoom": "Passer de la vue rapprochée à la vue intermédiaire, puis à tout le bassin versant",
  "vr.build.pad": "A ou gâchette droite",
  "vr.grips.pad": "Poignées",
  "vr.grips": "Outil précédent et suivant",
  "vr.panel.pad": "Viser le panneau",
  "vr.panel": "Orage, annuler, sauvegarder, choisir un outil ou une couche, et quitter la VR",
  "vr.need.title": "Ce qu’il vous faut",
  "vr.need.body":
    "Un Meta Quest et son propre navigateur\u00a0: pas d’application, pas d’installation, et le même lien que partout ailleurs. Le bouton <strong>Entrer en VR</strong> n’apparaît que dans un navigateur capable de lancer une session VR, vous ne le verrez donc pas sur un ordinateur portable. D’autres casques compatibles WebXR peuvent aussi fonctionner.",
  "vr.sitting.title": "Assis ou debout",
  "vr.sitting.body":
    "La table se place d’après la hauteur de vos yeux au démarrage, les deux conviennent donc. Si elle se retrouve au mauvais endroit, maintenez le bouton Meta de la manette droite pour recentrer.",
  "vr.lighter.title": "Plus léger sur un casque",
  "vr.lighter.body":
    "Un casque dessine chaque image deux fois, une par œil\u00a0: il reçoit donc une scène plus légère qu’un ordinateur, avec moins d’arbres et des ombres mises à jour moins souvent. Le modèle en dessous est exactement le même.",

  "cta.title": "La rivière vous attend",
  "cta.body": "Pas d’installation ni de compte. Votre bassin versant est généré en une seconde ou deux.",
  "cta.play": "Jouer à Downstream",
  "cta.source": "Code source sur GitHub",

  "footer.credit":
    'Downstream est créé par <a href="https://simreaney.github.io/">Sim Reaney</a>, Département de géographie, Université de Durham.',
  "footer.nav": "Pied de page",
  "footer.play": "Jouer",
  "footer.design": "Notes de conception",
  "lightbox.label": "Capture d’écran",
  "lightbox.close": "Fermer",
};
