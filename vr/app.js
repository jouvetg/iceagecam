// Swiss Time Machine · maquette: the exhibit film (with its sound, in a loop) projected on the animated relief
// (simulated ice surface), as a large model on the floor that one explores with the sticks, in VR on Meta Quest.
// Everything is stored on the headset after the first opening (service worker + Cache Storage).
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const FILM = new URLSearchParams(location.search).get("film") || "film.mp4", FILM_CACHE = "stm-film-v1";
const NX0 = 1571, NY0 = 1007;                             // terrain.bin: int16 elevation (m), 250 m grid, rows north -> south
const D = 251500 / 392400;                                // depth / width of the map
const EXAG = 2;                                           // vertical exaggeration
const WIDTH = 30;                                         // initial width of the model on the floor (m)
const START_HEIGHT = 7;                                   // the user floats this much above the floor (m)

// texts
const lang = ["fr", "de"].includes((navigator.language || "en").slice(0, 2)) ? navigator.language.slice(0, 2) : "en";
const T = {
  en: { title: "Swiss Time Machine · model", sub: "The exhibit film, with its sound, projected on the moving relief",
    dl: "Save the film on this headset", pick: "Choose the film file on this headset", change: "Change the film file",
    dling: "Downloading", ready: "Film saved on this headset: works offline.", enter: "Enter · VR",
    noxr: "Open this page in the Meta Quest browser to enter VR.",
    help: ["Controls", "Left stick: move over the model, where you look", "Right stick left / right: turn",
      "Right stick up / down: enlarge / shrink the model", "Right trigger: play / pause · A: back to the start",
      "Grip: faster · B or Y: back to the start position and this help", "Press any button to start"] },
  fr: { title: "Swiss Time Machine · maquette", sub: "Le film de l’exposition, avec sa bande son, projeté sur le relief animé",
    dl: "Enregistrer le film dans le casque", pick: "Choisir le fichier du film dans le casque", change: "Changer le fichier du film",
    dling: "Téléchargement", ready: "Film enregistré dans le casque : fonctionne hors ligne.", enter: "Entrer · VR",
    noxr: "Ouvrez cette page dans le navigateur du Meta Quest pour entrer en VR.",
    help: ["Commandes", "Stick gauche : se déplacer au-dessus de la maquette, là où vous regardez", "Stick droit gauche / droite : tourner",
      "Stick droit haut / bas : agrandir / réduire la maquette", "Gâchette droite : lecture / pause · A : retour au début du film",
      "Grip : plus vite · B ou Y : position de départ et cette aide", "Appuyez sur un bouton pour commencer"] },
  de: { title: "Swiss Time Machine · Modell", sub: "Der Ausstellungsfilm mit Ton, projiziert auf das bewegte Relief",
    dl: "Film auf dem Headset speichern", pick: "Filmdatei auf dem Headset wählen", change: "Filmdatei wechseln",
    dling: "Herunterladen", ready: "Film auf dem Headset gespeichert: funktioniert offline.", enter: "Eintreten · VR",
    noxr: "Öffnen Sie diese Seite im Browser der Meta Quest, um in VR einzutreten.",
    help: ["Bedienung", "Linker Stick: über das Modell bewegen, in Blickrichtung", "Rechter Stick links / rechts: drehen",
      "Rechter Stick oben / unten: Modell vergrössern / verkleinern", "Rechter Trigger: Wiedergabe / Pause · A: Filmanfang",
      "Grip: schneller · B oder Y: Startposition und diese Hilfe", "Beliebige Taste drücken, um zu starten"] },
}[lang];
document.documentElement.lang = lang;
$("title").textContent = T.title;
$("sub").textContent = T.sub;
$("enter").textContent = T.enter;

// scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
$("scene").appendChild(renderer.domElement);
renderer.domElement.addEventListener("webglcontextlost", (e) => {   // the headset ran out of graphics memory
  e.preventDefault();
  renderer.xr.getSession()?.end();
  $("status").textContent = "Display lost (memory). Reload the page" + (location.search.includes("res=500") ? "." : ", or open it with ?res=500 (lighter).");
  $("loading").hidden = true;
});
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 500);
camera.position.set(0, 18, 16);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.update();
const rig = new THREE.Group();                            // the user: moved by the sticks, the head moves inside it
rig.add(camera);
scene.add(rig);

const video = $("film");
video.loop = true;
const vtex = new THREE.VideoTexture(video);
vtex.colorSpace = THREE.SRGBColorSpace;
vtex.minFilter = THREE.LinearMipmapLinearFilter;          // mipmaps: no shimmering when seen from a distance
vtex.generateMipmaps = true;
vtex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const world = new THREE.Group();                          // the model, 1 unit = its width; scaled to WIDTH metres
scene.add(world);

// animated relief: surface = terrain node + ice/isostasy change, from two frames blended on the GPU
const H = { meta: null, data: null, years: null, i0: -1 };
const uni = { uBase: { value: null }, uA: { value: null }, uB: { value: null }, uMix: { value: 0 },
  uN: { value: new THREE.Vector2() }, uK: { value: 0 }, uOff: { value: 0 }, uSc: { value: 0 } };

