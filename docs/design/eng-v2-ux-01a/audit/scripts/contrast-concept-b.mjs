const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = {
  'B light': [
    ['ink on paper', '#172238', '#F5F6F9', 4.5], ['ink-2 on paper', '#38445C', '#F5F6F9', 4.5], ['muted on paper', '#56627A', '#F5F6F9', 4.5], ['muted on surface', '#56627A', '#FFFFFF', 4.5],
    ['field border on surface (non-text)', '#7A859B', '#FFFFFF', 3], ['field border on paper (non-text)', '#7A859B', '#F5F6F9', 3],
    ['focus ring on paper (non-text)', '#2C5BD6', '#F5F6F9', 3], ['focus ring on surface (non-text)', '#2C5BD6', '#FFFFFF', 3], ['focus ring on highlighter (non-text)', '#2C5BD6', '#FFE27A', 3],
    ['known text on surface', '#17744A', '#FFFFFF', 4.5], ['white on known button', '#FFFFFF', '#17744A', 4.5], ['warn text on warn-soft', '#7A4F00', '#FFF3D1', 4.5],
    ['white on danger button', '#FFFFFF', '#B3261E', 4.5], ['ink on highlighter mark', '#172238', '#FFE27A', 4.5], ['Undo (highlighter) on toast', '#FFE27A', '#172238', 4.5], ['paper text on primary button', '#F5F6F9', '#172238', 4.5],
    ['ink-2 on sunk (count chip)', '#38445C', '#E9EDF4', 4.5]
  ],
  'B dark': [
    ['ink on paper', '#E8ECF5', '#0D1322', 4.5], ['ink-2 on surface', '#C3CADA', '#151D30', 4.5], ['muted on paper', '#9CA6BC', '#0D1322', 4.5], ['muted on surface', '#9CA6BC', '#151D30', 4.5],
    ['field border on surface (non-text)', '#7D89A4', '#151D30', 3], ['field border on paper (non-text)', '#7D89A4', '#0D1322', 3],
    ['focus ring on paper (non-text)', '#8DB2FF', '#0D1322', 3], ['focus ring on surface (non-text)', '#8DB2FF', '#151D30', 3],
    ['spoken word (highlighter) on paper', '#FFD84D', '#0D1322', 4.5], ['dark text on known button', '#0D1322', '#6CD19C', 4.5], ['known text on paper', '#6CD19C', '#0D1322', 4.5],
    ['dark text on danger button', '#0D1322', '#FF8B82', 4.5], ['warn text on warn-soft', '#F3C35B', '#33290F', 4.5], ['toast text on inverse', '#0D1322', '#E8ECF5', 4.5], ['Undo on inverse toast', '#8A6400', '#E8ECF5', 4.5],
    ['paper text on primary button', '#0D1322', '#E8ECF5', 4.5]
  ]
};
for (const [theme, list] of Object.entries(pairs)) { console.log(`\n${theme}`); for (const [n, f, b, m] of list) { const v = ratio(f, b); console.log(`${v >= m ? 'pass' : 'FAIL'}  ${v.toFixed(2).padStart(5)}:1 (min ${m})  ${n}`); } }
