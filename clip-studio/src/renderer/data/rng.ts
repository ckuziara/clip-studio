// Small deterministic LCG PRNG so demo waveforms/durations are stable
// across renders instead of re-randomising on every re-render.
export function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function waveBars(n: number, seedBase: number): number[] {
  const rnd = makeRng(seedBase * 31 + 11);
  const bars: number[] = [];
  for (let i = 0; i < n; i++) {
    const env = Math.sin((i / n) * Math.PI * 6) * 0.3 + 0.5;
    const h = Math.max(0.08, Math.min(1, env * (0.5 + rnd() * 0.9)));
    bars.push(h);
  }
  return bars;
}
