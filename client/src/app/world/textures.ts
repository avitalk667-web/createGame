import * as THREE from 'three';

// Procedural textures drawn on canvas: no external image assets to license or load.

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function finish(c: HTMLCanvasElement, repeat: [number, number], srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key)!.clone();
}

export function stoneTexture(repeat: [number, number] = [4, 2]) {
  const t = cached('stone', () => {
    const [c, g] = canvas(512, 512);
    const r = rand(7);
    g.fillStyle = '#3a3640';
    g.fillRect(0, 0, 512, 512);
    const rows = 8;
    const bh = 512 / rows;
    for (let y = 0; y < rows; y++) {
      const off = y % 2 ? 0 : 48;
      for (let x = -off; x < 512; x += 96) {
        const shade = 50 + Math.floor(r() * 26);
        g.fillStyle = `rgb(${shade + 6},${shade},${shade + 10})`;
        g.fillRect(x + 3, y * bh + 3, 90, bh - 6);
        for (let i = 0; i < 30; i++) {
          g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
          g.fillRect(x + 3 + r() * 88, y * bh + 3 + r() * (bh - 8), 2 + r() * 6, 2 + r() * 4);
        }
      }
    }
    return finish(c, [1, 1]);
  });
  t.repeat.set(...repeat);
  t.needsUpdate = true;
  return t;
}

export function woodFloorTexture(repeat: [number, number] = [4, 4]) {
  const t = cached('wood', () => {
    const [c, g] = canvas(512, 512);
    const r = rand(11);
    const planks = 6;
    const w = 512 / planks;
    for (let i = 0; i < planks; i++) {
      const base = 60 + Math.floor(r() * 25);
      g.fillStyle = `rgb(${base + 40},${base + 15},${base - 15})`;
      g.fillRect(i * w, 0, w, 512);
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = `rgba(30,15,5,${0.08 + r() * 0.12})`;
        g.lineWidth = 1 + r() * 2;
        const x = i * w + r() * w;
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + r() * 8 - 4, 170, x + r() * 8 - 4, 340, x, 512);
        g.stroke();
      }
      g.fillStyle = 'rgba(10,5,0,0.6)';
      g.fillRect(i * w, 0, 3, 512);
      g.fillRect(i * w, (r() * 512) | 0, w, 3);
    }
    return finish(c, [1, 1]);
  });
  t.repeat.set(...repeat);
  t.needsUpdate = true;
  return t;
}

export function bookSpinesTexture(seed: number) {
  const [c, g] = canvas(256, 64);
  const r = rand(seed);
  const colors = ['#5b1f1f', '#1f3b5b', '#2f4a2a', '#5b4a1f', '#3b1f4a', '#6b3a1a', '#1a1a2e'];
  let x = 0;
  g.fillStyle = '#1a0f08';
  g.fillRect(0, 0, 256, 64);
  while (x < 256) {
    const w = 6 + Math.floor(r() * 10);
    const h = 44 + Math.floor(r() * 20);
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(x, 64 - h, w - 1, h);
    g.fillStyle = 'rgba(214,170,80,0.7)';
    g.fillRect(x + 1, 64 - h + 6, w - 3, 2);
    g.fillRect(x + 1, 64 - 10, w - 3, 2);
    x += w;
  }
  return finish(c, [1, 1]);
}

export function parchmentTexture() {
  return cached('parchment', () => {
    const [c, g] = canvas(256, 256);
    const grad = g.createRadialGradient(128, 128, 20, 128, 128, 180);
    grad.addColorStop(0, '#efdcb0');
    grad.addColorStop(1, '#b8925a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const r = rand(3);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(90,60,20,${r() * 0.08})`;
      g.fillRect(r() * 256, r() * 256, 2 + r() * 5, 1 + r() * 3);
    }
    return finish(c, [1, 1]);
  });
}

/** Text label rendered to a texture (Hebrew is drawn right-to-left). */
export function labelTexture(text: string, opts: { color?: string; bg?: string; font?: string; width?: number; height?: number } = {}) {
  const w = opts.width ?? 512;
  const h = opts.height ?? 128;
  const [c, g] = canvas(w, h);
  if (opts.bg) {
    g.fillStyle = opts.bg;
    const rr = h / 2.4;
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, rr);
    g.fill();
  }
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = opts.font ?? `bold ${Math.floor(h * 0.48)}px Heebo, Arial, sans-serif`;
  // long text shrinks to fit inside the label instead of being cut at its edges
  if (!opts.font) {
    let size = Math.floor(h * 0.48);
    while (size > 10 && g.measureText(text).width > w - h * 0.6) {
      size -= 2;
      g.font = `bold ${size}px Heebo, Arial, sans-serif`;
    }
  }
  g.fillStyle = opts.color ?? '#fff';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Engraved plaque with wrapped Hebrew text. */
