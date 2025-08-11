// Mulberry32: rápido, determinístico para variações por-tile.
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash simples 2D -> seed estável por (x,y).
export function hash2D(x: number, y: number, salt = 1337): number {
  let h = 2166136261 ^ salt;
  h = Math.imul(h ^ x, 16777619);
  h = Math.imul(h ^ y, 16777619);
  return h >>> 0;
}
