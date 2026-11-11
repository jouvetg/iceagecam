// Swiss Time Machine · maquette: the exhibit film (with its sound) projected on the 3D relief, in mixed reality
// on Meta Quest. Everything is stored on the headset after one download (service worker + Cache Storage).
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const FILM = new URLSearchParams(location.search).get("film") || "film.mp4", FILM_CACHE = "stm-film-v1";
const NX = 1571, NY = 1007;                               // terrain.bin: int16 elevation (m), 250 m grid, rows north -> south
const SIZE_X = 1.40, SIZE_Z = 0.90, EXAG = 1.8;           // the wooden relief: 1.40 x 0.90 m, ~1:280 000, heights x1.8
const SCALE = SIZE_X / 392400;                            // metres of model per metre of terrain
const TOP = 0.92;                                         // height of the relief base above the floor (m)

// texts
const lang = ["fr", "de"].includes((navigator.language || "en").slice(0, 2)) ? navigator.language.slice(0, 2) : "en";
const T = {
  en: { title: "Swiss Time Machine · model", sub: "The exhibit film, with its sound, projected on the relief",
    dl: "Save the film on this headset", pick: "Choose the film file on this headset", dling: "Downloading", ready: "Film saved on this headset: works offline.",
    enter: "Enter · mixed reality", noxr: "Open this page in the Meta Quest browser to enter mixed reality.",
    help: ["Controls", "Right trigger: play / pause", "Right stick left / right: rewind / fast forward", "A: back to the start",
      "Left stick: left / right to rotate, up / down to zoom", "B or Y: reset the view and show this help",
      "Walk around the model!", "Press any button to start"] },
  fr: { title: "Swiss Time Machine · maquette", sub: "Le film de l’exposition, avec sa bande son, projeté sur le relief",
    dl: "Enregistrer le film dans le casque", pick: "Choisir le fichier du film dans le casque", dling: "Téléchargement", ready: "Film enregistré dans le casque : fonctionne hors ligne.",
    enter: "Entrer · réalité mixte", noxr: "Ouvrez cette page dans le navigateur du Meta Quest pour entrer en réalité mixte.",
    help: ["Commandes", "Gâchette droite : lecture / pause", "Stick droit gauche / droite : reculer / avancer", "A : revenir au début",
      "Stick gauche : gauche / droite pour tourner, haut / bas pour zoomer", "B ou Y : réinitialiser la vue et revoir cette aide",
      "Tournez autour de la maquette !", "Appuyez sur un bouton pour commencer"] },
  de: { title: "Swiss Time Machine · Modell", sub: "Der Ausstellungsfilm mit Ton, projiziert auf das Relief",
    dl: "Film auf dem Headset speichern", pick: "Filmdatei auf dem Headset wählen", dling: "Herunterladen", ready: "Film auf dem Headset gespeichert: funktioniert offline.",
    enter: "Eintreten · Mixed Reality", noxr: "Öffnen Sie diese Seite im Browser der Meta Quest, um in Mixed Reality einzutreten.",
    help: ["Bedienung", "Rechter Trigger: Wiedergabe / Pause", "Rechter Stick links / rechts: zurück / vorspulen", "A: zurück zum Anfang",
      "Linker Stick: links / rechts drehen, oben / unten zoomen", "B oder Y: Ansicht zurücksetzen und diese Hilfe zeigen",
      "Gehen Sie um das Modell herum!", "Beliebige Taste drücken, um zu starten"] },
}[lang];
document.documentElement.lang = lang;
$("title").textContent = T.title;
$("sub").textContent = T.sub;
$("enter").textContent = T.enter;

// scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
$("scene").appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.02, 50);
camera.position.set(0, 1.75, 0.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, TOP, -1.3);
controls.update();
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

const video = $("film");
const vtex = new THREE.VideoTexture(video);
vtex.colorSpace = THREE.SRGBColorSpace;
vtex.minFilter = THREE.LinearFilter;
vtex.generateMipmaps = false;