export function plaqueTexture(text: string) {
  const [c, g] = canvas(512, 320);
  g.fillStyle = '#6b6b70';
  g.fillRect(0, 0, 512, 320);
  const r = rand(text.length);
  for (let i = 0; i < 600; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.1})`;
    g.fillRect(r() * 512, r() * 320, 3, 3);
  }
  g.strokeStyle = '#3f3f44';
  g.lineWidth = 10;
  g.strokeRect(12, 12, 488, 296);
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.fillStyle = '#1d1a14';
  g.font = 'bold 40px "Frank Ruhl Libre", Heebo, serif';
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (g.measureText(test).width > 430) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  lines.push(cur);
  const top = 160 - (lines.length - 1) * 26;
  lines.forEach((l, i) => g.fillText(l, 256, top + i * 52 + 14));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowSpriteTexture(color = '#ffcc77') {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color + 'aa');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function blobShadowTexture() {
  return cached('shadow', () => {
    const [c, g] = canvas(128, 128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  });
}

/** Dark wooden wainscot panels with raised frames. */
export function panelTexture(repeat: [number, number] = [6, 1]) {
  const t = cached('panel', () => {
    const [c, g] = canvas(256, 256);
    const r = rand(5);
    g.fillStyle = '#3a2416';
    g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 60; k++) {
      g.strokeStyle = `rgba(20,10,4,${0.1 + r() * 0.15})`;
      g.beginPath();
      const y = r() * 256;
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + r() * 6, 170, y - r() * 6, 256, y);
      g.stroke();
    }
    g.strokeStyle = '#1c1008';
    g.lineWidth = 10;
    g.strokeRect(22, 22, 212, 212);
    g.strokeStyle = 'rgba(214,170,90,0.35)';
    g.lineWidth = 3;
    g.strokeRect(30, 30, 196, 196);
    g.fillStyle = 'rgba(255,220,160,0.06)';
    g.fillRect(34, 34, 188, 40);
    return finish(c, [1, 1]);
  });
  t.repeat.set(...repeat);
  t.needsUpdate = true;
  return t;
}

/** Ornate rug: border bands, medallion and corner motifs. */
export function rugTexture(base: string, accent: string, seed = 1) {
  const [c, g] = canvas(512, 512);
  const r = rand(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (const [inset, color, w] of [[14, accent, 10], [34, '#1a0f0a', 6], [50, accent, 3]] as [number, string, number][]) {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.strokeRect(inset, inset, 512 - inset * 2, 512 - inset * 2);
  }
  g.fillStyle = accent;
  for (let i = 0; i < 24; i++) {
    const x = 70 + (i % 12) * 34;
    g.beginPath();
    g.arc(x, 26, 5, 0, Math.PI * 2);
    g.arc(x, 486, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.save();
  g.translate(256, 256);
  for (let ring = 5; ring >= 1; ring--) {
    g.fillStyle = ring % 2 ? accent : base;
    g.beginPath();
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const rr = ring * 26 * (k % 2 ? 0.78 : 1);
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.fill();
  }
  g.restore();
  for (const [x, y] of [[90, 90], [422, 90], [90, 422], [422, 422]]) {
    g.fillStyle = accent;
    g.beginPath();
    g.moveTo(x, y - 26);
    g.lineTo(x + 26, y);
    g.lineTo(x, y + 26);
    g.lineTo(x - 26, y);
    g.fill();
  }
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
    g.fillRect(r() * 512, r() * 512, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Landscape painting (no human figures): night hills, moon, cypress trees or a seascape. */
export function paintingTexture(seed: number) {
  const [c, g] = canvas(256, 192);
  const r = rand(seed * 13 + 7);
  const sky = g.createLinearGradient(0, 0, 0, 192);
  const palettes = [['#1b2a55', '#c98a4a'], ['#22324a', '#8fb0c9'], ['#2d1f3d', '#d6a35c'], ['#173a3a', '#9cc7a0']];
  const [top, bottom] = palettes[seed % palettes.length];
  sky.addColorStop(0, top);
  sky.addColorStop(1, bottom);
  g.fillStyle = sky;
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#fff3c8';
  g.beginPath();
  g.arc(40 + r() * 170, 30 + r() * 30, 12 + r() * 6, 0, Math.PI * 2);
  g.fill();
  for (let layer = 0; layer < 3; layer++) {
    g.fillStyle = ['#2f3a2a', '#20291e', '#141a13'][layer];
    g.beginPath();
    g.moveTo(0, 192);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, 110 + layer * 22 + Math.sin(x * 0.03 + seed + layer) * 14 + r() * 6);
    g.lineTo(256, 192);
    g.fill();
  }
  g.fillStyle = '#0d120c';
  for (let i = 0; i < 4; i++) {
    const x = 20 + r() * 216;
    g.beginPath();
    g.moveTo(x, 172);
    g.lineTo(x - 7, 172);
    g.lineTo(x - 3, 120 - r() * 20);
    g.lineTo(x + 4, 172);
    g.fill();
  }
  // varnish and craquelure
  g.fillStyle = 'rgba(255,200,120,0.08)';
  g.fillRect(0, 0, 256, 192);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Arched window: leaded panes with moonlight. */
export function windowTexture() {
  return cached('window', () => {
    const [c, g] = canvas(256, 448);
    const grad = g.createLinearGradient(0, 0, 0, 448);
    grad.addColorStop(0, '#9fc3ff');
    grad.addColorStop(1, '#2a3f78');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 448);
    g.lineTo(0, 128);
    g.arc(128, 128, 128, Math.PI, 0);
    g.lineTo(256, 448);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(170, 110, 24, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#16120e';
    g.lineWidth = 10;
    g.stroke();
    g.lineWidth = 6;
    for (let x = 64; x < 256; x += 64) {
      g.beginPath();
      g.moveTo(x, 448);
      g.lineTo(x, x === 128 ? 0 : 40);
      g.stroke();
    }
    for (let y = 160; y < 448; y += 72) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(0, 448);
    g.lineTo(0, 128);
    g.arc(128, 128, 128, Math.PI, 0);
    g.lineTo(256, 448);
    g.lineWidth = 14;
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}
