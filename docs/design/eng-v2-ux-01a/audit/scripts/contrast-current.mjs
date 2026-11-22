// WCAG 2.x contrast ratios for the current v2 tokens (src/app.css at f14dd4e).
const hex = (h) => { const n = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255); };
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Composite rgba(fg, alpha) over an opaque background.
const over = (fg, alpha, bg) => '#' + hex(fg).map((c, i) => Math.round((c * alpha + hex(bg)[i] * (1 - alpha)) * 255).toString(16).padStart(2, '0')).join('');

const pairs = {
  light: [
    ['muted text on bg', '#667085', '#f5f7fb', 4.5],
    ['muted text on surface-2', '#667085', '#f8fafc', 4.5],
    ['tag text on tag bg', '#344054', '#eef2f6', 4.5],
    ['focus-text on focus-bg (Focus button)', '#7a4b00', '#fff4cc', 4.5],
    ['success on learned-bg (I know it)', '#087443', '#ecfdf3', 4.5],
    ['danger on danger-bg (Hide / Reset)', '#b42318', '#fff1f0', 4.5],
    ['top-bar nav text on primary', '#e2e8f0', '#263238', 4.5],
    ['top-bar muted on primary', '#cbd5e1', '#263238', 4.5],
    ['hero muted on hero end', '#e2e8f0', '#445b66', 4.5],
    ['accent-text on accent (active segment)', '#211500', '#f59e0b', 4.5],
    ['focus ring (accent) vs surface — non-text', '#f59e0b', '#ffffff', 3],
    ['focus ring (accent) vs bg — non-text', '#f59e0b', '#f5f7fb', 3],
    ['input border vs surface — non-text', '#cfd6e4', '#ffffff', 3],
    ['progress fill vs track — non-text', '#087443', '#eef2f6', 3],
    ['bottom-nav muted on nav bg (0.94 over bg)', '#667085', over('#ffffff', 0.94, '#f5f7fb'), 4.5]
  ],
  dark: [
    ['muted text on bg', '#a7b0bd', '#0f141a', 4.5],
    ['muted text on surface', '#a7b0bd', '#171e26', 4.5],
    ['muted text on surface-2', '#a7b0bd', '#1c2530', 4.5],
    ['tag text on tag bg', '#d9e2ec', '#263240', 4.5],
    ['focus-text on focus-bg', '#fbd978', '#3b3010', 4.5],
    ['success on learned-bg', '#6ee7b7', '#163328', 4.5],
    ['danger on danger-bg', '#ff8a80', '#3a1f22', 4.5],
    ['top-bar nav text on primary', '#d7e0e8', '#111820', 4.5],
    ['accent-text on accent', '#211500', '#fbbf24', 4.5],
    ['focus ring (accent) vs surface — non-text', '#fbbf24', '#171e26', 3],
    ['input border vs input bg — non-text', '#405063', '#111820', 3],
    ['progress fill vs track — non-text', '#6ee7b7', '#263240', 3]
  ]
};

for (const [theme, list] of Object.entries(pairs)) {
  console.log(`\n${theme}`);
  for (const [name, fg, bg, min] of list) {
    const value = ratio(fg, bg);
    console.log(`${value >= min ? 'pass' : 'FAIL'}  ${value.toFixed(2).padStart(5)}:1  (min ${min})  ${name}  ${fg} on ${bg}`);
  }
}