const model = new THREE.Group();                          // furniture + wooden block + projected relief
model.position.set(0, 0, -1.3);
scene.add(model);
const relief = new THREE.Group();                         // scaled by the left stick, around the centre of the relief
relief.position.y = TOP;
model.add(relief);

const shadeBox = (w, h, d, color, y) => {                 // box with fixed per-face shading
  const c = new THREE.Color(color), f = [0.8, 0.8, 1, 0.45, 0.9, 0.7];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), f.map((k) => new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k) })));
  m.position.y = y;
  return m;
};
model.add(shadeBox(1.5, TOP - 0.12, 1.1, 0x2b2b2e, (TOP - 0.12) / 2));   // furniture
relief.add(shadeBox(SIZE_X, 0.12, SIZE_Z, 0xc9a273, -0.06));            // 12 cm wooden block

async function buildRelief() {
  const h = new Int16Array(await (await fetch("terrain.bin")).arrayBuffer());
  const n = NX * NY, pos = new Float32Array(3 * n), uv = new Float32Array(2 * n);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      pos[3 * k] = (i / (NX - 1) - 0.5) * SIZE_X;
      pos[3 * k + 1] = h[k] * EXAG * SCALE;
      pos[3 * k + 2] = (j / (NY - 1) - 0.5) * SIZE_Z;
      uv[2 * k] = i / (NX - 1); uv[2 * k + 1] = 1 - j / (NY - 1);
    }
  const idx = new Uint32Array((NX - 1) * (NY - 1) * 6);
  let p = 0;
  for (let j = 0; j < NY - 1; j++)
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // light relief shading baked in vertex colours (the projected film itself is flat light)
  const nrm = g.attributes.normal.array, col = new Float32Array(3 * n), L = new THREE.Vector3(-0.5, 0.8, -0.4).normalize();
  for (let k = 0; k < n; k++) {
    const s = Math.min(1, 0.68 + 0.4 * Math.max(0, nrm[3 * k] * L.x + nrm[3 * k + 1] * L.y + nrm[3 * k + 2] * L.z));
    col[3 * k] = col[3 * k + 1] = col[3 * k + 2] = s;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  relief.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: vtex, vertexColors: true })));

  // wooden sides between the block and the relief edges
  const side = [], wood = new THREE.Color(0xc9a273).multiplyScalar(0.85);
  const edge = (list) => {
    for (let e = 0; e < list.length - 1; e++) {
      const [a, b] = [list[e], list[e + 1]];
      const A = [pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]], B = [pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]];
      side.push(A[0], 0, A[2], A[0], A[1], A[2], B[0], B[1], B[2], A[0], 0, A[2], B[0], B[1], B[2], B[0], 0, B[2]);
    }
  };
  const row = (j) => Array.from({ length: NX }, (_, i) => j * NX + i), colm = (i) => Array.from({ length: NY }, (_, j) => j * NX + i);
  edge(row(0)); edge(row(NY - 1)); edge(colm(0)); edge(colm(NX - 1));
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(side, 3));
  relief.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: wood, side: THREE.DoubleSide })));
}

