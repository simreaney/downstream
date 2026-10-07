/**
 * Every string the game shows, in English: the source the other languages are
 * typed against, so a key missing from any of them is a compile error.
 *
 * `{name}` is filled in by `t()`. Numbers arrive already formatted for the
 * language, so a translation places them but never formats them. Keys ending
 * `.one` / `.other` are a plural pair, picked by `tn()`.
 *
 * Key names that appear in hints are placeholders too (`{key}`, `{keys}`),
 * because the game binds physical keys and the label printed on that key
 * depends on the player's keyboard, not their language. Controller buttons are
 * written out, since they are the same on every Quest.
 */
export const en = {
  "meta.title": "Downstream — a diffuse pollution game",
  "meta.description":
    "Explore a procedurally generated catchment and repair it with ponds, leaky dams and riparian trees, guided by a live SCIMAP risk map.",

  // Loading. The numbered stages come from the worker, which sends the key.
  "boot.surveying": "Surveying the catchment…",
  "boot.failed": "Could not start.",
  "boot.workerFailed": "Simulation worker failed to load",
  "stage.rendererReady": "Renderer ready",
  "stage.raiseGround": "1.1 Raising the ground…",
  "stage.shapeCatchment": "1.2 Shaping the catchment…",
  "stage.drainHollows": "1.3 Draining the hollows…",
  "stage.cutValleys": "1.4 Cutting the valleys…",
  "stage.settleSlopes": "1.5 Settling the slopes…",
  "stage.smooth": "1.6 Smoothing…",
  "stage.topographyReady": "1.7 Topography ready.",
  "stage.removeDepressions": "2.1 Removing depressions…",
  "stage.slope": "2.2 Measuring slope and curvature…",
  "stage.partitionFlow": "2.3 Partitioning flow…",
  "stage.accumulate": "2.4 Accumulating upslope area…",
  "stage.rainfall": "2.5 Weighting rainfall…",
  "stage.wetness": "2.6 Computing wetness…",
  "stage.flowPaths": "2.7 Tracing flow paths to the channel network…",
  "stage.freezeBaseline": "2.8 Freezing the baseline…",
  "stage.riskReady": "2.9 Risk layers ready.",
  "stage.riverNetwork": "3.1 Tracing the river network…",
  "stage.sites": "3.2 Siting the village and the fishery…",
  "stage.colourMap": "3.3 Colouring the risk map…",
  "stage.ready": "Ready",

  // Tools, and the HUD's key hint.
  "tool.tree": "Plant",
  "tool.dam": "Leaky dam",
  "tool.pond": "Pond",
  "hud.spade": "spade",
  "hint.walk": "walk",
  "hint.build": "build",
  "hint.gather": "gather",
  "hint.storm": "storm",
  "hint.undo": "undo",
  "hint.save": "save",
  "hint.map": "map",
  "hint.zoom": "zoom",
  "hint.nextLayer": "next layer",
  "hint.off": "off",
  "hint.close": "close",
  "key.scroll": "Scroll",

  // The placement readout.
  "readout.drains": "{area} drains through here",
  "readout.drainsRaisesErosion": "{area} drains through here — planting here would raise erosion slightly",
  "readout.takeWood": "{key} — take wood",
  "readout.takeStone": "{key} — take stone",
  "readout.takeSpade": "{key} — take the spade",

  // Why a placement is refused. Each one names the hydrology, not just "no".
  "placement.offMap": "Outside the catchment",
  "placement.needSpade": "You need a spade to dig",
  "placement.needWood": "Not enough wood",
  "placement.needStone": "Not enough stone",
  "placement.occupied": "Something is already here",
  "placement.tooSteep": "Too steep to hold water",
  "placement.notAHollow": "This sheds water — find a hollow",
  "placement.tooLittleUpslope": "Almost nothing drains through here",
  "placement.inChannel": "Not in the watercourse — an online pond blocks fish passage",
  "placement.notInChannel": "Leaky dams go in a watercourse",
  "placement.channelTooLarge": "This reach is too big — a leaky dam would wash out",
  "placement.tooCloseToDam": "Too close to another dam to add much",
  "placement.alreadyWooded": "Already wooded",
  "placement.onWater": "Can't plant on water",

  // What a build or an undo did. One key per feature, so each language can
  // agree its verb and gender with the noun.
  "build.built.pond": "Pond built — {area} draining through",
  "build.built.dam": "Leaky dam built — {area} draining through",
  "build.built.tree": "Tree built — {area} draining through",
  "build.plantedLowRisk": "Tree planted — this cover was already lower-risk than woodland",
  "build.removed.pond": "Pond removed",
  "build.removed.dam": "Leaky dam removed",
  "build.removed.tree": "Tree removed",
  "build.nothingToUndo": "Nothing to undo",

  // Toasts.
  "toast.saveProblem": "{problem} — starting a fresh one",
  "toast.restored.one": "Restored — {count} feature",
  "toast.restored.other": "Restored — {count} features",
  "toast.restoreFailed": "That save could not be restored in full",
  "toast.stormCut": "Storm passed — your work cut the peak by {cut}%",
  "toast.stormBarely": "Storm passed — your ponds and dams barely changed this peak",
  "toast.stormNothing": "Storm passed — nothing built upstream to slow it",
  "toast.stormFailed": "The storm could not be simulated",
  "toast.stormBusy": "A storm is already passing",
  "toast.stormComing": "A 1-in-{days} storm is coming…",
  "toast.rain": "Rain moving in — {depth} mm",
  "toast.gainWood": "+{count} wood",
  "toast.gainStone": "+{count} stone",
  "toast.foundSpade": "You found a spade — you can dig ponds now",
  "toast.buildFailed": "That could not be built — nothing was spent",
  "toast.undoFailed": "Could not undo that — try again",
  "toast.saved": "Saved — link copied to clipboard",
  "toast.savedAddressBar": "Saved — the link is in your address bar",
  "toast.saveFailed": "Could not save",
  "toast.vrFailed": "The headset could not start a VR session",

  // Save codes that cannot be loaded.
  "save.notACode": "That does not look like a catchment code",
  "save.outside": "That code has a feature outside its landscape",
  "save.newer": "That save is from a newer version ({version})",
  "save.older": "That save was made with an older landscape generator, so it would open a different catchment",
  "save.unreadable": "That save could not be read",

  // The opening lesson. `{key}` is the key or controller button to press.
  "tutorial.walk": "This catchment is losing soil to its river. Walk about with {keys} and take a look.",
  "tutorial.walkVr": "This catchment is losing soil to its river. Walk about with the left stick and take a look.",
  "tutorial.openMap":
    "Press {key} for the risk map. Bright means erodible ground that is well connected to a watercourse — that is where sediment comes from.",
  "tutorial.gather": "Press {key} by a log pile or boulder to gather. You will need wood to plant and stone to dig.",
  "tutorial.plant": "Face a bright patch near the river and press {key} to plant. Watch the map and the water.",
  "tutorial.storm":
    "Trees are only half of it. Press {key} to send a storm through and see what your work does to the flood.",
  // Names the dashboard button, so it must match "vr.storm".
  "tutorial.stormVr":
    "Trees are only half of it. Point at Storm on this panel and pull the trigger to see what your work does to the flood.",
  "tutorial.skip": "Skip",

  // The risk map's layers, and its legend.
  "layer.connectivity": "Connectivity",
  "layer.connectivity.description": "How reliably runoff here reaches a watercourse",
  "layer.erosion": "Erosion risk",
  "layer.erosion.description": "Sediment this ground can supply, given its cover and steepness",
  "layer.sourceRisk": "Source risk",
  "layer.sourceRisk.description": "Erodible AND connected — the places worth fixing",
  "layer.inChannel": "In-channel risk",
  "layer.inChannel.description": "Sediment concentration the river is actually carrying",
  "legend.lower": "lower",
  "legend.higher": "higher",

  // Catchment health.
  "score.title": "Catchment health",
  "score.waterQuality": "Water quality",
  "score.waterQuality.hint": "sediment reaching the fishery",
  "score.floodRisk": "Flood risk",
  "score.floodRisk.hint": "peak flow at the village",
  "score.habitat": "Habitat",
  "score.habitat.hint": "continuous riverside cover",

  // The overview map.
  "overview.title": "Catchment overview",
  "overview.description": "The whole landscape, from above.",
  "overview.close": "Close",
  "overview.outlet": "Outlet",
  "overview.village": "Village",
  "overview.fishery": "Fishery",
  "overview.key.wood": "wood",
  "overview.key.stone": "stone",
  "overview.key.spade": "spade",
  "overview.key.outlet": "outlet",
  "overview.key.village": "village",
  "overview.key.fishery": "fishery",

  // The hydrograph.
  "chart.storm": "Storm",
  "chart.title": "Storm — {depth} mm, about 1 in {days} days",
  "chart.withWork": "with your work",
  "chart.without": "without",
  "chart.peakCut": "peak −{cut}%",
  "chart.peakCutDelayed": "peak −{cut}%, {delay} min later",
  "chart.noChange": "no measurable change",

  // The headset's dashboard and label.
  "vr.enter": "Enter VR",
  "vr.wood": "Wood {count}",
  "vr.stone": "Stone {count}",
  "vr.spade": "Spade",
  "vr.noSpade": "No spade",
  "vr.priceWood": "{count} wood",
  "vr.priceStone": "{count} stone",
  "vr.riskMap": "Risk map: {layer}",
  "vr.showRiskMap": "Show the risk map",
  "vr.hideMap": "Hide map",
  "vr.storm": "Storm",
  "vr.undo": "Undo",
  "vr.save": "Save",
  "vr.exit": "Exit VR",
  "vr.controls":
    "Left stick walk · left trigger run · A or trigger build · B gather · X / Y risk map · grips change tool · right stick turn and zoom",
  "vr.pickUpControllers": "Pick up your controllers to play",
} as const;

export type MessageKey = keyof typeof en;

/** A whole language: every key, nothing extra. */
export type Messages = Readonly<Record<MessageKey, string>>;

/** Loading stages, which the worker reports by key so it never needs the tables. */
export type ProgressStage = Extract<MessageKey, `stage.${string}`>;
