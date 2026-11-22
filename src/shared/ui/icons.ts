/**
 * The v2 icon set: simple 24 × 24 stroke drawings, bundled with the app.
 * Shapes are plain data (no HTML strings), rendered by Icon.svelte.
 */
export type IconShape =
  | { d: string; fill?: boolean }
  | { cx: number; cy: number; r: number; fill?: boolean };

const ring = (r = 8.5): IconShape => ({ cx: 12, cy: 12, r });
const tray: IconShape = { d: 'M4.5 14.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-4.5' };
const eye: IconShape = { d: 'M2.5 12C4.2 8.7 7.7 6 12 6s7.8 2.7 9.5 6c-1.7 3.3-5.2 6-9.5 6s-7.8-2.7-9.5-6z' };

const DEFINITIONS = {
  home: [{ d: 'M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z' }],
  library: [{ d: 'M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z' }, { d: 'M5 17a3 3 0 0 1 3-3h9.5' }],
  practice: [{ d: 'M5.5 7.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z' }, { d: 'M8 4h10.5a2 2 0 0 1 2 2v10.5' }],
  star: [{ d: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z' }],
  menu: [{ d: 'M4 7h16M4 12h16M4 17h16' }],
  folder: [{ d: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h4.5l2 2H19A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z' }],
  settings: [{ d: 'M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20' }, { cx: 15, cy: 7, r: 2.4 }, { cx: 9, cy: 17, r: 2.4 }],
  listen: [{ d: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z' }, { d: 'M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.5 7.5 0 0 1 0 10.4' }],
  stop: [ring(), { d: 'M9.5 9.5h5v5h-5z', fill: true }],
  slower: [ring(7.5), { d: 'M12 12.5V9M10 3.5h4' }],
  shuffle: [{ d: 'M15.5 4.5H20V9M4 19.5 19.5 4.5M20 15v4.5h-4.5M14.6 14.6l4.9 4.9M4 4.5l5 5' }],
  reset: [{ d: 'M5 12a7 7 0 1 0 2.2-5.1' }, { d: 'M5 4.5v4h4' }],
  undo: [{ d: 'M9 6 4.5 10.5 9 15' }, { d: 'M5 10.5h9a5 5 0 0 1 0 10h-3' }],
  edit: [{ d: 'M5 19h3.5L18.2 9.3a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0L5 15.5z' }, { d: 'M13.5 7l3.5 3.5' }],
  'arrow-left': [{ d: 'M19 12H5M11 6l-6 6 6 6' }],
  'arrow-right': [{ d: 'M5 12h14M13 6l6 6-6 6' }],
  'chevron-left': [{ d: 'M14.5 6l-6 6 6 6' }],
  'chevron-right': [{ d: 'M9.5 6l6 6-6 6' }],
  'chevron-down': [{ d: 'M6 9.5l6 6 6-6' }],
  'chevron-up': [{ d: 'M6 14.5l6-6 6 6' }],
  check: [{ d: 'M5 12.5l4.2 4.2L19 7' }],
  'check-circle': [ring(), { d: 'M8.2 12.3l2.6 2.6 5-5.2' }],
  eye: [eye, { cx: 12, cy: 12, r: 2.8 }],
  'eye-off': [eye, { d: 'M4 4l16 16' }],
  close: [{ d: 'M6 6l12 12M18 6L6 18' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  minus: [{ d: 'M5 12h14' }],
  trash: [{ d: 'M5 7h14M9.5 7V5h5v2' }, { d: 'M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7' }, { d: 'M10 11v6M14 11v6' }],
  flip: [{ d: 'M4.5 12a7.5 7.5 0 0 1 13-5.1' }, { d: 'M18 3.5v4h-4' }, { d: 'M19.5 12a7.5 7.5 0 0 1-13 5.1' }, { d: 'M6 20.5v-4h4' }],
  list: [{ d: 'M9 7h11M9 12h11M9 17h11' }, { cx: 5, cy: 7, r: 1.1, fill: true }, { cx: 5, cy: 12, r: 1.1, fill: true }, { cx: 5, cy: 17, r: 1.1, fill: true }],
  sun: [{ cx: 12, cy: 12, r: 4 }, { d: 'M12 2.8v2M12 19.2v2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M2.8 12h2M19.2 12h2M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4' }],
  moon: [{ d: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z' }],
  contrast: [ring(), { d: 'M12 3.5a8.5 8.5 0 0 1 0 17z', fill: true }],
  upload: [{ d: 'M12 15V4M7.5 8.5 12 4l4.5 4.5' }, tray],
  download: [{ d: 'M12 4v11M7.5 10.5 12 15l4.5-4.5' }, tray],
  copy: [
    { d: 'M9 8.5h9.5A1.5 1.5 0 0 1 20 10v9.5a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 9 8.5z' },
    { d: 'M16.5 8.5V5A1.5 1.5 0 0 0 15 3.5H5.5A1.5 1.5 0 0 0 4 5v9.5A1.5 1.5 0 0 0 5.5 16h2' }
  ],
  warning: [{ d: 'M12 4l9 16H3z' }, { d: 'M12 10v4.5M12 17.4v.1' }],
  info: [ring(), { d: 'M12 11v5.5M12 7.8v.1' }],
  error: [ring(), { d: 'M12 7.5v6M12 16.4v.1' }],
  tabs: [
    { d: 'M4.5 7h10A1.5 1.5 0 0 1 16 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 17.5v-9A1.5 1.5 0 0 1 4.5 7z' },
    { d: 'M7 7V5.5A1.5 1.5 0 0 1 8.5 4h11A1.5 1.5 0 0 1 21 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16' }
  ],
  search: [{ cx: 10.5, cy: 10.5, r: 6 }, { d: 'M15 15l5 5' }],
  external: [{ d: 'M14 4h6v6M20 4l-9 9' }, { d: 'M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H11' }],
  more: [{ cx: 5.5, cy: 12, r: 1.5, fill: true }, { cx: 12, cy: 12, r: 1.5, fill: true }, { cx: 18.5, cy: 12, r: 1.5, fill: true }],
  'select-all': [{ d: 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z' }, { d: 'M8 12.3l2.7 2.7L16 9.6' }]
} satisfies Record<string, IconShape[]>;

export type IconName = keyof typeof DEFINITIONS;
export const ICONS: Record<IconName, IconShape[]> = DEFINITIONS;
