const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const scale = parseFloat(process.argv[3] || '2');

if (!dir) {
  console.error('Usage: node svg2png.js <dir> [scale=2]');
  process.exit(1);
}

const CSS_VAR_VALUES = {
  '--bg': '#FFFFFF',
  '--fg': '#111827',
  '--fg2': '#4B5563',
  '--subtitle': '#6B7280',
  '--axis': '#6B7280',
  '--grid': '#F3F4F6',
  '--legend-border': '#E5E7EB',
  '--gate': '#B91C1C',
  '--zone-fill': '#D1FAE5',
  '--zone-fill-opacity': '0.5',
  '--zone-text': '#166534',
};

function inlineCssVars(svg) {
  let s = svg;
  for (const [name, value] of Object.entries(CSS_VAR_VALUES)) {
    const re = new RegExp(`var\\(${name.replace(/-/g, '\\-')}\\)`, 'g');
    s = s.replace(re, value);
  }
  s = s.replace(/@media\s*\([^)]*\)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  return s;
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg'));
for (const file of files) {
  const svgPath = path.join(dir, file);
  const pngPath = path.join(dir, file.replace(/\.svg$/, '.png'));
  const rawSvg = fs.readFileSync(svgPath, 'utf8');
  const svg = inlineCssVars(rawSvg);

  const viewBoxMatch = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBoxMatch) {
    console.error(`No viewBox in ${file}`);
    continue;
  }
  const targetWidth = Math.round(parseFloat(viewBoxMatch[1]) * scale);

  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: targetWidth },
      background: '#FFFFFF',
      font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
    });
    const png = resvg.render().asPng();
    fs.writeFileSync(pngPath, png);
    console.log(`${file} -> ${path.basename(pngPath)} (${(png.length / 1024).toFixed(1)} KB, width=${targetWidth}px)`);
  } catch (err) {
    console.error(`Failed on ${file}:`, err.message);
  }
}
