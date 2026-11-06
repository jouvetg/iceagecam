// Swiss Time Machine 3D viewer: IGM ice-surface heights displaced on the GPU, GlacierGAN texture draped on top.
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { t as tr, lang, setLang, onLangChange } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const pad = (k) => String(k).padStart(4, "0");
const fmt = (x) => Math.round(x).toLocaleString("en-US").replace(/,/g, " ");

// data location
// data URL template from config.js (or ?data=…), "{name}" = file name
const DATA = new URLSearchParams(location.search).get("data") || (window.ALPS3D_CONFIG && window.ALPS3D_CONFIG.data) || "data/{name}";
const url = (name) => DATA.replace("{name}", name);

let meta;
try { meta = await (await fetch(url("meta.json"))).json(); }
catch {
  try { meta = await (await fetch(url("meta_base.json"))).json(); }
  catch (e) {
    $("loading").textContent = "The data could not be loaded. Please try again later.";
    throw new Error(`no data at ${url("meta.json")}`);
  }
}

// optional "More info" button and logos (config.js: home, logos)
if (window.ALPS3D_CONFIG?.home) {
  const { home, logos = [] } = window.ALPS3D_CONFIG;
  const box = document.createElement("div");
  box.id = "brand";
  box.innerHTML = `<a class="back" href="${home}" data-i18n="back"></a>`
    + logos.map((l) => `<a href="${l.href || home}"${l.href ? ' target="_blank"' : ""}><img src="${l.src}" alt="${l.alt || ""}"></a>`).join("");
  document.body.appendChild(box);
}
// packed files read by byte range (web), or one file per frame (local)
const PACKS = meta.packs || null;
const [XMIN, YMIN, XMAX, YMAX] = meta.bounds;
const W = (XMAX - XMIN) / 1000, D = (YMAX - YMIN) / 1000;            // scene units: km
const NF = meta.times.length;
// grid index (cell centres) = uv * A + B
const LEVELS = [
  { nx: meta.nx, ny: meta.ny, A: [meta.nx - 1, meta.ny - 1], B: [0, 0], tex: "tex0", h: "h0" },       // 250 m + full texture
  { nx: meta.nx1, ny: meta.ny1, A: [meta.nx1 - 1, meta.ny1 - 1], B: [0, 0], tex: "tex1", h: "h1" },   // 500 m + half texture
];
// optional native 125 m grid
if (meta.native && (PACKS ? PACKS.native : (await fetch(url("base00.bin.gz"), { method: "HEAD" }).catch(() => null))?.ok))
  LEVELS[2] = { ...meta.native, tex: "tex0", h: "h00" };

