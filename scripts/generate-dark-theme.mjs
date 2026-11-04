// Generates app/theme-dark.css from app/globals.css.
// Every colour declaration is re-emitted under :root[data-theme="dark"] with a
// lightness-remapped colour (hue kept): light surfaces -> dark surfaces, dark
// text -> light text, saturated accents kept. Run after editing globals.css:
//   npm run theme:dark
import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("../app/globals.css", import.meta.url);
const OUT = new URL("../app/theme-dark.css", import.meta.url);
const ROOT = ':root[data-theme="dark"]';

// ---------- colour maths ----------
const NAMED = { white: "#ffffff", black: "#000000" };
function parseHex(h) {
  h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}
function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}
function fromHsl({ h, s, l }) {
  const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  if (!s) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return { r: f(p, q, h + 1 / 3) * 255, g: f(p, q, h) * 255, b: f(p, q, h - 1 / 3) * 255 };
}
const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
const toHex = ({ r, g, b }, a) => `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ""}`;

// OLED night mode: true-black canvas, pure neutral greys for every surface,
// border and body text (no hue tint), and only genuinely vivid accents
// (brand button, SOS red, status colours) keep their hue.
const ACCENT_CHROMA = 0.25; // max(r,g,b) - min(r,g,b) on 0..1; below this a colour is a tinted neutral
const grey = (L, a) => toHex(fromHsl({ h: 0, s: 0, l: Math.max(0, Math.min(0.97, L)) }), a);

/** kind: 'bg' | 'text' | 'border' | 'shadow' */
function mapColor(token, kind) {
  const src = NAMED[token.toLowerCase()] || token;
  const c = parseHex(src), { h, s, l } = toHsl(c);
  if (kind === "shadow") return toHex({ r: 0, g: 0, b: 0 }, Math.min(1, c.a * 2.2));
  const chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
  const accent = chroma >= ACCENT_CHROMA;
  if (kind === "text") {
    if (!accent && l >= 0.85) return grey(l, c.a);                     // light text on vivid fills
    if (accent) return toHex(fromHsl({ h, s, l: Math.min(0.85, Math.max(l, 0.62)) }), c.a); // readable accent
    return grey(l <= 0.4 ? 0.95 - l * 0.55 : 0.98 - l * 0.6, c.a);     // dark text -> light grey
  }
  if (accent && l > 0.2 && l < 0.75) return token;                     // buttons, SOS, avatars
  if (accent && l >= 0.75) return toHex(fromHsl({ h, s: s * 0.6, l: 0.12 }), c.a); // pastel status chip -> deep tint
  const border = kind === "border";
  if (l <= 0.3) return grey(border ? 0.16 : l * 0.35, c.a);           // dark fills -> near black
  if (l >= 0.8) return grey((1 - l) * 0.9 + (border ? 0.13 : 0), c.a); // light surfaces -> OLED black
  return grey(0.06 + (1 - l) * 0.3 + (border ? 0.08 : 0), c.a);       // mid tones -> charcoal
}

const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:white|black)\b/g;
function kindFor(prop) {
  if (prop === "box-shadow" || prop === "text-shadow") return "shadow";
  if (/^(color|fill|stroke|caret-color|accent-color|text-decoration-color|--ink|--muted)$/.test(prop)) return "text";
  if (/^(border|outline)|^--line$/.test(prop)) return "border";
  if (/^(background|--paper|--green-light)/.test(prop)) return "bg";
  return null;
}

