#!/usr/bin/env node
// Asset pipeline for Beleza HQ: `npm run assets`.
//
// Downloads ONLY from github.com/microsoft/Microsoft-Rocketbox (MIT, via raw.githubusercontent.com)
// and Poly Haven (CC0, api.polyhaven.com / dl.polyhaven.org), converts FBX -> GLB, bakes the shared
// animation clips into every avatar, compresses, and writes public/assets/{people,textures,hdri},
// manifest.json and LICENSES.md. Idempotent: any output that already exists and is valid is skipped.
//
// Needs: Node >= 22, the dev deps in package.json, and `curl` (uses the system trust store, which
// avoids Node TLS problems behind interceptors). Raw working files live in .asset-work/ (gitignored)
// and are processed one avatar at a time so peak disk use stays small.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/assets.config.json'), 'utf8'));
const OUT = path.join(ROOT, 'public/assets');
const WORK = path.join(ROOT, '.asset-work');
const FBX2GLTF = path.join(ROOT, 'node_modules/fbx2gltf/bin', { darwin: 'Darwin', linux: 'Linux', win32: 'Windows' }[process.platform] ?? '', process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');
const RB_RAW = `https://raw.githubusercontent.com/${CONFIG.rocketbox.repo}/${CONFIG.rocketbox.ref}/`;
const ALLOWED_HOSTS = new Set(['raw.githubusercontent.com', 'api.polyhaven.com', 'dl.polyhaven.org']);
const CLIP_NAMES = Object.keys(CONFIG.clips);
const { maxTriangles, avatarTextureSize, minFreeGB, fetchedOn } = CONFIG.limits;

let builtSomething = false;

// ---------------------------------------------------------------- small helpers

const log = (...a) => console.log(...a);
const exists = (p) => fs.existsSync(p) && fs.statSync(p).size > 0;
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });

function download(url, dest) {
  if (!ALLOWED_HOSTS.has(new URL(url).host)) throw new Error(`Refusing to download from ${url}`);
  if (exists(dest)) return;
  ensureDir(path.dirname(dest));
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', `${dest}.part`, url], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.renameSync(`${dest}.part`, dest);
}

function fetchJson(url) {
  if (!ALLOWED_HOSTS.has(new URL(url).host)) throw new Error(`Refusing to download from ${url}`);
  return JSON.parse(execFileSync('curl', ['-fsSL', '--retry', '3', url], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8'));
}

const md5 = (file) => createHash('md5').update(fs.readFileSync(file)).digest('hex');

/** Stop cleanly if the disk is nearly full (work files are large). */
function assertDisk() {
  ensureDir(WORK);
  const kb = Number(execFileSync('df', ['-k', WORK]).toString().trim().split('\n').pop().trim().split(/\s+/)[3]);
  if (kb / 1024 / 1024 < minFreeGB) throw new Error(`BLOCKED: only ${(kb / 1024 / 1024).toFixed(2)} GB free (< ${minFreeGB} GB). Free some space and rerun.`);
}

// ---------------------------------------------------------------- glTF IO

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) n += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(n);
}

