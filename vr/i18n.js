// EN / DE / FR texts for elements with data-i18n, data-i18n-html, data-i18n-title.
const DICT = {
  en: {
    tlTitle: "Click or drag to change time",
    panelToggle: "Hide / show panel", layer: "Layer", texture: "Texture", thickness: "Thickness", speed: "Speed",
    opacity: "Overlay opacity", terrain: "Terrain", exag: "Vertical exaggeration", shade: "Relief shading",
    sun: "Sun azimuth", mesh: "Mesh", hq: "Full resolution when paused", overlays: "Overlays",
    border: "Swiss border", cities: "Cities", flyto: "Fly to",
    help: "<b>Mouse</b>: left drag rotate · right drag pan · wheel zoom<br><b>Keys</b>: space play · ←/→ step (shift ×10) · H hide UI",
    loading: "Loading…", noData: "The data could not be loaded. Please try again later.", prev: "Step back (←)", play: "Play / pause (space)", next: "Step forward (→)", lang: "Language", back: "More info", surface: "surface", ice: "ice", vel: "speed", latlon: "lat / lon",
    views: ["Overview", "Top (plan)", "Rhône lobe · Geneva", "Valais", "Lausanne", "Aare · Bern", "Reuss · Lucerne", "Linth/Rhine · Zurich"],
    cityNames: { Genève: "Geneva", Bern: "Bern", Lausanne: "Lausanne", Zürich: "Zurich", Luzern: "Lucerne", Basel: "Basel" },
  },
  de: {
    tlTitle: "Klicken oder ziehen, um die Zeit zu ändern",
    panelToggle: "Bedienfeld ein-/ausblenden", layer: "Ebene", texture: "Textur", thickness: "Eisdicke", speed: "Fließgeschw.",
    opacity: "Deckkraft der Ebene", terrain: "Gelände", exag: "Überhöhung", shade: "Reliefschattierung",
    sun: "Sonnenazimut", mesh: "Gitter", hq: "Volle Auflösung bei Pause", overlays: "Einblendungen",
    border: "Schweizer Grenze", cities: "Städte", flyto: "Flug zu",
    help: "<b>Maus</b>: links ziehen drehen · rechts ziehen verschieben · Rad zoomen<br><b>Tasten</b>: Leertaste abspielen · ←/→ Schritt (Umschalt ×10) · H Oberfläche ausblenden",
    loading: "Wird geladen…", noData: "Die Daten konnten nicht geladen werden. Bitte versuchen Sie es später erneut.", prev: "Schritt zurück (←)", play: "Abspielen / Pause (Leertaste)", next: "Schritt vor (→)", lang: "Sprache", back: "Mehr Infos", surface: "Oberfläche", ice: "Eis", vel: "Geschw.", latlon: "Breite / Länge",
    views: ["Übersicht", "Draufsicht", "Rhonelobus · Genf", "Wallis", "Lausanne", "Aare · Bern", "Reuss · Luzern", "Linth/Rhein · Zürich"],
    cityNames: { Genève: "Genf", Bern: "Bern", Lausanne: "Lausanne", Zürich: "Zürich", Luzern: "Luzern", Basel: "Basel" },
  },
  fr: {
    tlTitle: "Cliquer ou glisser pour changer d'époque",
    panelToggle: "Masquer / afficher le panneau", layer: "Couche", texture: "Texture", thickness: "Épaisseur", speed: "Vitesse",
    opacity: "Opacité de la couche", terrain: "Relief", exag: "Exagération verticale", shade: "Ombrage du relief",
    sun: "Azimut du soleil", mesh: "Maillage", hq: "Pleine résolution à l'arrêt", overlays: "Superpositions",
    border: "Frontière suisse", cities: "Villes", flyto: "Aller à",
    help: "<b>Souris</b> : glisser gauche pivoter · glisser droit déplacer · molette zoom<br><b>Touches</b> : espace lecture · ←/→ pas (maj ×10) · H masquer l'interface",
    loading: "Chargement…", noData: "Les données n’ont pas pu être chargées. Veuillez réessayer plus tard.", prev: "Pas en arrière (←)", play: "Lecture / pause (espace)", next: "Pas en avant (→)", lang: "Langue", back: "Plus d'infos", surface: "surface", ice: "glace", vel: "vitesse", latlon: "lat. / long.",
    views: ["Vue d'ensemble", "Vue de dessus", "Lobe du Rhône · Genève", "Valais", "Lausanne", "Aar · Berne", "Reuss · Lucerne", "Linth/Rhin · Zurich"],
    cityNames: { Genève: "Genève", Bern: "Berne", Lausanne: "Lausanne", Zürich: "Zurich", Luzern: "Lucerne", Basel: "Bâle" },
  },
};

export const LANGS = Object.keys(DICT);

function initialLang() {
  const q = new URLSearchParams(location.search).get("lang");
  if (DICT[q]) return q;
  try { const s = localStorage.getItem("alps3d.lang"); if (DICT[s]) return s; } catch {}
  const nav = (navigator.language || "en").slice(0, 2);
  return DICT[nav] ? nav : "en";
}

export let lang = initialLang();
export const t = (key) => DICT[lang][key] ?? DICT.en[key] ?? key;

const listeners = [];
export function onLangChange(fn) { listeners.push(fn); }

export function setLang(l) {
  if (!DICT[l]) return;
  lang = l;
  try { localStorage.setItem("alps3d.lang", l); } catch {}
  document.documentElement.lang = l;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  document.querySelectorAll("#lang button").forEach((b) => b.classList.toggle("on", b.dataset.v === l));
  listeners.forEach((fn) => fn(l));
}
