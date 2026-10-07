/** The landing page in Spanish. See `types.ts`. */

import type { LandingMessages } from "./types";

export const es: LandingMessages = {
  "meta.title": "Downstream — un juego sobre contaminación difusa",
  "meta.description":
    "Recorre una cuenca fluvial generada por procedimientos y repárala con diques filtrantes, estanques y árboles de ribera, guiándote por SCIMAP, un modelo de riesgo de contaminación difusa que se ejecuta en directo en tu navegador.",

  "hero.tagline": "Un juego sobre contaminación difusa",
  "hero.pitch":
    "Recorre una cuenca fluvial generada por procedimientos y repárala: planta árboles de ribera, cava estanques y construye diques filtrantes de madera. El mapa de riesgo con el que trabajas no es decorativo. Es SCIMAP, un modelo real de contaminación difusa, que se vuelve a calcular sobre el terreno cada vez que construyes.",
  "hero.play": "Juega en el navegador",
  "hero.trailer": "Ver el tráiler",
  "hero.note":
    'Gratis, en el navegador, sin instalar nada. Funciona con teclado y ratón o con cualquier mando, y <a href="#vr">en RV con un visor Meta Quest</a>.',

  "trailer.eyebrow": "Tráiler",
  "trailer.title": "Míralo en movimiento",
  "trailer.label": "Tráiler del juego Downstream",
  "trailer.download": "Descargar el tráiler (MP4)",
  "trailer.caption":
    "Un paseo hasta un afluente: el mapa de riesgo, un dique filtrante, una franja de vegetación de ribera y un estanque fuera del cauce, y después una tormenta de diseño con periodo de retorno de 30 días sobre una cuenca a medio reparar. Grabado en la versión para navegador, sin sonido.",

  "how.eyebrow": "Cómo se juega",
  "how.title": "Lee el terreno y luego cámbialo",
  "how.intro":
    "Cada cuenca se genera a partir de una semilla: crestas, valles, una red fluvial, campos, bosques, un pueblo y, aguas abajo, una zona de pesca. Está perdiendo suelo hacia su río, y tienes tres herramientas para evitarlo.",

  "how.map.caption": "La capa de riesgo en origen del mapa SCIMAP",
  "how.map.alt":
    "El pueblo y sus arroyos bajo la capa de riesgo en origen: morado donde el riesgo es bajo, amarillo y naranja brillantes donde el terreno erosionable está conectado con el agua.",
  "how.map.step": "1 · El mapa",
  "how.map.title": "Encuentra de dónde sale el sedimento",
  "how.map.body":
    'Pulsa <kbd data-key="KeyM">M</kbd> para ver el mapa de riesgo. El terreno brillante es erosionable <em>y</em> además está conectado con un curso de agua: ahí es donde el sedimento llega al río. Recorre el riesgo en origen, la conectividad, la erosión y el riesgo en el cauce para ver por qué.',

  "how.build.caption": "Colocando un dique filtrante en un arroyo de cabecera",
  "how.build.alt":
    "El jugador, de pie en un arroyo pequeño, coloca un dique filtrante. El indicador de arriba dice cuánto terreno drena por ese punto.",
  "how.build.step": "2 · Construye",
  "how.build.title": "Pon cada solución donde cuenta",
  "how.build.body":
    "Los diques filtrantes van en arroyos de cabecera pequeños, los estanques en hondonadas fuera del cauce y los árboles en el terreno brillante junto al agua. Antes de decidirte, el indicador te dice cuánto terreno drena por ese punto. Si la respuesta es «casi nada», te lo dice.",
  "how.build.body2": "Recoge madera y piedra por el camino, y encuentra la pala antes de poder cavar.",

  "how.respond.caption": "Plantando una franja de vegetación de ribera junto al arroyo",
  "how.respond.alt": "Árboles jóvenes plantados en la orilla de un arroyo, con el siguiente punto de plantación resaltado.",
  "how.respond.step": "3 · Mira cómo responde",
  "how.respond.title": "Lo que haces aguas arriba se nota aguas abajo",
  "how.respond.body":
    "Cada árbol, estanque y dique vuelve a ejecutar el modelo, así que el mapa y el color del río cambian en cuanto construyes. Y no te regala nada: con los pesos de cubierta del suelo del modelo, plantar árboles en pastizales extensivos empeora un poco la erosión. El juego te deja hacerlo, y te lo dice.",

  "how.test.caption": "El hidrograma de crecida tras una tormenta de diseño (periodo de retorno de 30 días)",
  "how.test.alt":
    "Después de una tormenta: un hidrograma que compara el caudal del río con y sin el trabajo del jugador, y un mensaje con la reducción del caudal punta.",
  "how.test.step": "4 · Ponlo a prueba",
  "how.test.title": "Envía una tormenta",
  "how.test.body":
    'Pulsa <kbd data-key="KeyR">R</kbd> para lanzar una tormenta de diseño con periodo de retorno de 30 días. El hidrograma compara el pico de la crecida con tu trabajo y sin él, para la misma tormenta, y el pueblo y la zona de pesca responden a la diferencia. Las tormentas más pequeñas también llegan solas.',

  "how.plan.caption": "El mapa general de la cuenca",
  "how.plan.alt":
    "El mapa general de la cuenca: un relieve sombreado de todo el paisaje con la red de arroyos, el pueblo, la zona de pesca y los marcadores de recursos.",
  "how.plan.step": "5 · Planifica",
  "how.plan.title": "Ve la cuenca entera",
  "how.plan.body":
    "<kbd>Tab</kbd> abre la vista general: la red de drenaje desde las crestas hasta la salida, el pueblo y la zona de pesca, y dónde encontrar madera, piedra y la pala. Las capas de riesgo también se ven aquí.",

  "science.eyebrow": "El modelo",
  "science.title": "Un mapa de riesgo real, no decorativo",
  "science.intro":
    "SCIMAP indica de dónde es probable que venga la contaminación difusa combinando dos cosas: lo erosionable que es el terreno y lo bien conectado que está cada punto con el río cuando el suelo está húmedo. Downstream lo ejecuta en directo, en un Web Worker, sobre el terreno que estás pisando.",
  "science.faithful.title": "Fiel donde está especificado",
  "science.faithful.body":
    "El índice de humedad, el Network Index, el enrutamiento de flujo FD8 y el estiramiento por percentiles están transcritos de la implementación de referencia, con las fórmulas tal cual.",
  "science.honest.title": "Honesto donde se aparta",
  "science.honest.body":
    "Hay tres cambios deliberados: un Network Index de una sola pasada, un riesgo en el cauce acumulado a lo largo de la ruta de flujo y unos límites de estiramiento fijados al principio, para que una mejora se vea como una mejora. Cada uno está argumentado en el código.",
  "science.save.title": "Una partida guardada es un enlace",
  "science.save.body":
    'La generación es exactamente reproducible, así que una partida guardada es solo una semilla y una lista de lo que construiste: unos cientos de bytes. Pulsa <kbd data-key="KeyK">K</kbd> para copiar un enlace que reconstruye tu cuenca para cualquiera.',
  "science.more":
    'El razonamiento, y los errores que parecían plausibles sin serlo, están explicados (en inglés) en <a href="https://github.com/simreaney/downstream/blob/main/DESIGN.md">DESIGN.md</a>. Hay más sobre SCIMAP en la <a href="https://simreaney.github.io/portfolio/scimap/">página del proyecto SCIMAP</a>.',

  "controls.eyebrow": "Controles",
  "controls.title": "Teclado o mando",
  "controls.keys": "Teclas",
  "controls.gamepad": "Mando",
  "controls.does": "Acción",
  "controls.walk.pad": "Stick izquierdo",
  "controls.walk": "Caminar (<kbd>Mayús</kbd> para correr); arrastra o usa el stick derecho para mirar",
  "controls.tools.pad": "Cruceta",
  "controls.tools": "Plantar, dique filtrante, estanque",
  "controls.build": "Construir donde miras",
  "controls.gather": "Recoger madera, piedra o la pala",
  "controls.overlay": "Siguiente capa de riesgo / ocultar la capa",
  "controls.map": "Mapa general de la cuenca",
  "controls.storm": "Lanzar una tormenta de diseño (retorno de 30 días)",
  "controls.undo.pad": "Cruceta izquierda",
  "controls.undo": "Deshacer el último elemento",
  "controls.save": "Guardar y copiar un enlace para compartir",
  "controls.anyController.title": "Sirve cualquier mando",
  "controls.anyController.body":
    "Bluetooth o USB, Xbox o PlayStation: el navegador los asigna todos a la misma distribución. Conéctalo y pulsa un botón una vez para activarlo.",
  "controls.teaching.title": "Para la docencia",
  "controls.teaching.body":
    "La misma semilla construye siempre la misma cuenca, así que toda una clase puede trabajar sobre un mismo paisaje. Añade <code>?seed=132</code> al enlace del juego, <code>?size=small</code> o <code>large</code> para cambiar su tamaño, y <code>?lang=en</code>, <code>es</code>, <code>de</code> o <code>fr</code> para elegir el idioma.",
  "controls.teaching.link": '<a href="play/?seed=132">Abre la cuenca 132</a>, la del tráiler.',
  "controls.runsOn.title": "Dónde funciona",
  "controls.runsOn.body":
    'Cualquier navegador de escritorio reciente con WebGL. Está pensado para un portátil o un ordenador de sobremesa: en un móvil puedes mirar alrededor, pero necesitarás un mando para caminar. En un visor Meta Quest funciona <a href="#vr">en RV</a>.',

  "vr.eyebrow": "En RV",
  "vr.title": "Pon la cuenca sobre una mesa",
  "vr.intro":
    "En un visor Meta Quest, Downstream se convierte en el diorama que su estilo imita. Abre el juego en el navegador del visor y pulsa <strong>Entrar en RV</strong>: la cuenca se encoge sobre una mesa delante de ti, tu personaje está de pie sobre ella y miras alrededor moviendo la cabeza.",

  "vr.table.caption": "En la mesa, apuntando al panel",
  "vr.table.alt":
    "En un visor de RV: el personaje del jugador está de pie sobre un paisaje encima de una mesa, junto a un arroyo y un árbol, con un indicador sobre la cabeza. Un panel en el borde izquierdo de la mesa muestra la madera, la piedra, las herramientas y la salud de la cuenca, y un rayo que sale del mando apunta a su botón de tormenta.",
  "vr.table.step": "En la mesa",
  "vr.table.title": "Mira tu propia cuenca desde arriba",
  "vr.table.body":
    "Tu personaje mide más o menos lo que una pieza de ajedrez. Mientras camina, el paisaje se desliza bajo ti, y gira a saltos en lugar de dar vueltas, para que el horizonte se mantenga nivelado. El indicador flota sobre su cabeza y te dice qué drena por un punto antes de construir.",
  "vr.table.body2":
    "Todo lo demás está en el panel del borde de la mesa: apunta hacia él con el mando derecho y aprieta el gatillo.",

  "vr.board.caption": "La cuenca entera como maqueta sobre la mesa",
  "vr.board.alt":
    "Vista alejada en RV: toda la cuenca como una maqueta sobre un pedestal de madera, con el mapa de riesgo en origen superpuesto y la red fluvial convergiendo en la muesca de la salida, al frente. El panel de al lado muestra la leyenda del mapa de riesgo.",
  "vr.board.step": "Vista alejada",
  "vr.board.title": "Todo el modelo, al alcance de la mano",
  "vr.board.body":
    "Empuja el stick derecho y la cuenca se queda sobre la mesa como una maqueta de unos 1,4 m de ancho, sobre su propio pedestal, con el mapa de riesgo superpuesto. Acércate para seguir un arroyo desde la cresta hasta la salida, o agáchate para ver el perfil del valle en el lateral de la maqueta.",

  "vr.controllers": "Mandos Touch",
  "vr.walk.pad": "Stick izquierdo",
  "vr.walk": "Caminar (gatillo izquierdo para correr)",
  "vr.turn.pad": "Stick derecho",
  "vr.turn": "Izquierda y derecha giran la mesa; arriba y abajo, zoom",
  "vr.zoom.pad": "Pulsar el stick derecho",
  "vr.zoom": "Saltar entre la vista de cerca, la intermedia y la cuenca entera",
  "vr.build.pad": "A o gatillo derecho",
  "vr.grips.pad": "Botones laterales",
  "vr.grips": "Herramienta anterior y siguiente",
  "vr.panel.pad": "Apuntar al panel",
  "vr.panel": "Tormenta, deshacer, guardar, elegir herramienta o capa, y salir de la RV",
  "vr.need.title": "Qué necesitas",
  "vr.need.body":
    "Un visor Meta Quest y su propio navegador: sin app ni instalación, y con el mismo enlace que en cualquier otro sitio. El botón <strong>Entrar en RV</strong> solo aparece en un navegador que puede iniciar una sesión de RV, así que no lo verás en un portátil. Otros visores compatibles con WebXR también pueden funcionar.",
  "vr.sitting.title": "Sentado o de pie",
  "vr.sitting.body":
    "La mesa se coloca según la altura de tus ojos al empezar, así que sirven las dos posturas. Si queda en mal sitio, mantén pulsado el botón Meta del mando derecho para recentrarla.",
  "vr.lighter.title": "Más ligero en un visor",
  "vr.lighter.body":
    "Un visor dibuja cada fotograma dos veces, una por ojo, así que recibe una escena más ligera que un ordenador: menos árboles y sombras que se actualizan con menos frecuencia. El modelo de debajo es exactamente el mismo.",

  "cta.title": "El río te espera",
  "cta.body": "Sin instalación y sin cuenta. Tu cuenca se genera en un par de segundos.",
  "cta.play": "Jugar a Downstream",
  "cta.source": "Código fuente en GitHub",

  "footer.credit":
    'Downstream es obra de <a href="https://simreaney.github.io/">Sim Reaney</a>, Departamento de Geografía, Universidad de Durham.',
  "footer.nav": "Pie de página",
  "footer.play": "Jugar",
  "footer.design": "Notas de diseño",
  "lightbox.label": "Captura de pantalla",
  "lightbox.close": "Cerrar",
};