// loading
async function gunzip(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
const unzip = (bytes) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
async function fetchRange(name, start, len) {
  const r = await fetch(url(name), { headers: { Range: `bytes=${start}-${start + len - 1}` } });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  const buf = await r.arrayBuffer();
  return r.status === 206 ? buf : buf.slice(start, start + len);   // server ignored the Range header
}

// priority queue: user requests before prefetching
const MAXC = 6;
let active = 0, seq = 0;
const queue = [];
function schedule(fn, prio) {
  return new Promise((res, rej) => { queue.push({ fn, prio, s: seq++, res, rej }); pump(); });
}
function pump() {
  while (active < MAXC && queue.length) {
    let b = 0;
    for (let i = 1; i < queue.length; i++)
      if (queue[i].prio > queue[b].prio || (queue[i].prio === queue[b].prio && queue[i].s > queue[b].s)) b = i;
    const job = queue.splice(b, 1)[0];
    active++;
    job.fn().then(job.res, job.rej).finally(() => { active--; pump(); });
  }
}

// decode an image before showing it (no flicker)
async function decoded(src) {
  const im = new Image();
  im.src = src;
  try { await im.decode(); } catch {}
  return src;
}

async function loadFiles(level, k) {
  const L = LEVELS[level];
  const [buf, img, tl] = await Promise.all([
    gunzip(url(`${L.h}/${pad(k)}.bin.gz`)),
    fetch(url(`${L.tex}/${pad(k)}.jpg`)).then((r) => r.blob()).then((b) => createImageBitmap(b)),
    decoded(url(`timeline/${pad(k)}.png`)),
  ]);
  return { buf, img, tl };
}

// playback frames are fetched in blocks; paused full-resolution frames one by one
const blocks = new Map();
function playBlock(b) {
  let p = blocks.get(b);
  if (p) { blocks.delete(b); blocks.set(b, p); return p; }
  const P = PACKS.play, fr = P.frames, k0 = b * P.block, k1 = Math.min(fr.length, k0 + P.block) - 1;
  const start = fr[k0][1], end = fr[k1][1] + fr[k1].slice(2).reduce((a, x) => a + x, 0);
  p = fetchRange(P.files[fr[k0][0]], start, end - start).then((buf) => ({ start, buf }));
  p.catch(() => blocks.delete(b));
  blocks.set(b, p);
  while (blocks.size > 4) blocks.delete(blocks.keys().next().value);
  return p;
}
const jpeg = (bytes) => createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
async function loadPacked(level, k) {
  if (level === 1) {
    const f = PACKS.play.frames[k], b = Math.floor(k / PACKS.play.block), [lh, lt, ll] = f.slice(2);
    const { start, buf } = state.playing || blocks.has(b) ? await playBlock(b)
      : { start: f[1], buf: await fetchRange(PACKS.play.files[f[0]], f[1], lh + lt + ll) };
    const o = f[1] - start;
    const [hb, img, tl] = await Promise.all([
      unzip(new Uint8Array(buf, o, lh)),
      jpeg(new Uint8Array(buf, o + lh, lt)),
      decoded(URL.createObjectURL(new Blob([new Uint8Array(buf, o + lh + lt, ll)], { type: "image/png" }))),
    ]);
    return { buf: hb, img, tl };
  }
  const nq = PACKS.native?.frames[k];
  if (level === 2 && PACKS.native.parts.includes("tex0")) {
    const all = await fetchRange(PACKS.native.files[nq[0]], nq[1], nq[2] + nq[3]);
    const [hb, img] = await Promise.all([unzip(new Uint8Array(all, 0, nq[2])), jpeg(new Uint8Array(all, nq[2], nq[3]))]);
    return { buf: hb, img, tl: null };
  }
  const q = PACKS.hq.frames[k];
  if (level === 0) {
    const all = await fetchRange(PACKS.hq.files[q[0]], q[1], q[2] + q[3]);
    const [hb, img] = await Promise.all([unzip(new Uint8Array(all, 0, q[2])), jpeg(new Uint8Array(all, q[2], q[3]))]);
    return { buf: hb, img, tl: null };
  }
  const [hb, img] = await Promise.all([
    fetchRange(PACKS.native.files[nq[0]], nq[1], nq[2]).then(unzip),
    fetchRange(PACKS.hq.files[q[0]], q[1] + q[2], q[3]).then(jpeg),
  ]);
  return { buf: hb, img, tl: null };
}

const cache = new Map();          // "level:k" -> {p, data}
const CACHE_MAX = [3, 60, 2];
function frame(level, k, prio = 1e6) {
  const key = `${level}:${k}`;
  let e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); return e.p; }
  e = {};
  const L = LEVELS[level], n = L.nx * L.ny;
  e.p = schedule(async () => {
    await ensureLevel(level);
    const { buf, img, tl } = await (PACKS ? loadPacked(level, k) : loadFiles(level, k));
    e.data = { level, k, d: new Int16Array(buf, 0, n), thk: new Uint16Array(buf, 2 * n, n), vel: new Uint16Array(buf, 4 * n, n), img, tl };
    return e.data;
  }, prio);
  e.p.catch(() => cache.delete(key));
  cache.set(key, e);
  trim(level);
  return e.p;
}
function trim(level) {
  const keys = [...cache.keys()].filter((k) => k.startsWith(level + ":"));
  for (let i = 0; i < keys.length - CACHE_MAX[level]; i++) {
    const e = cache.get(keys[i]);
    if (e.data && (e.data === shown || e.data === shownNext)) continue;
    if (e.data) e.data.img.close?.();
    if (e.data?.tl?.startsWith("blob:") && $("timeline").getAttribute("src") !== e.data.tl) URL.revokeObjectURL(e.data.tl);
    cache.delete(keys[i]);
  }
}

// bed at t0 (int16, 250 m) and its 500 m subsample
const base0 = new Int16Array(await gunzip(url("base.bin.gz")));
const base1 = new Int16Array(LEVELS[1].nx * LEVELS[1].ny);
for (let j = 0; j < LEVELS[1].ny; j++)
  for (let i = 0; i < LEVELS[1].nx; i++) base1[j * LEVELS[1].nx + i] = base0[2 * j * meta.nx + 2 * i];
const BASES = [base0, base1, null];
async function ensureLevel(level) {     // native level: bed + GPU buffers created on first use
  if (!BASES[level]) BASES[level] = new Int16Array(await gunzip(url("base00.bin.gz")));
  GPU[level] ??= makeLevelTextures(LEVELS[level]);
}

// renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
$("scene").appendChild(renderer.domElement);
const floatLinear = renderer.extensions.has("OES_texture_float_linear");
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 300, 1500);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.2, 6000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 3;
controls.maxDistance = 1200;
controls.screenSpacePanning = false;