/** Read a finished avatar GLB; returns { clips, triangles } or null if it is missing/invalid/incomplete. */
async function inspectPerson(file) {
  if (!exists(file)) return null;
  try {
    const doc = await io.read(file);
    const clips = doc.getRoot().listAnimations().map((a) => a.getName());
    const triangles = triangleCount(doc);
    const complete = CLIP_NAMES.every((c) => clips.includes(c)) && triangles > 0 && triangles <= maxTriangles;
    return complete ? { clips, triangles } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- TGA decoding (sharp/libvips cannot read TGA)

/** Decode uncompressed (2) or RLE (10) 24/32-bit true-colour TGA into a top-down RGBA buffer. */
function decodeTga(buf) {
  const idLen = buf[0], cmapType = buf[1], type = buf[2];
  const width = buf.readUInt16LE(12), height = buf.readUInt16LE(14), bpp = buf[16], desc = buf[17];
  if (cmapType !== 0 || (type !== 2 && type !== 10) || (bpp !== 24 && bpp !== 32)) throw new Error(`Unsupported TGA (type ${type}, ${bpp} bpp)`);
  const bytes = bpp / 8;
  const count = width * height;
  let pos = 18 + idLen;
  let pixels; // BGR(A) in file order
  if (type === 2) {
    pixels = buf.subarray(pos, pos + count * bytes);
  } else {
    pixels = Buffer.alloc(count * bytes);
    let o = 0;
    while (o < pixels.length) {
      const head = buf[pos++];
      const n = (head & 0x7f) + 1;
      if (head & 0x80) {
        for (let i = 0; i < n; i++) { buf.copy(pixels, o, pos, pos + bytes); o += bytes; }
        pos += bytes;
      } else {
        buf.copy(pixels, o, pos, pos + n * bytes);
        o += n * bytes;
        pos += n * bytes;
      }
    }
  }
  const topDown = (desc & 0x20) !== 0;
  const rightToLeft = (desc & 0x10) !== 0;
  const rgba = Buffer.alloc(count * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = (srcRow * width + (rightToLeft ? width - 1 - x : x)) * bytes;
      const d = (y * width + x) * 4;
      rgba[d] = pixels[s + 2];
      rgba[d + 1] = pixels[s + 1];
      rgba[d + 2] = pixels[s];
      rgba[d + 3] = bytes === 4 ? pixels[s + 3] : 255;
    }
  }
  return { rgba, width, height };
}

/** TGA file -> downscaled WebP buffer. */
async function tgaToWebp(file, { alpha, quality }) {
  const { rgba, width, height } = decodeTga(fs.readFileSync(file));
  let img = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (Math.max(width, height) > avatarTextureSize) img = img.resize(avatarTextureSize, avatarTextureSize, { fit: 'inside' });
  if (!alpha) img = img.removeAlpha();
  return img.webp({ quality, alphaQuality: 90 }).toBuffer();
}

// ---------------------------------------------------------------- animation baking

const clipDocs = {}; // `${gender}_${clip}` -> Document
const idleHipHeight = {}; // gender -> hip height (m) of the idle clip, reference for per-avatar scaling

async function loadClips(gender) {
  for (const [name, c] of Object.entries(CONFIG.clips)) {
    const key = `${gender}_${name}`;
    if (clipDocs[key]) continue;
    const base = `${gender}_${c.file}`;
    const glb = path.join(WORK, 'clips', `${base}.glb`);
    if (!exists(glb)) {
      assertDisk();
      const fbx = path.join(WORK, 'clips', `${base}.max.fbx`);
      download(`${RB_RAW}Assets/Animations/${c.dir}/${base}.max.fbx`, fbx);
      runFbx2gltf(fbx, glb.replace(/\.glb$/, ''));
      fs.rmSync(fbx);
    }
    clipDocs[key] = await io.read(glb);
  }
  const idle = clipDocs[`${gender}_idle`].getRoot().listAnimations()[0];
  const hip = idle.listChannels().find((ch) => ch.getTargetNode().getName() === 'Bip01' && ch.getTargetPath() === 'translation');
  idleHipHeight[gender] = hip.getSampler().getOutput().getArray()[1];
}

function runFbx2gltf(fbx, outBase) {
  fs.chmodSync(FBX2GLTF, 0o755);
  // Prebuilt x86_64 binary; runs under Rosetta on Apple Silicon.
  execFileSync(FBX2GLTF, ['--binary', '-i', fbx, '-o', outBase], { stdio: 'ignore' });
}

/**
 * Copy one clip's channels onto the avatar by node name. Keeps the avatar's own bone lengths (only the
 * root carries translation), fills in constant poses for bones the clip does not key, drops helper nodes,
 * scales root height to the avatar, and optionally cancels the root's horizontal travel (in-place walk).
 */
function bakeClip(doc, name, clipDoc, { inPlace }, hipScale) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const src = clipDoc.getRoot().listAnimations()[0];
  const anim = doc.createAnimation(name);
  const keyed = new Set();

  const addChannel = (target, targetPath, times, values, interpolation = 'LINEAR') => {
    const input = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(times)).setBuffer(buffer);
    const output = doc.createAccessor().setType(targetPath === 'rotation' ? 'VEC4' : 'VEC3').setArray(Float32Array.from(values)).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(interpolation);
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(targetPath).setSampler(sampler));
    keyed.add(`${target.getName()}:${targetPath}`);
  };
  const isBone = (n) => byName.has(n) && !/Footsteps/.test(n);

  for (const ch of src.listChannels()) {
    const nodeName = ch.getTargetNode().getName();
    const targetPath = ch.getTargetPath();
    if (!isBone(nodeName) || targetPath === 'scale') continue;
    const isRoot = nodeName === 'Bip01';
    if (targetPath === 'translation' && !isRoot) continue;
    const s = ch.getSampler();
    const times = s.getInput().getArray();
    const values = Float32Array.from(s.getOutput().getArray());
    if (isRoot && targetPath === 'translation') {
      for (let i = 0; i < values.length; i += 3) {
        values[i + 1] *= hipScale;
        if (inPlace) { values[i] = values[0]; values[i + 2] = values[2]; }
      }
    }
    addChannel(byName.get(nodeName), targetPath, times, values, s.getInterpolation());
  }
  // Bones the clip leaves unkeyed hold their pose in the clip file; bake that as a constant.
  for (const n of clipDoc.getRoot().listNodes()) {
    const nodeName = n.getName();
    if (!isBone(nodeName)) continue;
    if (!keyed.has(`${nodeName}:rotation`)) addChannel(byName.get(nodeName), 'rotation', [0], n.getRotation());
    if (nodeName === 'Bip01' && !keyed.has('Bip01:translation')) {
      const t = n.getTranslation();
      addChannel(byName.get(nodeName), 'translation', [0], [t[0], t[1] * hipScale, t[2]]);
    }
  }
}