// film: kept in Cache Storage, played from a blob (no network needed afterwards)
async function cachedFilm() {
  try { const r = await (await caches.open(FILM_CACHE)).match(FILM); return r ? await r.blob() : null; } catch { return null; }
}
function useFilm(blob) {
  video.src = URL.createObjectURL(blob);
  $("dl").hidden = true;
  $("pickLabel").hidden = true;
  $("status").textContent = T.ready;
  checkXR();
}
async function keep(blob) {                              // copy into the page's storage: no need to pick it again
  try {
    await navigator.storage?.persist?.();
    await (await caches.open(FILM_CACHE)).put(FILM, new Response(blob, { headers: { "Content-Type": "video/mp4" } }));
  } catch (e) { console.warn("film not cached", e); }
  useFilm(blob);
}
$("pick").onchange = (e) => { const f = e.target.files[0]; if (f) { $("status").textContent = "…"; keep(f); } };
async function download() {
  $("dl").disabled = true;
  const r = await fetch(FILM, { cache: "no-store" });
  const total = +r.headers.get("content-length") || 0, reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    $("status").textContent = `${T.dling}… ${total ? Math.round((100 * got) / total) + " %" : (got / 1e6).toFixed(0) + " MB"}`;
  }
  keep(new Blob(parts, { type: "video/mp4" }));
}
$("dl").textContent = T.dl;
$("pickText").textContent = T.pick;
fetch(FILM, { method: "HEAD" }).then((r) => {                // the film next to the page (USB install), if any
  const mb = r.ok && +r.headers.get("content-length") / 1e6;
  if (mb > 1 && !video.src) { $("dl").hidden = false; $("dl").textContent = `${T.dl} (${Math.round(mb)} MB)`; }
}).catch(() => {});
$("dl").onclick = download;

async function checkXR() {
  const xr = navigator.xr;
  const ar = xr && await xr.isSessionSupported("immersive-ar").catch(() => false);
  const vr = xr && await xr.isSessionSupported("immersive-vr").catch(() => false);
  $("enter").disabled = !(video.src && (ar || vr));
  if (!(ar || vr)) $("status").textContent += " " + T.noxr;
  return ar ? "immersive-ar" : "immersive-vr";
}

// XR
const XR = { prev: {}, help: null, helpAt: 0, helpPending: false, last: 0 };
$("enter").onclick = async () => {
  video.play();                                           // must start inside the click
  const type = await checkXR();
  const session = await navigator.xr.requestSession(type, { optionalFeatures: ["local-floor", "bounded-floor"] });
  session.addEventListener("end", () => { video.pause(); XR.help.visible = false; document.body.classList.remove("xr"); });
  await renderer.xr.setSession(session);
  renderer.xr.setFoveation?.(1);
  document.body.classList.add("xr");
  scene.background = type === "immersive-ar" ? null : new THREE.Color(0x101318);
  resetView();
  XR.helpPending = true;
};

function resetView() {
  model.position.set(0, 0, -1.3);
  model.rotation.set(0, 0, 0);
  relief.scale.setScalar(1);
}

for (const i of [0, 1]) {
  const c = renderer.xr.getController(i);
  c.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.08), new THREE.MeshBasicMaterial({ color: 0xff7738 })));
  c.addEventListener("connected", (e) => { if (e.data.handedness === "left") c.add(panel); });
  rig.add(c);
}

const canvasTex = (w, h) => {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return { g: cv.getContext("2d"), tex };
};
// wrist panel: time and play state
const P = canvasTex(512, 128);
const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), new THREE.MeshBasicMaterial({ map: P.tex, transparent: true }));
panel.position.set(0, 0.06, -0.06); panel.rotation.x = -0.9;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
let lastSec = -1;
function drawPanel() {
  const g = P.g, d = video.duration || 0, t = video.currentTime;
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = "rgba(0,0,0,0.85)"; g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#ff7738"; g.font = "bold 44px sans-serif";
  g.fillText(`${video.paused ? "❚❚" : "▶"}  ${mmss(t)} / ${mmss(d)}`, 20, 60);
  g.fillStyle = "#555"; g.fillRect(20, 92, 472, 12);
  g.fillStyle = "#ff7738"; g.fillRect(20, 92, d ? (472 * t) / d : 0, 12);
  P.tex.needsUpdate = true;
}
// controls card, shown when entering and with B / Y
const H = canvasTex(1400, 800);
XR.help = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.56), new THREE.MeshBasicMaterial({ map: H.tex, transparent: true, depthTest: false }));
XR.help.renderOrder = 20; XR.help.visible = false;
rig.add(XR.help);
function showHelp() {
  const g = H.g, t = T.help;
  g.clearRect(0, 0, 1400, 800);
  g.fillStyle = "rgba(10,14,20,0.9)"; g.beginPath(); g.roundRect(0, 0, 1400, 800, 40); g.fill();
  g.fillStyle = "#ff7738"; g.font = "bold 72px sans-serif"; g.fillText(t[0], 60, 110);
  g.fillStyle = "#fff"; g.font = "44px sans-serif";
  t.slice(1, 6).forEach((l, i) => g.fillText(l, 60, 210 + i * 80, 1280));
  g.fillStyle = "#ff7738"; g.font = "bold 44px sans-serif"; g.fillText(t[6], 60, 640, 1280);
  g.fillStyle = "#9fb0c2"; g.font = "38px sans-serif"; g.textAlign = "center"; g.fillText(t[7], 700, 750); g.textAlign = "left";
  H.tex.needsUpdate = true;
  const xrCam = renderer.xr.getCamera(), head = new THREE.Vector3(), dir = new THREE.Vector3();
  xrCam.getWorldPosition(head); xrCam.getWorldDirection(dir);
  if (!head.y) head.y = 1.6;
  dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1); dir.normalize();
  XR.help.position.copy(head).addScaledVector(dir, 0.9); XR.help.position.y = head.y - 0.05;
  XR.help.lookAt(head.x, XR.help.position.y, head.z);
  XR.help.visible = true;
  XR.helpAt = performance.now();
}