async function gunzip(url, onChunk) {                     // stream-decompress, chunk by chunk (no extra copy)
  let r = null, cache = null;                             // kept in Cache Storage: downloaded once, then offline
  try { cache = await caches.open("stm-relief-v1"); r = await cache.match(url); } catch {}
  if (!r) {
    r = await fetch(url);
    if (r.ok && cache) { try { await cache.put(url, r.clone()); r = await cache.match(url) || r; } catch {} }
  }
  const rd = r.body.pipeThrough(new DecompressionStream("gzip")).getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; onChunk(value); }
}

async function buildRelief() {
  const meta = H.meta = await (await fetch("heights.json")).json();
  H.years = (await (await fetch("film_years.json")).json()).years;
  // all frames in one buffer, filled while downloading (keeps the memory use to the data itself)
  const half = new URLSearchParams(location.search).get("res") === "500";   // lighter mesh if the headset struggles
  const fx = meta.nx, fy = meta.ny, fsize = fx * fy;
  const nx = half ? (fx + 1) >> 1 : fx, ny = half ? (fy + 1) >> 1 : fy;
  H.data = new Uint8Array(meta.n * nx * ny);
  const frame = new Uint8Array(fsize);
  let off = 0, fo = 0, nf = 0;
  for (const part of meta.parts) {
    await gunzip(part, (c) => {
      if (!half) { H.data.set(c, off); off += c.length; }
      else for (let p = 0; p < c.length;) {                // keep every second node of each full frame
        const k = Math.min(c.length - p, fsize - fo);
        frame.set(c.subarray(p, p + k), fo); fo += k; p += k;
        if (fo === fsize) {
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) H.data[(nf * ny + j) * nx + i] = frame[2 * j * fx + 2 * i];
          fo = 0; nf++;
        }
      }
      $("loading").textContent = `… ${Math.round((100 * (half ? nf * fsize : off)) / (meta.n * fsize))} %`;
    });
  }
  if (half) { meta.nx = nx; meta.ny = ny; meta.stride *= 2; }
  const NX = meta.nx, NY = meta.ny, n = NX * NY;
  const t0 = new Int16Array(await (await fetch("terrain.bin")).arrayBuffer()), base = new Float32Array(n);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) base[j * NX + i] = t0[Math.min(j * meta.stride, NY0 - 1) * NX0 + Math.min(i * meta.stride, NX0 - 1)];
  const tex = (data, type) => {
    const t = new THREE.DataTexture(data, NX, NY, THREE.RedFormat, type);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
    return t;
  };
  uni.uBase.value = tex(base, THREE.FloatType);
  uni.uA.value = tex(H.data.slice(0, n), THREE.UnsignedByteType);
  uni.uB.value = tex(H.data.slice(0, n), THREE.UnsignedByteType);
  uni.uN.value.set(NX, NY);
  uni.uK.value = EXAG / 392400;                            // metres of terrain -> model units (width = 1)
  uni.uSc.value = meta.scale; uni.uOff.value = meta.offset;

  const pos = new Float32Array(3 * n), uv = new Float32Array(2 * n);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      pos[3 * k] = i / (NX - 1) - 0.5; pos[3 * k + 2] = (j / (NY - 1) - 0.5) * D;
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
  const mat = new THREE.MeshBasicMaterial({ map: vtex });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
      uniform sampler2D uBase, uA, uB; uniform float uMix, uK, uOff, uSc; uniform vec2 uN; varying float vShade;
      float hAt(ivec2 c) {
        c = clamp(c, ivec2(0), ivec2(uN) - 1);
        float d = mix(texelFetch(uA, c, 0).r, texelFetch(uB, c, 0).r, uMix) * 255.0 * uSc + uOff;
        return (texelFetch(uBase, c, 0).r + d) * uK;
      }`).replace("#include <begin_vertex>", `
      ivec2 c = ivec2(gl_VertexID % int(uN.x), gl_VertexID / int(uN.x));
      vec3 transformed = vec3(position.x, hAt(c), position.z);
      float ex = 2.0 / (uN.x - 1.0), ez = 2.0 * ${D.toFixed(6)} / (uN.y - 1.0);
      vec3 nrm = normalize(vec3(-(hAt(c + ivec2(1, 0)) - hAt(c - ivec2(1, 0))) / ex, 1.0,
                                -(hAt(c + ivec2(0, 1)) - hAt(c - ivec2(0, 1))) / ez));
      vShade = min(1.0, 0.62 + 0.45 * max(0.0, dot(nrm, normalize(vec3(-0.5, 0.8, -0.4)))));`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vShade;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= vShade;");
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  world.add(mesh);
  H.ready = true;
}

const FIX_YEAR = new URLSearchParams(location.search).get("year");   // for tests: freeze the year
function yearNow() {                                      // year shown by the film now
  if (FIX_YEAR !== null) return +FIX_YEAR;
  if (!H.years) return 0;
  return H.years[Math.min(H.years.length - 1, Math.floor(video.currentTime * 20))];
}
function updateRelief() {
  const m = H.meta;
  if (!m || !uni.uA.value) return;
  const f = Math.min(Math.max((yearNow() - m.t0) / m.step, 0), m.n - 1.001), i0 = Math.floor(f), n = m.nx * m.ny;
  if (i0 !== H.i0) {
    uni.uA.value.image.data = H.data.subarray(i0 * n, (i0 + 1) * n); uni.uA.value.needsUpdate = true;
    uni.uB.value.image.data = H.data.subarray((i0 + 1) * n, (i0 + 2) * n); uni.uB.value.needsUpdate = true;
    H.i0 = i0;
  }
  uni.uMix.value = f - i0;
}

// film: kept in Cache Storage, played from a blob (no network needed afterwards)
async function cachedFilm() {
  try { const r = await (await caches.open(FILM_CACHE)).match(FILM); return r ? await r.blob() : null; } catch { return null; }
}
video.addEventListener("loadeddata", () => checkXR());
function useFilm(blob) {
  video.src = URL.createObjectURL(blob);
  $("dl").hidden = true;
  $("pickText").textContent = T.change;
  $("pickLabel").classList.add("small");
  $("pickLabel").hidden = false;
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
  const vr = navigator.xr && await navigator.xr.isSessionSupported("immersive-vr").catch(() => false);
  $("enter").disabled = !(video.src && video.readyState >= 2 && vr && H.ready);   // film decodable, relief loaded
  if (!vr && !$("status").textContent.includes(T.noxr)) $("status").textContent += " " + T.noxr;
}

// XR
const XR = { prev: {}, help: null, helpAt: 0, helpClosed: 0, helpPending: false, last: 0, userPaused: false };
$("enter").onclick = async () => {
  XR.userPaused = false;
  video.play().catch(() => {});                           // must start inside the click
  const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor"] });
  session.addEventListener("select", (e) => {            // trigger: a user gesture, so play() is always allowed
    if (video.paused && !XR.userPaused) { video.play().catch(() => {}); return; }
    if (e.inputSource.handedness !== "right" || XR.help.visible || performance.now() - XR.helpClosed < 500) return;
    XR.userPaused = !video.paused;
    XR.userPaused ? video.pause() : video.play().catch(() => {});
  });
  session.addEventListener("end", () => {
    video.pause(); XR.help.visible = false; document.body.classList.remove("xr");
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); camera.position.set(0, 18, 16); controls.update();
  });
  await renderer.xr.setSession(session);
  renderer.xr.setFoveation?.(1);
  document.body.classList.add("xr");
  resetView();
  XR.helpPending = true;
};

function resetView() {                                    // high above the southern edge, the whole model in front
  world.scale.setScalar(WIDTH);
  world.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  rig.position.set(0, START_HEIGHT, (0.5 * D + 0.12) * WIDTH);
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
// wrist panel: year, play state and position in the film
const P = canvasTex(512, 128);
const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), new THREE.MeshBasicMaterial({ map: P.tex, transparent: true }));
panel.position.set(0, 0.06, -0.06); panel.rotation.x = -0.9;
const fmtYear = (y) => (y < 0 ? "−" : "") + Math.round(Math.abs(y)).toLocaleString("en-US").replace(/,/g, " ");
let lastKey = "";
function drawPanel() {
  const g = P.g, d = video.duration || 0, t = video.currentTime;
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = "rgba(0,0,0,0.85)"; g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#ff7738"; g.font = "bold 44px sans-serif";
  g.fillText(`${video.paused ? "❚❚" : "▶"}  ${fmtYear(yearNow())}`, 20, 60);
  g.fillStyle = "#555"; g.fillRect(20, 92, 472, 12);
  g.fillStyle = "#ff7738"; g.fillRect(20, 92, d ? (472 * t) / d : 0, 12);
  P.tex.needsUpdate = true;
}
// controls card, shown when entering and with B / Y
const HC = canvasTex(1400, 800);
XR.help = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.56), new THREE.MeshBasicMaterial({ map: HC.tex, transparent: true, depthTest: false }));
XR.help.renderOrder = 20; XR.help.visible = false;
scene.add(XR.help);
function showHelp() {
  const g = HC.g, t = T.help;
  g.clearRect(0, 0, 1400, 800);
  g.fillStyle = "rgba(10,14,20,0.92)"; g.beginPath(); g.roundRect(0, 0, 1400, 800, 40); g.fill();
  g.fillStyle = "#ff7738"; g.font = "bold 72px sans-serif"; g.fillText(t[0], 60, 110);
  g.fillStyle = "#fff"; g.font = "44px sans-serif";
  t.slice(1, 6).forEach((l, i) => g.fillText(l, 60, 220 + i * 90, 1280));
  g.fillStyle = "#9fb0c2"; g.font = "38px sans-serif"; g.textAlign = "center"; g.fillText(t[6], 700, 750); g.textAlign = "left";
  HC.tex.needsUpdate = true;
  const xrCam = renderer.xr.getCamera(), head = new THREE.Vector3(), dir = new THREE.Vector3();
  xrCam.getWorldPosition(head); xrCam.getWorldDirection(dir);
  if (head.y < 0.5) head.y += 1.6;                        // no pose yet
  dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1).applyQuaternion(rig.quaternion); dir.normalize();
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

const head = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
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
    if (any && now - XR.helpAt > 800) { XR.help.visible = false; XR.helpClosed = performance.now(); }
    return;
  }
  for (const s of sources) {
    const gp = s.gamepad, [x, y] = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    const sx = Math.abs(x) > 0.15 ? x : 0, sy = Math.abs(y) > 0.15 ? y : 0;
    const boost = gp.buttons[1]?.pressed ? 3 : 1;
    if (pressed(s, 5)) { resetView(); showHelp(); return; }
    if (s.handedness === "left") {                        // walk where you look (horizontal only), speed follows the model size
      if (sx || sy) {
        camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        right.set(-fwd.z, 0, fwd.x);
        const v = 2.5 * (world.scale.x / WIDTH) * boost * dt;
        rig.position.addScaledVector(fwd, -sy * v).addScaledVector(right, sx * v);
      }
    } else {
      if (pressed(s, 4)) { video.currentTime = 0; video.play(); }
      head.setFromMatrixPosition(camera.matrixWorld);
      if (Math.abs(x) > 0.15 && Math.abs(x) > Math.abs(y)) {   // smooth turn around the head
        rig.rotation.y -= x * Math.abs(x) * 1.4 * dt;
        rig.updateMatrixWorld(true);
        const h2 = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
        rig.position.x += head.x - h2.x; rig.position.z += head.z - h2.z;
      }
      if (Math.abs(y) > 0.3 && Math.abs(y) > Math.abs(x)) {       // enlarge / shrink the model around the point under the head
        const k = Math.min(Math.max(1 - y * dt * 0.8, 0.5), 2), w = world.scale.x * k;
        if (w > 3 && w < 300) {
          world.position.x = head.x + (world.position.x - head.x) * k;
          world.position.z = head.z + (world.position.z - head.z) * k;
          world.scale.setScalar(w);
        }
      }
    }
  }
  // stay above the model area
  const w = world.scale.x, lim = 0.6 * w;
  rig.position.x = Math.min(Math.max(rig.position.x, world.position.x - lim), world.position.x + lim);
  rig.position.z = Math.min(Math.max(rig.position.z, world.position.z - lim * D - 0.25 * w), world.position.z + lim * D + 0.25 * w);
}

// ambience around the model, following the film and its soundtrack: ice age (snowy ridges, snow in the wind),
// deglaciation (green hills, forests, herds of various animals, flocks of birds), industrial era (towns, people, a
// steam train, then more and more trains and planes until saturation), and a sky that warms up.
// Silhouettes far away, drawn before everything else so that they never hide the model.
const AMB = { R: 90, layers: [], actors: [], snow: null, sky: null, sun: null };
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const canvas = (w, h, draw) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"), w, h); return cv; };
const ctex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; };

// sky dome: colour gradient, from a cold night to a hot, hazy sky at the end
const skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() } };
AMB.sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthTest: false, depthWrite: false,
  vertexShader: "varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform vec3 uTop, uHor; varying float vY;
    void main(){ gl_FragColor = vec4(mix(uHor, uTop, pow(clamp(vY, 0.0, 1.0), 0.45)), 1.0);
    #include <colorspace_fragment>
    }`,
}));
AMB.sky.renderOrder = -20;
scene.add(AMB.sky);
const SKY = {
  ice: [0x0a111c, 0x3b4d63], green: [0x0c1520, 0x2f4a3c], human: [0x110f14, 0x4b382c], hot: [0x5a2410, 0xe0782c],
};
const cA = new THREE.Color(), cB = new THREE.Color();
function skyColours(cold, green, human, hot) {
  for (const [i, u] of [[0, skyU.uTop], [1, skyU.uHor]]) {
    u.value.set(SKY.green[i]).lerp(cA.set(SKY.ice[i]), cold).lerp(cB.set(SKY.human[i]), human).lerp(cA.set(SKY.hot[i]), hot);
  }
}
// ground around the model, coloured like the landscape of the period
AMB.ground = new THREE.Mesh(new THREE.CircleGeometry(200, 64), new THREE.MeshBasicMaterial({ color: 0x1f2e22, depthTest: false, depthWrite: false }));
AMB.ground.rotation.x = -Math.PI / 2; AMB.ground.renderOrder = -12;
scene.add(AMB.ground);
const GROUND = { ice: 0x66737f, green: 0x1d2b20, human: 0x24201e, hot: 0x4a2f1c };
AMB.sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({
  map: ctex(canvas(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, "rgba(255,250,220,1)"); r.addColorStop(0.12, "rgba(255,220,140,1)");
    r.addColorStop(0.35, "rgba(255,150,60,0.45)"); r.addColorStop(1, "rgba(255,110,40,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  })), transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
AMB.sun.renderOrder = -15;
scene.add(AMB.sun);

function horizonLayer(draw, rot) {                         // panorama wrapped around a cylinder centred on the user
  const m = new THREE.Mesh(new THREE.CylinderGeometry(AMB.R, AMB.R, 40, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: ctex(canvas(4096, 512, draw)), transparent: true, opacity: 0, side: THREE.BackSide,
      depthTest: false, depthWrite: false }));
  m.rotation.y = rot; m.renderOrder = -10;
  scene.add(m); AMB.layers.push(m);
  return m;
}
const ridge = (W, H, base, amp, rough, seed, step = 8) => {
  const pts = [];
  for (let x = 0; x <= W; x += step) {
    let y = 0;
    for (let k = 1; k <= 7; k++) y += Math.sin((x / W) * Math.PI * 2 * (k * 3 + seed) + seed * k * 1.7) * amp / k ** rough;
    pts.push([x, H * base - Math.abs(y)]);
  }
  return pts;
};
const fillProfile = (g, pts, H, style) => {
  g.beginPath(); g.moveTo(0, H); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(pts.at(-1)[0], H); g.closePath();
  g.fillStyle = style; g.fill();
};
function tree(g, x, y, s, kind, col) {
  g.fillStyle = col;
  if (kind) {                                               // conifer
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x, y - s * (2.6 - k * 0.55)); g.lineTo(x - s * (0.5 + k * 0.22), y - s * (1.2 - k * 0.45)); g.lineTo(x + s * (0.5 + k * 0.22), y - s * (1.2 - k * 0.45)); g.fill(); }
    g.fillRect(x - s * 0.08, y - s * 0.4, s * 0.16, s * 0.4);
  } else {                                                  // broadleaf
    g.fillRect(x - s * 0.1, y - s * 0.9, s * 0.2, s * 0.9);
    g.beginPath(); g.arc(x, y - s * 1.4, s * 0.75, 0, 7); g.arc(x - s * 0.5, y - s * 1.1, s * 0.5, 0, 7); g.arc(x + s * 0.5, y - s * 1.1, s * 0.5, 0, 7); g.fill();
  }
}

// side-view silhouettes, facing right, standing on the bottom of the canvas; ph = gait phase (0 / 1)
const INK = "#0b120d";
function legs(g, xs, top, bot, ph, sw, lw) {
  g.lineWidth = lw; g.lineCap = "round"; g.strokeStyle = INK;
  xs.forEach((x, i) => { const d = ((i + ph) % 2 ? 1 : -1) * sw; g.beginPath(); g.moveTo(x, top); g.lineTo(x + d, bot); g.stroke(); });
}
const ANIMALS = {
  deer: { w: 256, h: 192, size: 2.1, speed: 0.045, draw(g, w, h, ph) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(w * 0.45, h * 0.45, w * 0.24, h * 0.13, 0, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 9; g.beginPath(); g.moveTo(w * 0.64, h * 0.4); g.lineTo(w * 0.77, h * 0.2); g.stroke();
    g.beginPath(); g.ellipse(w * 0.81, h * 0.19, w * 0.06, h * 0.05, -0.3, 0, 7); g.fill();
    g.lineWidth = 4; g.beginPath(); g.moveTo(w * 0.79, h * 0.14); g.lineTo(w * 0.73, h * 0.01); g.moveTo(w * 0.75, h * 0.06); g.lineTo(w * 0.68, h * 0.04);
    g.moveTo(w * 0.81, h * 0.13); g.lineTo(w * 0.86, h * 0.02); g.stroke();
    legs(g, [w * 0.3, w * 0.36, w * 0.56, w * 0.62], h * 0.52, h * 0.97, ph, w * 0.07, 6); } },
  horse: { w: 256, h: 192, size: 2.4, speed: 0.05, draw(g, w, h, ph) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(w * 0.45, h * 0.45, w * 0.27, h * 0.14, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(w * 0.62, h * 0.38); g.lineTo(w * 0.8, h * 0.12); g.lineTo(w * 0.92, h * 0.24); g.lineTo(w * 0.86, h * 0.28); g.lineTo(w * 0.74, h * 0.48); g.fill();
    g.strokeStyle = INK; g.lineWidth = 7; g.beginPath(); g.moveTo(w * 0.19, h * 0.42); g.quadraticCurveTo(w * 0.08, h * 0.5, w * 0.1, h * 0.7); g.stroke();
    legs(g, [w * 0.27, w * 0.34, w * 0.56, w * 0.63], h * 0.52, h * 0.98, ph, w * 0.08, 7); } },
  bison: { w: 256, h: 192, size: 2.5, speed: 0.025, draw(g, w, h, ph) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(w * 0.42, h * 0.5, w * 0.27, h * 0.17, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.6, h * 0.36, w * 0.17, h * 0.2, -0.3, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.78, h * 0.56, w * 0.09, h * 0.11, 0.3, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.moveTo(w * 0.8, h * 0.45); g.quadraticCurveTo(w * 0.86, h * 0.36, w * 0.83, h * 0.33); g.stroke();
    legs(g, [w * 0.25, w * 0.32, w * 0.55, w * 0.62], h * 0.6, h * 0.98, ph, w * 0.04, 9); } },
  mammoth: { w: 256, h: 220, size: 4.6, speed: 0.012, until: -11000, draw(g, w, h, ph) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(w * 0.43, h * 0.45, w * 0.29, h * 0.24, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.7, h * 0.3, w * 0.13, h * 0.17, 0, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 12; g.lineCap = "round"; g.beginPath(); g.moveTo(w * 0.8, h * 0.35); g.quadraticCurveTo(w * 0.9, h * 0.6, w * 0.84, h * 0.86); g.stroke();
    g.strokeStyle = "#5b5a52"; g.lineWidth = 6; g.beginPath(); g.moveTo(w * 0.76, h * 0.46); g.quadraticCurveTo(w * 0.98, h * 0.58, w * 0.95, h * 0.36); g.stroke();
    legs(g, [w * 0.24, w * 0.33, w * 0.53, w * 0.62], h * 0.6, h * 0.99, ph, w * 0.03, 16); } },
  wolf: { w: 256, h: 128, size: 1.1, speed: 0.07, draw(g, w, h, ph) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(w * 0.45, h * 0.45, w * 0.24, h * 0.14, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(w * 0.64, h * 0.4); g.lineTo(w * 0.86, h * 0.36); g.lineTo(w * 0.9, h * 0.44); g.lineTo(w * 0.7, h * 0.56); g.fill();
    g.beginPath(); g.moveTo(w * 0.74, h * 0.37); g.lineTo(w * 0.77, h * 0.18); g.lineTo(w * 0.8, h * 0.37); g.fill();
    g.strokeStyle = INK; g.lineWidth = 9; g.beginPath(); g.moveTo(w * 0.22, h * 0.42); g.quadraticCurveTo(w * 0.1, h * 0.5, w * 0.06, h * 0.62); g.stroke();
    legs(g, [w * 0.3, w * 0.36, w * 0.56, w * 0.62], h * 0.55, h * 0.98, ph, w * 0.07, 7); } },
  ibex: { w: 192, h: 192, size: 1.6, speed: 0.03, draw(g, w, h, ph) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(w * 0.45, h * 0.5, w * 0.25, h * 0.13, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.76, h * 0.34, w * 0.08, h * 0.06, -0.4, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 10; g.beginPath(); g.moveTo(w * 0.64, h * 0.46); g.lineTo(w * 0.73, h * 0.36); g.stroke();
    g.lineWidth = 7; g.beginPath(); g.moveTo(w * 0.74, h * 0.3); g.quadraticCurveTo(w * 0.62, h * 0.0, w * 0.5, h * 0.18); g.stroke();
    legs(g, [w * 0.3, w * 0.36, w * 0.56, w * 0.62], h * 0.57, h * 0.98, ph, w * 0.05, 6); } },
  hare: { w: 128, h: 96, size: 0.45, speed: 0.09, draw(g, w, h, ph) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(w * 0.45, h * 0.6, w * 0.25, h * 0.2, ph ? -0.2 : 0.1, 0, 7); g.fill();
    g.beginPath(); g.arc(w * 0.72, h * 0.45, w * 0.1, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.72, h * 0.15, w * 0.04, h * 0.2, 0.3, 0, 7); g.fill();
    legs(g, [w * 0.35, w * 0.6], h * 0.7, h * 0.99, ph, w * 0.1, 6); } },
};
function bird(g, w, h, ph) {
  g.strokeStyle = INK; g.lineWidth = 6; g.lineCap = "round"; g.beginPath();
  const y = ph ? h * 0.2 : h * 0.8;
  g.moveTo(w * 0.05, y); g.quadraticCurveTo(w * 0.3, h * 0.45, w * 0.5, h * 0.55); g.quadraticCurveTo(w * 0.7, h * 0.45, w * 0.95, y); g.stroke();
}