// ---------------------------------------------------------------- avatars

async function buildPerson(p) {
  const file = path.join(OUT, 'people', `${p.key}.glb`);
  if (await inspectPerson(file)) { log(`  skip ${p.key} (valid)`); return; }
  assertDisk();
  log(`  build ${p.key} (${p.name})`);
  await loadClips(p.gender);

  const tmp = path.join(WORK, 'tmp', p.key);
  fs.rmSync(tmp, { recursive: true, force: true });
  ensureDir(tmp);
  try {
    download(`${RB_RAW}${p.path}/Export/${p.name}.fbx`, path.join(tmp, `${p.name}.fbx`));
    for (const t of p.textures) download(`${RB_RAW}${p.path}/Textures/${t}.tga`, path.join(tmp, `${t}.tga`));
    runFbx2gltf(path.join(tmp, `${p.name}.fbx`), path.join(tmp, p.key));

    const doc = await io.read(path.join(tmp, `${p.key}.glb`));
    doc.createExtension(EXTTextureWebP).setRequired(true);
    const root = doc.getRoot();

    // Textures: FBX2glTF could not find the TGAs, so rebuild the material textures from the originals.
    for (const old of root.listTextures()) old.dispose();
    for (const mat of root.listMaterials()) {
      const m = mat.getName(); // e.g. f001_body, f001_head, f001_opacity
      const colorStem = [`${m}_color`, `${m}_opacity_color`].find((s) => p.textures.includes(s));
      const normalStem = `${m}_normal`;
      mat.setMetallicFactor(0).setRoughnessFactor(0.85).setBaseColorFactor([1, 1, 1, 1]);
      if (colorStem) {
        const cutout = colorStem.includes('opacity');
        const buf = await tgaToWebp(path.join(tmp, `${colorStem}.tga`), { alpha: cutout, quality: 82 });
        mat.setBaseColorTexture(doc.createTexture(colorStem).setImage(new Uint8Array(buf)).setMimeType('image/webp'));
        if (cutout) mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
      }
      if (p.textures.includes(normalStem)) {
        const buf = await tgaToWebp(path.join(tmp, `${normalStem}.tga`), { alpha: false, quality: 88 });
        mat.setNormalTexture(doc.createTexture(normalStem).setImage(new Uint8Array(buf)).setMimeType('image/webp'));
      }
    }
    // Vertex colours are all white; drop them.
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('COLOR_0', null);

    // Clips.
    const hipScale = root.listNodes().find((n) => n.getName() === 'Bip01').getTranslation()[1] / idleHipHeight[p.gender];
    for (const [name, c] of Object.entries(CONFIG.clips)) bakeClip(doc, name, clipDocs[`${p.gender}_${name}`], c, hipScale);

    // Geometry + size.
    await doc.transform(weld());
    const tris = triangleCount(doc);
    if (tris > maxTriangles) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: (maxTriangles * 0.95) / tris, error: 0.01 }));
    }
    await MeshoptEncoder.ready;
    await MeshoptSimplifier.ready;
    await doc.transform(dedup(), prune(), resample(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));

    ensureDir(path.dirname(file));
    fs.writeFileSync(`${file}.part`, await io.writeBinary(doc));
    fs.renameSync(`${file}.part`, file);
    builtSomething = true;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- Poly Haven

const TEX_MAPS = [['baseColor', 'Diffuse', 'basecolor'], ['normal', 'nor_gl', 'normal'], ['roughness', 'Rough', 'roughness']];

async function validImage(file) {
  if (!exists(file)) return false;
  try {
    const m = await sharp(file).metadata();
    return Math.max(m.width, m.height) <= 1024;
  } catch {
    return false;
  }
}

async function buildTextures() {
  const result = {};
  for (const [key, { id }] of Object.entries(CONFIG.textures)) {
    const files = Object.fromEntries(TEX_MAPS.map(([slot, , suffix]) => [slot, `assets/textures/${key}_${suffix}.jpg`]));
    result[key] = files;
    const ok = (await Promise.all(Object.values(files).map((f) => validImage(path.join(ROOT, 'public', f))))).every(Boolean);
    if (ok) { log(`  skip texture ${key} (valid)`); continue; }
    log(`  build texture ${key} (${id})`);
    const listing = fetchJson(`https://api.polyhaven.com/files/${id}`);
    for (const [slot, mapKey] of TEX_MAPS.map((m) => [m[0], m[1]])) {
      const entry = listing[mapKey]['1k'].jpg;
      const dest = path.join(ROOT, 'public', files[slot]);
      fs.rmSync(dest, { force: true });
      download(entry.url, dest);
      if (md5(dest) !== entry.md5) throw new Error(`md5 mismatch for ${entry.url}`);
    }
    builtSomething = true;
  }
  return result;
}