function pressed(src, i) {                                // true once per press
  const key = src.handedness + i, now = !!src.gamepad.buttons[i]?.pressed, was = XR.prev[key];
  XR.prev[key] = now;
  return now && !was;
}

function xrUpdate(now, frame) {
  const dt = XR.last ? Math.min((now - XR.last) / 1000, 0.1) : 0;
  XR.last = now;
  const sources = [...frame.session.inputSources].filter((s) => s.gamepad);
  if (XR.helpPending && frame.getViewerPose(renderer.xr.getReferenceSpace())) { XR.helpPending = false; showHelp(); return; }
  if (XR.help.visible) {                                  // the card stays until a button or a stick is used
    let any = false;
    for (const s of sources) {
      s.gamepad.buttons.forEach((b, i) => { if (b.pressed && !XR.prev[s.handedness + i]) any = true; XR.prev[s.handedness + i] = b.pressed; });
      if (s.gamepad.axes.some((a) => Math.abs(a) > 0.5)) any = true;
    }
    if (any && now - XR.helpAt > 800) XR.help.visible = false;
    return;
  }
  for (const s of sources) {
    const gp = s.gamepad, [x, y] = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    const sx = Math.abs(x) > 0.15 ? x : 0, sy = Math.abs(y) > 0.15 ? y : 0;
    if (pressed(s, 5)) { resetView(); showHelp(); return; }
    if (s.handedness === "right") {
      if (pressed(s, 0)) video.paused ? video.play() : video.pause();
      if (pressed(s, 4)) { video.currentTime = 0; video.play(); }
      if (sx && video.duration) video.currentTime = Math.min(Math.max(video.currentTime + sx * dt * 15, 0), video.duration - 0.1);
    } else {
      model.rotation.y -= sx * dt * 1.2;
      relief.scale.setScalar(Math.min(Math.max(relief.scale.x * (1 - sy * dt), 0.3), 4));
    }
  }
}

renderer.setAnimationLoop((now, frame) => {
  if (frame) {
    xrUpdate(now, frame);
    const sec = Math.floor(video.currentTime * 4);
    if (sec !== lastSec || video.paused !== XR.wasPaused) { lastSec = sec; XR.wasPaused = video.paused; drawPanel(); }
  } else controls.update();
  renderer.render(scene, camera);
});
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// 2D preview: click the model to play / pause
renderer.domElement.addEventListener("dblclick", () => { if (video.src) video.paused ? video.play() : video.pause(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
await buildRelief();
$("loading").hidden = true;
const blob = await cachedFilm();
if (blob) useFilm(blob);
else { $("pickLabel").hidden = false; $("status").textContent = ""; checkXR(); }