// ---------- tiny CSS walker ----------
function splitTop(text, sep) {
  const out = []; let depth = 0, quote = "", cur = "";
  for (const ch of text) {
    if (quote) { if (ch === quote) quote = ""; cur += ch; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function blocks(css) {
  const out = []; let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    let prelude = css.slice(i, open);
    const parts = splitTop(prelude, ";"); prelude = (parts[parts.length - 1] || "").trim(); // drop @import …;
    let depth = 1, j = open + 1, quote = "";
    for (; j < css.length && depth; j++) {
      const ch = css[j];
      if (quote) { if (ch === quote) quote = ""; continue; }
      if (ch === '"' || ch === "'") quote = ch; else if (ch === "{") depth++; else if (ch === "}") depth--;
    }
    out.push({ prelude, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}
function scope(selector) {
  return splitTop(selector, ",").map((s) => {
    s = s.trim();
    if (s === ":root" || s === "html") return ROOT;
    if (s.startsWith(":root")) return ROOT + s.slice(5);
    return `${ROOT} ${s}`;
  }).join(",");
}
function convert(css) {
  let out = "";
  for (const { prelude, body } of blocks(css)) {
    if (/^@(media|supports)/.test(prelude)) { const inner = convert(body); if (inner) out += `${prelude}{\n${inner}}\n`; continue; }
    if (prelude.startsWith("@")) continue; // keyframes, font-face …
    const decls = [];
    for (const d of splitTop(body, ";")) {
      const k = d.indexOf(":"); if (k < 0) continue;
      const prop = d.slice(0, k).trim().toLowerCase(), value = d.slice(k + 1).trim();
      const kind = kindFor(prop); if (!kind || !COLOR_RE.test(value)) { COLOR_RE.lastIndex = 0; continue; }
      COLOR_RE.lastIndex = 0;
      const mapped = value.replace(COLOR_RE, (t) => mapColor(t, prop === "background" && /gradient/.test(value) ? "bg" : kind));
      if (mapped !== value) decls.push(`${prop}:${mapped}`);
    }
    if (decls.length) out += `${scope(prelude)}{${decls.join(";")}}\n`;
  }
  return out;
}

const source = readFileSync(SRC, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const manual = `
/* hand-tuned */
${ROOT}{color-scheme:dark;--ink:#ededed;--muted:#a1a1a1;--line:#1f1f1f;--paper:#000000;--green-light:#0d0d0d}
${ROOT},${ROOT} body{background:#000000;color:#ededed}
${ROOT} .auth-page,${ROOT} .auth-panel,${ROOT} .auth-story,${ROOT} .password-page{background:#000000}
${ROOT} input,${ROOT} select,${ROOT} textarea{background:#0a0a0a;border-color:#262626;color:#ededed}
${ROOT} .rbac-search input,${ROOT} .location-select select{background:transparent;border:0}
${ROOT} .location-select select option{background:#0a0a0a}
${ROOT} input::placeholder,${ROOT} textarea::placeholder{color:#6b6b6b}
${ROOT} button:focus-visible,${ROOT} a:focus-visible,${ROOT} input:focus-visible,${ROOT} select:focus-visible,${ROOT} textarea:focus-visible,${ROOT} [tabindex]:focus-visible{outline-color:#8a8a8a}
${ROOT} .card,${ROOT} .modal,${ROOT} .rbac-panel,${ROOT} .rbac-role-card,${ROOT} .rbac-menu{background:#0a0a0a;border-color:#1f1f1f;box-shadow:none}
${ROOT} .rbac-panel{background:#050505}
${ROOT} .rbac-table th,${ROOT} .rbac-table td,${ROOT} .rbac-name{color:#ededed}
${ROOT} .rbac-muted,${ROOT} .rbac-icon,${ROOT} .rbac-hint{color:#a1a1a1}
${ROOT} .rbac-table tbody tr:hover{background:#121212}
${ROOT} .rbac-role.admin{color:#8fb0ff}${ROOT} .rbac-role.user{color:#d4d4d4}${ROOT} .rbac-role.custom{color:#f0b35c}
${ROOT} .sidebar,${ROOT} .topbar,${ROOT} .employee-header{background:#000000;border-color:#1a1a1a}
${ROOT} .icon-btn:hover,${ROOT} .rbac-icon:hover{background:#1a1a1a;color:#ededed}
${ROOT} .btn.secondary{background:#0f0f0f;border-color:#2a2a2a;color:#e0e0e0}
${ROOT} .btn.secondary:hover{background:#1a1a1a}
${ROOT} .btn.sso{background:#0f0f0f;border-color:#2a2a2a;color:#ededed}
${ROOT} .btn.sso:hover{background:#1a1a1a}
${ROOT} .auth-divider{color:#6b6b6b}${ROOT} .auth-divider::before,${ROOT} .auth-divider::after{background:#262626}
${ROOT} h1,${ROOT} h2,${ROOT} h3,${ROOT} h4{color:#ededed}
${ROOT} .night-illustration svg path{stroke:#4a4a4a}
${ROOT} .brand-symbol.io-logo{background:radial-gradient(circle,#ffffff 0 44%,transparent 45%);box-shadow:0 0 0 1px #3a3a3a}
`;
const header = "/* GENERATED by scripts/generate-dark-theme.mjs from globals.css — do not edit by hand; edit the generator's manual block instead. */\n";
writeFileSync(OUT, header + convert(source) + manual);
console.log(`Wrote ${OUT.pathname} (${convert(source).split("\n").length} rules)`);