// two GPU slots per level: current and next frame (blended during playback)
function makeSlot(L) {
  const n = L.nx * L.ny;
  const H = new Float32Array(n), ICE = new Float32Array(2 * n);
  const filt = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
  const hTex = new THREE.DataTexture(H, L.nx, L.ny, THREE.RedFormat, THREE.FloatType);
  const iTex = new THREE.DataTexture(ICE, L.nx, L.ny, THREE.RGFormat, THREE.FloatType);
  for (const t of [hTex, iTex]) { t.magFilter = t.minFilter = filt; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  const cTex = new THREE.Texture();
  cTex.colorSpace = THREE.SRGBColorSpace;
  cTex.flipY = false;
  cTex.anisotropy = maxAniso;
  cTex.minFilter = THREE.LinearMipmapLinearFilter;
  cTex.generateMipmaps = true;
  return { H, ICE, hTex, iTex, cTex, f: null };
}
function makeLevelTextures(L) {
  return { slots: [makeSlot(L), makeSlot(L)], size: new THREE.Vector2(L.nx, L.ny), map: new THREE.Vector4(...L.A, ...L.B) };
}
const GPU = [makeLevelTextures(LEVELS[0]), makeLevelTextures(LEVELS[1]), null];

// colour maps (stored linear)
const ramps = {
  1: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b", "#1a0b3d"],          // thickness 0-2000 m
  2: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],          // speed 1-1000 m/a (log)
};
const lutData = new Uint8Array(256 * 2 * 4);
[1, 2].forEach((m, row) => {
  const cs = ramps[m].map((h) => new THREE.Color(h));   // Color() converts sRGB hex -> linear
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (cs.length - 1), a = Math.min(Math.floor(x), cs.length - 2), f = x - a;
    const c = cs[a].clone().lerp(cs[a + 1], f);
    lutData.set([c.r * 255, c.g * 255, c.b * 255, 255], (row * 256 + i) * 4);
  }
});
const lut = new THREE.DataTexture(lutData, 256, 2);
lut.magFilter = lut.minFilter = THREE.LinearFilter;
lut.needsUpdate = true;

const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
  uH: { value: null }, uIce: { value: null }, uTex: { value: null }, uLut: { value: lut },
  uH2: { value: null }, uIce2: { value: null }, uTex2: { value: null }, uMix: { value: 0 },
  uHSize: { value: new THREE.Vector2(1, 1) }, uMap: { value: new THREE.Vector4(1, 1, 0, 0) }, uSize: { value: new THREE.Vector2(W, D) },
  uExag: { value: 2.5 }, uBottom: { value: -6 }, uMode: { value: 0 }, uOpacity: { value: 0.75 },
  uShade: { value: 0 }, uSun: { value: new THREE.Vector3() },
}]);