function actor(frames, height, opts) {                      // a sprite that walks / flies around the user
  const texs = frames.map(ctex), cv = frames[0];
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * cv.width / cv.height, height),
    new THREE.MeshBasicMaterial({ map: texs[0], transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  m.renderOrder = -5; m.visible = false;
  m.userData = { texs, f: 0, h: height, ...opts };
  scene.add(m); AMB.actors.push(m);
  return m;
}
function steamTrain(puff) {
  return canvas(1024, 192, (g, w, h) => {
    g.fillStyle = "rgba(170,170,170,0.5)";
    for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(60 + k * 55 + (puff ? 20 : 0), 40 - k * 3 + (puff ? 6 : 0), 18 + k * 5, 0, 7); g.fill(); }
    g.fillStyle = "#121216";
    g.fillRect(20, 95, 140, 70); g.fillRect(40, 60, 24, 38); g.fillRect(115, 70, 45, 30); g.fillRect(165, 105, 70, 60);
    for (let k = 0; k < 4; k++) g.fillRect(245 + k * 150, 90, 140, 75);
    g.fillStyle = "rgba(255,200,110,0.55)"; for (let k = 0; k < 4; k++) for (let j = 0; j < 5; j++) g.fillRect(260 + k * 150 + j * 25, 105, 13, 16);
    g.fillStyle = "#121216"; for (let k = 0; k < 16; k++) { g.beginPath(); g.arc(40 + k * 50, 170, 14, 0, 7); g.fill(); }
  });
}
const modernTrain = () => canvas(1024, 128, (g, w, h) => {
  g.fillStyle = "#16171c";
  g.beginPath(); g.moveTo(980, 110); g.quadraticCurveTo(1020, 105, 1000, 60); g.quadraticCurveTo(960, 25, 880, 25); g.lineTo(10, 25); g.lineTo(10, 110); g.fill();
  g.fillStyle = "rgba(200,225,255,0.6)"; for (let x = 30; x < 870; x += 30) g.fillRect(x, 45, 20, 18);
  g.fillStyle = "rgba(255,90,60,0.7)"; g.fillRect(10, 85, 980, 6);
});
const plane = () => canvas(512, 128, (g, w, h) => {
  const tr = g.createLinearGradient(0, 0, w * 0.6, 0); tr.addColorStop(0, "rgba(220,220,220,0)"); tr.addColorStop(1, "rgba(220,220,220,0.45)");
  g.fillStyle = tr; g.fillRect(0, 58, w * 0.62, 6);
  g.fillStyle = "#15161a"; g.beginPath(); g.ellipse(w * 0.8, h * 0.5, w * 0.17, h * 0.08, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(w * 0.78, h * 0.5); g.lineTo(w * 0.72, h * 0.9); g.lineTo(w * 0.84, h * 0.5); g.fill();
  g.beginPath(); g.moveTo(w * 0.66, h * 0.48); g.lineTo(w * 0.63, h * 0.2); g.lineTo(w * 0.7, h * 0.48); g.fill();
});
const person = (ph) => canvas(64, 160, (g, w, h) => {
  g.fillStyle = "#121216"; g.beginPath(); g.arc(w / 2, h * 0.12, w * 0.16, 0, 7); g.fill();
  g.fillRect(w * 0.36, h * 0.22, w * 0.28, h * 0.4);
  g.strokeStyle = "#121216"; g.lineWidth = 7; g.lineCap = "round"; const d = ph ? 0.18 : 0.05;
  g.beginPath(); g.moveTo(w * 0.45, h * 0.6); g.lineTo(w * (0.5 - d), h); g.moveTo(w * 0.55, h * 0.6); g.lineTo(w * (0.5 + d), h); g.stroke();
});

function buildAmbience() {
  AMB.ice = horizonLayer((g, W, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "rgba(120,140,165,0)"); sky.addColorStop(0.7, "rgba(120,140,165,0.25)");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    fillProfile(g, ridge(W, H, 0.74, 95, 0.75, 1.3, 4), H, "#5d6b7a");
    const snow = g.createLinearGradient(0, H * 0.45, 0, H); snow.addColorStop(0, "#d3dde7"); snow.addColorStop(1, "#7d8b99");
    fillProfile(g, ridge(W, H, 0.84, 60, 0.9, 2.7, 4), H, snow);
  }, 0);
  AMB.hills = horizonLayer((g, W, H) => {
    fillProfile(g, ridge(W, H, 0.78, 45, 1.2, 0.6), H, "#2c4433");
    for (let x = 0; x < W; x += 6 + rnd() * 10) tree(g, x, H * 0.78 - 8 - rnd() * 22, 5 + rnd() * 6, rnd() < 0.6, "#1f3326");
    fillProfile(g, ridge(W, H, 0.88, 18, 1.8, 4.1), H, "#203124");
    for (let x = 0; x < W; x += 14 + rnd() * 40) tree(g, x, H * 0.88 - rnd() * 8, 9 + rnd() * 14, rnd() < 0.5, "#16241a");
  }, 0.7);
  AMB.town = horizonLayer((g, W, H) => {
    const haze = g.createLinearGradient(0, H * 0.4, 0, H); haze.addColorStop(0, "rgba(150,110,80,0)"); haze.addColorStop(1, "rgba(150,110,80,0.3)");
    g.fillStyle = haze; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W;) {
      const bw = 14 + rnd() * 34, bh = (20 + rnd() * 110) * (((x / W * 7) % 1) < 0.55 ? 1 : 0.3);
      g.fillStyle = "#17161a"; g.fillRect(x, H * 0.88 - bh, bw, bh + H * 0.12);
      g.fillStyle = "rgba(255,200,110,0.55)";
      for (let wy = H * 0.88 - bh + 6; wy < H * 0.86; wy += 9) for (let wx = x + 3; wx < x + bw - 3; wx += 6) if (rnd() < 0.25) g.fillRect(wx, wy, 2, 3);
      if (rnd() < 0.08) { g.fillStyle = "#17161a"; g.fillRect(x + bw / 2, H * 0.88 - bh - 45, 6, 45); }
      x += bw + rnd() * 8;
    }
  }, 1.9);

  // herds: several species and sizes, at various distances and speeds
  const herd = ["deer", "deer", "deer", "horse", "horse", "horse", "bison", "bison", "bison", "bison", "mammoth", "mammoth", "mammoth",
    "wolf", "wolf", "wolf", "ibex", "ibex", "hare", "hare", "hare"];
  herd.forEach((sp, i) => {
    const A = ANIMALS[sp], frames = [0, 1].map((ph) => canvas(A.w, A.h, (g, w, h) => A.draw(g, w, h, ph)));
    const dir = i % 4 === 0 ? -1 : 1, r = AMB.R - 3 - rnd() * 14;
    actor(frames, A.size * (0.8 + rnd() * 0.4), { kind: "green", a: rnd() * 6.28, w: dir * A.speed * (0.7 + rnd() * 0.6) * 80 / r,
      y: 0, r, flip: -dir, gait: sp === "mammoth" || sp === "bison" ? 420 : 170, until: A.until });
  });
  // flocks of birds
  for (let f = 0; f < 4; f++) {
    const a0 = rnd() * 6.28, y0 = 14 + rnd() * 20, dir = f % 2 ? 1 : -1;
    for (let i = 0; i < 6 + f * 2; i++) {
      const frames = [0, 1].map((ph) => canvas(128, 64, (g, w, h) => bird(g, w, h, ph)));
      actor(frames, 0.5 + rnd() * 0.3, { kind: "green", a: a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.012, w: dir * 0.06,
        y: y0 + Math.ceil(i / 2) * 0.8 * (rnd() * 0.4 + 0.8), r: AMB.R - 10, flip: -dir, gait: 220, fly: true });
    }
  }
  // people: more and more
  for (let i = 0; i < 40; i++) {
    const frames = [0, 1].map(person), dir = rnd() < 0.5 ? -1 : 1;
    actor(frames, 1.7, { kind: "human", rank: i / 40, a: rnd() * 6.28, w: dir * 0.012, y: 0, r: AMB.R - 4 - rnd() * 8, gait: 300 });
  }
  // trains: a steam train first, then more and more, faster and modern
  const steam = [0, 1].map(steamTrain), modern = [modernTrain()];
  for (let i = 0; i < 24; i++) {
    const dir = i % 2 ? -1 : 1;
    actor(i < 3 ? steam : modern, i < 3 ? 2.6 : 1.8, { kind: "human", rank: i < 3 ? i * 0.04 : 0.08 + (i / 24) * 0.92,
      a: rnd() * 6.28, w: dir * (i < 3 ? 0.035 : 0.06 + rnd() * 0.05), y: 0, r: AMB.R - 2 - (i % 6) * 1.6, flip: -dir, gait: 600,
      steam: i < 3, speedUp: true });
  }
  // planes from the mid-20th century
  for (let i = 0; i < 14; i++) {
    const dir = i % 2 ? -1 : 1;
    actor([plane()], 1.6, { kind: "human", rank: 0.35 + (i / 14) * 0.65, a: rnd() * 6.28, w: dir * (0.08 + rnd() * 0.05), y: 16 + rnd() * 24,
      r: AMB.R - 8, flip: -dir, fly: true, speedUp: true });
  }
  // snow in the wind (ice age), around the user
  const n = 2500, p = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { p[3 * i] = (Math.random() - 0.5) * 60; p[3 * i + 1] = Math.random() * 20; p[3 * i + 2] = (Math.random() - 0.5) * 60; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(p, 3));
  AMB.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xe8f0ff, size: 0.05, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(AMB.snow);
}

