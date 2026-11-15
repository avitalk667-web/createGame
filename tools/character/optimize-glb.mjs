// Development only: builds the web copy of the PORTAL X player character from the delivered GLB.
//   node tools/character/optimize-glb.mjs <source.glb> <out.glb> <color.jpg> <orm.jpg> <normal.jpg>
// The three images are the source textures re-encoded (smaller) with ffmpeg beforehand, see README.md.
// Keeps mesh, skin, skeleton, material and clips unchanged; drops orphan buffer data and the
// experimental facial morph targets (approximate, flagged for repair in the delivery notes).
import fs from 'node:fs';
const [src, out, ...imgs] = process.argv.slice(2);
const b = fs.readFileSync(src);
const jl = b.readUInt32LE(12);
const j = JSON.parse(b.subarray(20, 20 + jl).toString());
const bin = b.subarray(20 + jl + 8);
const view = (i) => { const v = j.bufferViews[i]; return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength); };

for (const m of j.meshes) for (const p of m.primitives) delete p.targets;
for (const m of j.meshes) { delete m.weights; if (m.extras) delete m.extras.targetNames; }
// morph-weight animation channels have no target any more
for (const a of j.animations ?? []) {
  const keep = a.channels.filter((c) => c.target.path !== 'weights');
  const used = new Set(keep.map((c) => c.sampler));
  const remap = new Map(); const samplers = [];
  a.samplers.forEach((s, i) => { if (used.has(i)) { remap.set(i, samplers.length); samplers.push(s); } });
  a.channels = keep.map((c) => ({ ...c, sampler: remap.get(c.sampler) }));
  a.samplers = samplers;
}
j.animations = (j.animations ?? []).filter((a) => a.channels.length);

// collect used accessors / buffer views and repack
const usedAcc = new Set();
for (const m of j.meshes) for (const p of m.primitives) { Object.values(p.attributes).forEach((x) => usedAcc.add(x)); if (p.indices !== undefined) usedAcc.add(p.indices); }
for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices);
for (const a of j.animations) for (const s of a.samplers) { usedAcc.add(s.input); usedAcc.add(s.output); }
const accMap = new Map(); const accessors = [];
[...usedAcc].sort((x, y) => x - y).forEach((i) => { accMap.set(i, accessors.length); accessors.push(j.accessors[i]); });
const chunks = []; const views = []; let off = 0;
const push = (buf, extra = {}) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...extra }); chunks.push(buf); off += buf.length; return views.length - 1; };
for (const a of accessors) { const v = j.bufferViews[a.bufferView]; const nv = push(view(a.bufferView), v.target ? { target: v.target } : {}); a.bufferView = nv; }
j.images = j.images.map((im, i) => ({ name: im.name, mimeType: 'image/jpeg', bufferView: push(fs.readFileSync(imgs[i])) }));
const remapAcc = (i) => accMap.get(i);
for (const m of j.meshes) for (const p of m.primitives) { for (const k in p.attributes) p.attributes[k] = remapAcc(p.attributes[k]); if (p.indices !== undefined) p.indices = remapAcc(p.indices); }
for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = remapAcc(s.inverseBindMatrices);
for (const a of j.animations) for (const s of a.samplers) { s.input = remapAcc(s.input); s.output = remapAcc(s.output); }
j.accessors = accessors; j.bufferViews = views;
const binOut = Buffer.concat(chunks); const binPad = Buffer.concat([binOut, Buffer.alloc((4 - (binOut.length % 4)) % 4)]);
j.buffers = [{ byteLength: binPad.length }];
j.asset.extras = { ...(j.asset.extras ?? {}), webCopy: 'textures re-encoded, orphan data and facial morphs removed (tools/character/optimize-glb.mjs)' };
let json = Buffer.from(JSON.stringify(j)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
const ch = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
fs.writeFileSync(out, Buffer.concat([header, ch(json.length, 0x4e4f534a), json, ch(binPad.length, 0x004e4942), binPad]));
console.log(`${out}: ${(fs.statSync(out).size / 1e6).toFixed(2)} MB, accessors ${accessors.length}, clips ${j.animations.map((a) => a.name).join(', ')}`);