const material = new THREE.ShaderMaterial({
  uniforms, fog: true, side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    uniform sampler2D uH, uH2; uniform vec2 uHSize, uSize; uniform vec4 uMap; uniform float uExag, uBottom, uMix;
    attribute float aSkirt;
    varying vec2 vUv; varying vec3 vN; varying float vSkirt, vY;
    #include <fog_pars_vertex>
    float hAt(vec2 uv) {
      vec2 t = (uv * uMap.xy + uMap.zw + 0.5) / uHSize;
      float h = texture2D(uH, t).r;
      return uMix > 0.0 ? mix(h, texture2D(uH2, t).r, uMix) : h;
    }
    void main() {
      vUv = uv; vSkirt = aSkirt;
      float s = uExag / 1000.0;
      vec2 e = 1.0 / uMap.xy;
      float h = hAt(uv);
      float hl = hAt(uv - vec2(e.x, 0.0)), hr = hAt(uv + vec2(e.x, 0.0));
      float hn = hAt(uv - vec2(0.0, e.y)), hs = hAt(uv + vec2(0.0, e.y));
      vN = normalize(vec3(-(hr - hl) * s / (2.0 * e.x * uSize.x), 1.0, -(hs - hn) * s / (2.0 * e.y * uSize.y)));
      vec3 p = vec3((uv.x - 0.5) * uSize.x, h * s, (uv.y - 0.5) * uSize.y);
      if (aSkirt > 1.5) p.y = uBottom;
      vY = p.y;
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uTex, uIce, uLut, uTex2, uIce2; uniform vec2 uHSize; uniform vec4 uMap; uniform int uMode;
    uniform float uOpacity, uShade, uBottom, uMix; uniform vec3 uSun;
    varying vec2 vUv; varying vec3 vN; varying float vSkirt, vY;
    #include <fog_pars_fragment>
    void main() {
      vec3 col;
      if (vSkirt > 0.5) {
        col = mix(vec3(0.035, 0.03, 0.028), vec3(0.16, 0.14, 0.12), clamp((vY - uBottom) / (-uBottom + 1.0), 0.0, 1.0));
      } else {
        col = texture2D(uTex, vUv).rgb;
        if (uMix > 0.0) col = mix(col, texture2D(uTex2, vUv).rgb, uMix);
        if (uMode > 0) {
          vec2 it = (vUv * uMap.xy + uMap.zw + 0.5) / uHSize;
          vec2 ice = texture2D(uIce, it).rg;
          if (uMix > 0.0) ice = mix(ice, texture2D(uIce2, it).rg, uMix);
          float a = uMode == 1 ? clamp(ice.r / 2000.0, 0.0, 1.0)
                               : clamp(log(max(ice.g, 1.0)) / log(1000.0), 0.0, 1.0);
          vec3 c = texture2D(uLut, vec2(a, uMode == 1 ? 0.25 : 0.75)).rgb;
          col = mix(col, c, uOpacity * smoothstep(0.5, 8.0, ice.r));
        }
        float d = max(dot(normalize(vN), uSun), 0.0);
        col *= mix(1.0, 0.45 + 0.85 * d, uShade);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});

// grid mesh with side skirts; vertices at the cell centres plus the domain edges
function gridUV(n, A, B) {
  const out = [0];
  for (let i = 0; i < n; i++) { const u = (i - B) / A; if (u > 1e-6 && u < 1 - 1e-6) out.push(u); }
  out.push(1);
  return out;
}
function buildGeometry(L) {
  const us = gridUV(L.nx, L.A[0], L.B[0]), vs = gridUV(L.ny, L.A[1], L.B[1]);
  const mx = us.length, my = vs.length;
  const nMain = mx * my, nEdge = 2 * (mx + my) - 4;
  const uv = new Float32Array((nMain + 2 * nEdge) * 2), sk = new Float32Array(nMain + 2 * nEdge);
  for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const v = j * mx + i; uv[2 * v] = us[i]; uv[2 * v + 1] = vs[j];
  }
  const idx = new Uint32Array(((mx - 1) * (my - 1) + nEdge) * 6);
  let q = 0;
  for (let j = 0; j < my - 1; j++) for (let i = 0; i < mx - 1; i++) {
    const a = j * mx + i, b = a + 1, c = a + mx, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const ring = [];
  for (let i = 0; i < mx; i++) ring.push([i, 0]);
  for (let j = 1; j < my; j++) ring.push([mx - 1, j]);
  for (let i = mx - 2; i >= 0; i--) ring.push([i, my - 1]);
  for (let j = my - 2; j > 0; j--) ring.push([0, j]);
  ring.forEach(([i, j], r) => {
    const t = nMain + 2 * r, b = t + 1;
    uv.set([us[i], vs[j]], 2 * t); uv.set([us[i], vs[j]], 2 * b);
    sk[t] = 1; sk[b] = 2;
    const r2 = (r + 1) % ring.length, t2 = nMain + 2 * r2, b2 = t2 + 1;
    idx[q++] = t; idx[q++] = b; idx[q++] = t2; idx[q++] = t2; idx[q++] = b; idx[q++] = b2;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(uv.length / 2 * 3), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aSkirt", new THREE.BufferAttribute(sk, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
const terrain = new THREE.Mesh(buildGeometry(LEVELS[0]), material);
terrain.frustumCulled = false;
scene.add(terrain);

// Swiss border
const borderGeo = new THREE.BufferGeometry();
borderGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(meta.border.length * 3), 3));
const border = new THREE.LineLoop(borderGeo, new THREE.LineBasicMaterial({ color: 0xff7738, fog: true }));
border.frustumCulled = false;
scene.add(border);

// state
const state = { k: 0, level: 1, playing: false, mode: 0, exag: 2.5, fps: 10 };
let shown = null;           // frame data currently on the GPU
let shownNext = null;       // next frame, blended in during playback (uMix)
let cur = null;             // {L, H, thk, vel} for picking (CPU copy of what is shown)

function heightAt(u, v) {   // bilinear, metres, on currently shown grid (blended like the GPU)
  if (!cur) return 0;
  const { nx, ny, A, B } = cur.L;
  const x = Math.min(Math.max(u * A[0] + B[0], 0), nx - 1), y = Math.min(Math.max(v * A[1] + B[1], 0), ny - 1);
  const i = Math.min(Math.floor(x), nx - 2), j = Math.min(Math.floor(y), ny - 2), fx = x - i, fy = y - j, a = j * nx + i;
  const at = (H) => (H[a] * (1 - fx) + H[a + 1] * fx) * (1 - fy) + (H[a + nx] * (1 - fx) + H[a + nx + 1] * fx) * fy;
  const m = uniforms.uMix.value;
  return m > 0 ? at(cur.H) * (1 - m) + at(cur.H2) * m : at(cur.H);
}
const s = () => state.exag / 1000;

function upload(slot, f, base, n) {
  for (let i = 0; i < n; i++) {
    slot.H[i] = base[i] + f.d[i];
    slot.ICE[2 * i] = f.thk[i]; slot.ICE[2 * i + 1] = f.vel[i];
  }
  slot.hTex.needsUpdate = true; slot.iTex.needsUpdate = true;
  slot.cTex.image = f.img; slot.cTex.needsUpdate = true;
  slot.f = f;
}
// show frame f, blended towards fb with uMix (slots are reused to avoid re-uploads)
function apply(f, fb = null) {
  const L = LEVELS[f.level], G = GPU[f.level], base = BASES[f.level], n = L.nx * L.ny;
  if (G.slots[0].f !== f && G.slots[1].f === f) G.slots.reverse();
  const [A, B] = G.slots;
  if (A.f !== f) upload(A, f, base, n);
  if (fb && B.f !== fb) upload(B, fb, base, n);
  if (!fb) uniforms.uMix.value = 0;
  const N = fb ? B : A;
  uniforms.uH.value = A.hTex; uniforms.uIce.value = A.iTex; uniforms.uTex.value = A.cTex;
  uniforms.uH2.value = N.hTex; uniforms.uIce2.value = N.iTex; uniforms.uTex2.value = N.cTex;
  uniforms.uHSize.value.copy(G.size);
  uniforms.uMap.value.copy(G.map);
  if (f.tl && $("timeline").getAttribute("src") !== f.tl) $("timeline").src = f.tl;
  shown = f; shownNext = fb;
  cur = { L, H: A.H, H2: N.H, thk: f.thk, vel: f.vel };
  state.shownK = f.k;
  updateBorder();
  updateInfo(f.k);
  $("loading").classList.add("hidden");
}

function updateBorder() {
  const p = borderGeo.attributes.position.array, sc = s();
  meta.border.forEach(([u, v], i) => {
    p[3 * i] = (u - 0.5) * W; p[3 * i + 1] = heightAt(u, v) * sc + 0.06 * state.exag; p[3 * i + 2] = (v - 0.5) * D;
  });
  borderGeo.attributes.position.needsUpdate = true;
}

// time navigation
let want = 0, hqTimer = null;
async function show(k, { hq = true } = {}) {
  k = Math.max(0, Math.min(NF - 1, k));
  want = k; state.k = k;
  updateInfo(k);
  const f = await frame(1, k);
  if (want !== k) return;
  const hl = hqLevel();
  if (!(shown && shown.k === k && shown.level === hl)) apply(f);
  clearTimeout(hqTimer);
  if (hq && hl !== null && $("hq").checked && !state.playing)
    hqTimer = setTimeout(async () => {
      const g = await frame(hl, k);
      if (want === k && !state.playing) apply(g);
    }, 250);
}

// full-resolution level shown when paused, for the chosen mesh
function hqLevel() {
  if (state.mesh === 1) return null;
  if (PACKS && !PACKS.hq) return LEVELS[2] ? 2 : null;
  return state.mesh;
}

function prefetch(from) {
  for (let i = 1; i <= 24; i++) {
    let k = from + i;
    if (k >= NF) k -= NF;
    frame(1, k, -i);
  }
}

// playback: fractional frame index, frames k and k+1 blended; waits for data instead of skipping
const ready = (level, k) => cache.get(`${level}:${k}`)?.data;
let playPos = 0, lastNow = null;
function tickPlayback(now) {
  if (!state.playing) { lastNow = null; return; }
  const dt = lastNow === null ? 0 : Math.min((now - lastNow) / 1000, 0.25);
  lastNow = now;
  const k = Math.floor(playPos);
  const k1 = k + 1 < NF ? k + 1 : 0;
  const fa = ready(1, k), fb = ready(1, k1);
  if (!fa || !fb) { frame(1, k, 1e6); frame(1, k1, 1e6); return; }
  playPos += dt * state.fps;
  if (playPos >= k + 1) {
    playPos = k1;
    want = state.k = k1;
    prefetch(k1);
    return;
  }
  if (shown !== fa || shownNext !== fb) apply(fa, fb);
  uniforms.uMix.value = playPos - k;
  want = state.k = k;
  updateInfo(k, times[k] + (playPos - k) * ((k1 ? times[k1] : times[k]) - times[k]));
  updateBorder();
}
const ICON_PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>';
const ICON_PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
$("play").innerHTML = ICON_PLAY;
function setPlaying(p) {
  state.playing = p;
  $("play").innerHTML = p ? ICON_PAUSE : ICON_PLAY;
  if (p) { playPos = state.k; lastNow = null; prefetch(state.k); } else show(state.k);
}

// time display
const times = meta.times, stats = meta.stats;
// film timeline (1200 px wide): x_px = 1075 + 0.03 t
function updateInfo(k, t = times[k]) {
  $("tlMarker").style.left = `${((1075 + 0.03 * t) / 1200) * 100}%`;
}

const nearestK = (t) => times.reduce((b, x, i) => (Math.abs(x - t) < Math.abs(times[b] - t) ? i : b), 0);
{
  const wrap = $("tlWrap");
  const kAt = (e) => {
    const r = $("timeline").getBoundingClientRect();
    return nearestK(((e.clientX - r.left) / r.width * 1200 - 1075) / 0.03);
  };
  let drag = false;
  wrap.addEventListener("pointerdown", (e) => { drag = true; wrap.setPointerCapture(e.pointerId); if (state.playing) setPlaying(false); show(kAt(e)); });
  wrap.addEventListener("pointermove", (e) => { if (drag) show(kAt(e)); });
  wrap.addEventListener("pointerup", () => { drag = false; });
}

// cities
const cityEls = meta.cities.map((c) => {
  const el = document.createElement("div");
  el.className = "city"; el.textContent = tr("cityNames")[c.name] ?? c.name;
  $("labels").appendChild(el);
  return el;
});
const tmpV = new THREE.Vector3();
function updateLabels() {
  const on = $("showCities").checked;
  meta.cities.forEach((c, i) => {
    const el = cityEls[i];
    if (!on) { el.style.display = "none"; return; }
    tmpV.set((c.u - 0.5) * W, heightAt(c.u, c.v) * s() + 0.05, (c.v - 0.5) * D).project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1) { el.style.display = "none"; return; }
    el.style.display = "";
    el.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`;
  });
}

// picking (CPU ray-march)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(cx, cy) {
  if (!cur) return null;
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction, sc = s();
  const box = new THREE.Box3(new THREE.Vector3(-W / 2, -0.5, -D / 2), new THREE.Vector3(W / 2, 4.8 * state.exag, D / 2));
  const p = new THREE.Vector3();
  let t0 = 0;
  if (!box.containsPoint(o)) {
    if (!ray.ray.intersectBox(box, p)) return null;
    t0 = p.distanceTo(o);
  }
  const below = (p) => p.y <= heightAt(p.x / W + 0.5, p.z / D + 0.5) * sc;
  const step = Math.max(0.04, camera.position.distanceTo(controls.target) / 500);
  let prev = t0;
  for (let t = t0; t < t0 + 2000; t += step) {
    p.copy(o).addScaledVector(d, t);
    if (!box.containsPoint(p) && t > t0) return null;
    if (below(p)) {
      let a = prev, b = t;
      for (let i = 0; i < 20; i++) { const m = (a + b) / 2; p.copy(o).addScaledVector(d, m); below(p) ? (b = m) : (a = m); }
      return { u: Math.min(Math.max(p.x / W + 0.5, 0), 1), v: Math.min(Math.max(p.z / D + 0.5, 0), 1) };
    }
    prev = t;
  }
  return null;
}
function utmToLatLon(E, N, zone = 32) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = E - 500000, mu = N / k0 / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C = ep2 * Math.cos(p1) ** 2, T = Math.tan(p1) ** 2, sn = Math.sin(p1);
  const Nn = a / Math.sqrt(1 - e2 * sn * sn), R = a * (1 - e2) / Math.pow(1 - e2 * sn * sn, 1.5), Dd = x / (Nn * k0);
  const lat = p1 - (Nn * Math.tan(p1) / R) * (Dd * Dd / 2 - (5 + 3 * T + 10 * C - 4 * C * C - 9 * ep2) * Dd ** 4 / 24
    + (61 + 90 * T + 298 * C + 45 * T * T - 252 * ep2 - 3 * C * C) * Dd ** 6 / 720);
  const lon = ((zone - 1) * 6 - 177) * Math.PI / 180 + (Dd - (1 + 2 * T + C) * Dd ** 3 / 6
    + (5 - 2 * C + 28 * T - 3 * C * C + 8 * ep2 + 24 * T * T) * Dd ** 5 / 120) / Math.cos(p1);
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}
let mouse = null, pickPending = false;
renderer.domElement.addEventListener("pointermove", (e) => { mouse = [e.clientX, e.clientY]; pickPending = true; });
renderer.domElement.addEventListener("pointerleave", () => { mouse = null; $("readout").classList.add("hidden"); });
function updateReadout() {
  if (!pickPending) return;
  pickPending = false;
  const el = $("readout");
  const hit = mouse && pick(...mouse);
  if (!hit) { el.classList.add("hidden"); return; }
  const { nx, ny, A, B } = cur.L;
  const i = Math.min(Math.max(Math.round(hit.u * A[0] + B[0]), 0), nx - 1);
  const j = Math.min(Math.max(Math.round(hit.v * A[1] + B[1]), 0), ny - 1), q = j * nx + i;
  const E = XMIN + hit.u * (XMAX - XMIN), N = YMAX - hit.v * (YMAX - YMIN), [lat, lon] = utmToLatLon(E, N);
  const thk = cur.thk[q];
  el.innerHTML =
    `<span class="k">${tr("surface")}</span><b>${fmt(heightAt(hit.u, hit.v))} m</b><br>` +
    `<span class="k">${tr("ice")}</span><b>${thk ? fmt(thk) + " m" : "—"}</b><br>` +
    `<span class="k">${tr("vel")}</span><b>${thk ? fmt(cur.vel[q]) + " m/a" : "—"}</b><br>` +
    `<span class="k">${tr("latlon")}</span>${lat.toFixed(3)}°, ${lon.toFixed(3)}°<br>` +
    `<span class="k">UTM 32N</span>${(E / 1000).toFixed(1)}, ${(N / 1000).toFixed(1)} km`;
  el.classList.remove("hidden");
  const x = mouse[0] + 18, y = mouse[1] + 18;
  el.style.left = `${Math.min(x, innerWidth - el.offsetWidth - 8)}px`;
  el.style.top = `${Math.min(y, innerHeight - el.offsetHeight - 8)}px`;
}

// views
// same order as "views" in i18n.js
const VIEWS = {
  overview: { u: 0.5, v: 0.52, dist: 420, az: 0, pol: 0.9 },
  top: { u: 0.5, v: 0.5, dist: 360, az: 0, pol: 0.001 },
  rhone: { u: 0.17, v: 0.68, dist: 120, az: 20, pol: 1.0 },
  valais: { u: 0.36, v: 0.79, dist: 90, az: -50, pol: 1.05 },
  lausanne: { u: 0.21, v: 0.65, dist: 75, az: -40, pol: 1.05 },
  aare: { u: 0.38, v: 0.48, dist: 110, az: 170, pol: 1.0 },
  reuss: { u: 0.53, v: 0.45, dist: 90, az: 160, pol: 1.0 },
  linth: { u: 0.62, v: 0.33, dist: 120, az: 160, pol: 1.0 },
};
let flight = null;
function flyTo(name) {
  const vw = VIEWS[name];
  const tgt = new THREE.Vector3((vw.u - 0.5) * W, heightAt(vw.u, vw.v) * s(), (vw.v - 0.5) * D);
  const az = (vw.az * Math.PI) / 180;
  const pos = tgt.clone().add(new THREE.Vector3(Math.sin(vw.pol) * Math.sin(az), Math.cos(vw.pol), Math.sin(vw.pol) * Math.cos(az)).multiplyScalar(vw.dist));
  flight = { t0: performance.now(), dur: 1600, p0: camera.position.clone(), q0: controls.target.clone(), p1: pos, q1: tgt };
}
function updateFlight(now) {
  if (!flight) return;
  let a = Math.min((now - flight.t0) / flight.dur, 1);
  const e = a < 0.5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2;
  camera.position.lerpVectors(flight.p0, flight.p1, e);
  controls.target.lerpVectors(flight.q0, flight.q1, e);
  if (a >= 1) flight = null;
}
const viewBtns = Object.keys(VIEWS).map((name) => {
  const b = document.createElement("button");
  b.onclick = () => flyTo(name);
  $("views").appendChild(b);
  return b;
});
controls.addEventListener("start", () => { flight = null; });

// UI wiring
function seg(id, cb) {
  const el = $(id);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    cb(+b.dataset.v);
  });
}
seg("mode", (v) => {
  state.mode = uniforms.uMode.value = v;
  $("opacityRow").hidden = v === 0;
  $("legend").classList.toggle("hidden", v === 0);
  if (v) {
    $("legendBar").style.background = `linear-gradient(90deg, ${ramps[v].join(",")})`;
    $("legendTicks").innerHTML = v === 1 ? "<span>0</span><span>500</span><span>1000</span><span>1500</span><span>2000 m</span>"
      : "<span>1</span><span>10</span><span>100</span><span>1000 m/a</span>";
  }
});
let savedMesh = null;
try { savedMesh = localStorage.getItem("alps3d.mesh"); } catch {}
state.mesh = 0;   // 250 m by default
if (!LEVELS[2]) $("meshRes").querySelector('[data-v="2"]').remove();
function setMesh(v) {
  state.mesh = v;
  $("meshRes").querySelectorAll("button").forEach((x) => x.classList.toggle("on", +x.dataset.v === v));
  terrain.geometry.dispose();
  terrain.geometry = buildGeometry(LEVELS[v]);
  try { localStorage.setItem("alps3d.mesh", v); } catch {}
  if (shown && shown.level !== 1 && shown.level !== hqLevel()) frame(1, state.k).then((f) => { if (want === state.k) apply(f); show(state.k); });
  else show(state.k);
}
seg("meshRes", setMesh);
$("opacity").oninput = (e) => (uniforms.uOpacity.value = +e.target.value);
$("shade").oninput = (e) => (uniforms.uShade.value = +e.target.value);
$("sunaz").oninput = setSun;
function setSun() {
  const az = (+$("sunaz").value * Math.PI) / 180, alt = (40 * Math.PI) / 180;
  uniforms.uSun.value.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
}
setSun();
$("exag").oninput = (e) => {
  const old = state.exag;
  state.exag = uniforms.uExag.value = +e.target.value;
  $("exagOut").textContent = state.exag.toFixed(1) + "×";
  controls.target.y *= state.exag / old;
  updateBorder();
};
$("showBorder").onchange = (e) => (border.visible = e.target.checked);
// playback speed
const YEARS_PER_SECOND = 200;
const DT = Math.max(1, Math.round((times[NF - 1] - times[0]) / Math.max(1, NF - 1)));
state.fps = YEARS_PER_SECOND / DT;
$("play").onclick = () => setPlaying(!state.playing);
$("prev").onclick = () => { setPlaying(false); show(state.k - 1); };
$("next").onclick = () => { setPlaying(false); show(state.k + 1); };
$("panelToggle").onclick = () => $("panel").classList.toggle("collapsed");
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const n = e.shiftKey ? 10 : 1;
  if (e.code === "Space") { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === "ArrowRight") { setPlaying(false); show(state.k + n); }
  else if (e.key === "ArrowLeft") { setPlaying(false); show(state.k - n); }
  else if (e.key === "h" || e.key === "H") document.body.classList.toggle("noui");
});
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// language
function relabel() {
  viewBtns.forEach((b, i) => (b.textContent = tr("views")[i]));
  meta.cities.forEach((c, i) => (cityEls[i].textContent = tr("cityNames")[c.name] ?? c.name));
  updateInfo(state.k);
  pickPending = true;
}
onLangChange(relabel);
$("lang").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setLang(b.dataset.v); });
setLang(lang);

// go
// start at the largest ice volume; URL parameters: ?t= &mode= &mesh= &exag= &lang=
const qs = new URLSearchParams(location.search);
let k0 = stats ? stats.reduce((b, st, i) => (st.vol > stats[b].vol ? i : b), 0) : Math.round(NF / 2);
if (qs.has("t")) k0 = nearestK(+qs.get("t"));
state.k = want = k0;
{
  const m = { "125": 2, "250": 0, "500": 1 }[qs.get("mesh")] ?? (savedMesh !== null ? +savedMesh : state.mesh);
  state.mesh = LEVELS[m] ? m : 0;
  if (state.mesh !== 0) { terrain.geometry.dispose(); terrain.geometry = buildGeometry(LEVELS[state.mesh]); }
  $("meshRes").querySelectorAll("button").forEach((x) => x.classList.toggle("on", +x.dataset.v === state.mesh));
}
if (qs.has("mode")) $("mode").children[+qs.get("mode")]?.click();
if (qs.has("exag")) { $("exag").value = qs.get("exag"); $("exag").dispatchEvent(new Event("input")); }
await show(k0, { hq: false });
const vw = VIEWS.overview;
controls.target.set(0, 0.6, 0);
camera.position.set(0, Math.cos(vw.pol) * vw.dist, Math.sin(vw.pol) * vw.dist);
show(k0);

renderer.setAnimationLoop((now) => {
  tickPlayback(now);
  updateFlight(now);
  controls.update();
  const dist = camera.position.distanceTo(controls.target);
  scene.fog.near = dist * 1.2; scene.fog.far = dist * 5;
  renderer.render(scene, camera);
  updateLabels();
  updateReadout();
});