const camPos = new THREE.Vector3();
function updateAmbience(year, dt, now) {
  const cold = 1 - smooth(-16000, -11500, year), human = smooth(1850, 1950, year), green = (1 - cold) * (1 - human);
  const hot = smooth(1960, 2100, year), busy = smooth(1880, 2100, year);   // how far into the industrial era
  camera.getWorldPosition(camPos);
  AMB.sky.position.copy(camPos);
  skyColours(cold, green, human, hot);
  AMB.ground.position.set(camPos.x, 0, camPos.z);
  AMB.ground.material.color.set(GROUND.green).lerp(cA.set(GROUND.ice), cold).lerp(cB.set(GROUND.human), human).lerp(cA.set(GROUND.hot), hot);
  const ground = 0;
  for (const m of AMB.layers) m.position.set(camPos.x, ground + 14, camPos.z);
  AMB.ice.material.opacity = 0.6 * cold; AMB.hills.material.opacity = 0.75 * green; AMB.town.material.opacity = 0.7 * human;
  // the sun grows and warms the sky at the end
  AMB.sun.material.opacity = hot;
  AMB.sun.position.set(camPos.x - 120, 25 + 10 * hot, camPos.z - 140);
  AMB.sun.lookAt(camPos); AMB.sun.scale.setScalar(0.6 + 0.8 * hot);

  for (const m of AMB.actors) {
    const u = m.userData;
    let op = u.kind === "green" ? 0.8 * green : (busy >= u.rank ? 0.75 * human : 0);
    if (u.until !== undefined && year > u.until) op *= 1 - smooth(u.until, u.until + 1500, year);
    if (u.steam) op *= 1 - smooth(1930, 1970, year);     // steam trains disappear
    m.visible = op > 0.01;
    if (!m.visible) continue;
    u.a += u.w * dt * (u.speedUp ? 1 + 2.5 * busy : 1);
    const bob = u.fly ? 0.3 * Math.sin(now / 700 + u.a * 30) : 0;
    m.position.set(camPos.x + Math.sin(u.a) * u.r, ground + u.y + bob + u.h / 2, camPos.z + Math.cos(u.a) * u.r);
    m.lookAt(camPos.x, m.position.y, camPos.z);
    m.scale.x = u.flip || 1;
    m.material.opacity = op;
    if (u.texs.length > 1) {                              // gait / wing beat / smoke: alternate two drawings
      const f = Math.floor(now / u.gait + u.a * 10) % 2;
      if (f !== u.f) { u.f = f; m.material.map = u.texs[f]; }
    }
  }
  // snow drifting in the wind
  AMB.snow.material.opacity = 0.75 * cold;
  AMB.snow.visible = cold > 0.02;
  if (AMB.snow.visible) {
    const a = AMB.snow.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      a[i] += (2.5 + Math.sin(now / 900 + i) * 0.8) * dt; a[i + 1] -= 0.9 * dt; a[i + 2] += 0.6 * dt;
      if (a[i + 1] < 0) a[i + 1] += 20;
      if (a[i] > 30) a[i] -= 60;
      if (a[i + 2] > 30) a[i + 2] -= 60;
    }
    AMB.snow.geometry.attributes.position.needsUpdate = true;
    AMB.snow.position.set(camPos.x, Math.max(0, camPos.y - 10), camPos.z);
  }
}
buildAmbience();

let lastNow = 0;
renderer.setAnimationLoop((now, frame) => {
  const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.1) : 0;
  lastNow = now;
  updateRelief();
  updateAmbience(yearNow(), dt, now);
  if (frame) {
    xrUpdate(now, frame);
    const key = `${Math.floor(video.currentTime * 4)}${video.paused}`;
    if (key !== lastKey) { lastKey = key; drawPanel(); }
  } else controls.update();
  renderer.render(scene, camera);
});
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// 2D preview (computer): the model seen from above; double click to play / pause
world.scale.setScalar(WIDTH);
renderer.domElement.addEventListener("dblclick", () => { if (video.src) video.paused ? video.play() : video.pause(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
await buildRelief();
$("loading").hidden = true;
const blob = await cachedFilm();
if (blob) useFilm(blob);
else { $("pickLabel").hidden = false; $("status").textContent = ""; checkXR(); }