function buildHdri() {
  const id = CONFIG.hdri.id;
  const rel = `assets/hdri/${id}_1k.hdr`;
  const dest = path.join(ROOT, 'public', rel);
  if (exists(dest)) { log('  skip hdri (valid)'); return rel; }
  log(`  build hdri (${id})`);
  const entry = fetchJson(`https://api.polyhaven.com/files/${id}`).hdri['1k'].hdr;
  download(entry.url, dest);
  if (md5(dest) !== entry.md5) throw new Error(`md5 mismatch for ${entry.url}`);
  builtSomething = true;
  return rel;
}

// ---------------------------------------------------------------- manifest + licences

function writeLicences() {
  const file = path.join(OUT, 'LICENSES.md');
  if (!builtSomething && exists(file)) return;
  const rb = CONFIG.rocketbox;
  const rbUrl = (p) => `${rb.url}/tree/${rb.ref}/${p.replace(/ /g, '%20')}`;
  const rows = [];
  for (const p of CONFIG.people) rows.push(`| Avatar ${p.name} (key \`${p.key}\`) | ${rbUrl(p.path)} | MIT | ${fetchedOn} |`);
  for (const [clip, c] of Object.entries(CONFIG.clips)) {
    for (const g of ['m', 'f']) {
      const url = `${rb.url}/blob/${rb.ref}/Assets/Animations/${c.dir}/${g}_${c.file}.max.fbx`;
      rows.push(`| Animation \`${g}_${c.file}\` (clip \`${clip}\`) | ${url} | MIT | ${fetchedOn} |`);
    }
  }
  for (const [key, { id }] of Object.entries(CONFIG.textures)) rows.push(`| Texture ${key}: ${id} (1k diffuse, normal GL, roughness) | https://polyhaven.com/a/${id} | CC0 | ${fetchedOn} |`);
  rows.push(`| HDRI ${CONFIG.hdri.id} (1k) | https://polyhaven.com/a/${CONFIG.hdri.id} | CC0 | ${fetchedOn} |`);

  const licenceText = execFileSync('curl', ['-fsSL', '--retry', '3', `${RB_RAW}LICENSE.md`]).toString('utf8').trim();
  const text = `# Asset licences

Generated by \`npm run assets\` (scripts/fetch-assets.mjs). Do not edit by hand.

All third-party assets are used under permissive licences: Microsoft Rocketbox (MIT) and Poly Haven (CC0, public domain).
Avatars were converted from FBX to GLB, retextured to WebP, and had animation clips baked in; geometry is unchanged
apart from welding and meshopt compression.

| Asset | Source | Licence | Date fetched |
|---|---|---|---|
${rows.join('\n')}

## Microsoft Rocketbox licence text

Source: ${rb.url}/blob/${rb.ref}/LICENSE.md

\`\`\`
${licenceText}
\`\`\`

## Poly Haven

Poly Haven assets are released under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/); no attribution is required.
`;
  fs.writeFileSync(file, text);
}

async function writeManifest(textures, hdri) {
  const people = {};
  for (const p of CONFIG.people) {
    const file = path.join(OUT, 'people', `${p.key}.glb`);
    const info = await inspectPerson(file);
    if (!info) throw new Error(`Avatar ${p.key} is missing or invalid after build`);
    people[p.key] = { file: `assets/people/${p.key}.glb`, clips: info.clips, triangles: info.triangles };
  }
  const manifest = {
    people,
    textures,
    hdri,
    sources: [
      { name: 'Microsoft Rocketbox avatars and animations', url: CONFIG.rocketbox.url, licence: CONFIG.rocketbox.licence },
      { name: 'Poly Haven textures and HDRI', url: CONFIG.polyhaven.url, licence: CONFIG.polyhaven.licence },
    ],
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// ---------------------------------------------------------------- main

ensureDir(OUT);
log('Poly Haven');
const textures = await buildTextures();
const hdri = buildHdri();
log('Avatars');
for (const p of CONFIG.people) await buildPerson(p);
writeLicences();
const manifest = await writeManifest(textures, hdri);
const total = (function size(d) {
  return fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
})(OUT);
log(`Done: ${Object.keys(manifest.people).length} people, ${(total / 1024 / 1024).toFixed(1)} MB in public/assets`);
