const fs = require('fs');

const svgPath = process.argv[2];
if (!svgPath) {
  console.error('Usage: node redistribute-safety-halluc.js <svgPath>');
  process.exit(1);
}

let svg = fs.readFileSync(svgPath, 'utf8');

svg = svg.replace('viewBox="0 0 1500 700"', 'viewBox="0 0 1200 700"');

// Equal-gap layout: chart x=140-1110 (970 wide), 4 groups of 96 wide,
// 5 equal gaps of 117.2 each. Safety bar starts at chart_left + gap_n.
// Group n start = 140 + 117.2 * n + 96 * (n-1).
//   group1: 257.2
//   group2: 470.4
//   group3: 683.6
//   group4: 896.8
const replacements = [
  // gemma (+44): safety/halluc bars and their associated label x values
  ['x="213.2"', 'x="257.2"'],
  ['x="265.2"', 'x="309.2"'],
  ['x="235.2"', 'x="279.2"'],
  ['x="287.2"', 'x="331.2"'],
  ['x="261.2"', 'x="305.2"'],
  // qwen3.5:9b (+14.6)
  ['x="455.8"', 'x="470.4"'],
  ['x="507.8"', 'x="522.4"'],
  ['x="477.8"', 'x="492.4"'],
  ['x="529.8"', 'x="544.4"'],
  ['x="503.8"', 'x="518.4"'],
  // qwen3.5:4b (-14.6)
  ['x="698.2"', 'x="683.6"'],
  ['x="750.2"', 'x="735.6"'],
  ['x="720.2"', 'x="705.6"'],
  ['x="772.2"', 'x="757.6"'],
  ['x="746.2"', 'x="731.6"'],
  // qwen3.6 (-44)
  ['x="940.8"', 'x="896.8"'],
  ['x="992.8"', 'x="948.8"'],
  ['x="962.8"', 'x="918.8"'],
  ['x="1014.8"', 'x="970.8"'],
  ['x="988.8"', 'x="944.8"'],
];

for (const [oldStr, newStr] of replacements) {
  const before = svg.length;
  if (!svg.includes(oldStr)) {
    console.warn(`PATTERN NOT FOUND: ${oldStr}`);
    continue;
  }
  svg = svg.split(oldStr).join(newStr);
  const occurrences = (before - svg.length) / (oldStr.length - newStr.length);
  console.log(`${oldStr} -> ${newStr}  (${Math.abs(occurrences)} occurrences)`);
}

fs.writeFileSync(svgPath, svg);
console.log('Wrote', svgPath);
