/* Generates the wheel and tyre illustrations for the parts page.

   Drawn rather than photographed, for the same reasons as the sound bar:
   no copyright question over a manufacturer's product shot, no brand name
   on a part we may not always stock, and a few KB instead of a JPEG.

   Written as a generator because the spokes and the tread blocks are
   points on an ellipse — computing them is reliable, hand-writing sixty
   pairs of coordinates is not.

   The 3/4 view is faked the way it is in a technical illustration: the
   far rim of the tyre is drawn first, offset sideways, and the near face
   goes on top. The crescent left visible between the two reads as the
   depth of the tread. */

import fs from "node:fs";

const OUT = "C:/Users/willi/OneDrive/Documents/Claude Code/Aledo Golf Carts/assets/";
const W = 800, H = 600;

const n = (v) => Number(v).toFixed(1);

/* Shared scenery: a light studio sweep, which is how every tyre catalogue
   shoots this. A black tyre on a dark ground is a silhouette — the first
   attempt proved that, and no amount of tread detail rescues it. */
function backdrop() {
  return `
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="400" cy="529" rx="286" ry="30" fill="url(#pool)"/>`;
}

function commonDefs(extra = "") {
  return `<defs>
    <radialGradient id="bg" cx="0.42" cy="0.34" r="0.95">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#f2ece4"/>
      <stop offset="1" stop-color="#ded5c9"/>
    </radialGradient>
    <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="rgba(23,21,18,0.34)"/>
      <stop offset="1" stop-color="rgba(23,21,18,0)"/>
    </radialGradient>

    <!-- Rubber. Lit from the upper left, falling away to the lower right. -->
    <linearGradient id="rubber" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#5a626a"/>
      <stop offset="0.3" stop-color="#3b4148"/>
      <stop offset="0.72" stop-color="#242930"/>
      <stop offset="1" stop-color="#171b1f"/>
    </linearGradient>
    <linearGradient id="tread" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#484f57"/>
      <stop offset="0.45" stop-color="#2c3239"/>
      <stop offset="1" stop-color="#1a1e23"/>
    </linearGradient>
    <linearGradient id="sidewall" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#31363b"/>
      <stop offset="0.45" stop-color="#1e2226"/>
      <stop offset="1" stop-color="#101213"/>
    </linearGradient>
    ${extra}
  </defs>`;
}

/* ── The tread band, as a closed path ──
   Used both to fill the band and as a clip, so the blocks drawn into it
   cannot escape past the tyre's outline. Without the clip they overshoot
   the far rim and the tyre reads as a comb rather than a tyre. */
function bandPath(cx, cy, rx, ry, dx, dy) {
  return (
    `M ${n(cx)} ${n(cy - ry)} ` +
    `A ${rx} ${ry} 0 0 1 ${n(cx)} ${n(cy + ry)} ` +
    `L ${n(cx + dx)} ${n(cy + dy + ry)} ` +
    `A ${rx} ${ry} 0 0 0 ${n(cx + dx)} ${n(cy + dy - ry)} Z`
  );
}

/* ── Tread blocks across the band ──
   Each block runs from the near rim towards the far one, following the
   direction the carcass recedes. Only the arc facing the viewer is drawn;
   anything on the far side is behind the tyre. */
function treadBlocks({ cx, cy, rx, ry, dx, dy, fromDeg, toDeg, count, inset }) {
  const out = [];
  const pad = inset === undefined ? 6 : inset;
  for (let i = 0; i <= count; i++) {
    const a = ((fromDeg + (toDeg - fromDeg) * (i / count)) * Math.PI) / 180;
    const x1 = cx + Math.cos(a) * rx;
    const y1 = cy + Math.sin(a) * ry;
    /* The matching point on the far rim, so the block lies along the
       carcass instead of shooting off at a fixed angle. */
    const x2 = cx + dx + Math.cos(a) * rx;
    const y2 = cy + dy + Math.sin(a) * ry;

    const vx = x2 - x1, vy = y2 - y1;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len, uy = vy / len;

    const wide = i % 2 === 0;
    out.push(
      `<line x1="${n(x1 + ux * pad)}" y1="${n(y1 + uy * pad)}" ` +
        `x2="${n(x2 - ux * pad)}" y2="${n(y2 - uy * pad)}" ` +
        `stroke="#0b0e11" stroke-width="${wide ? 11 : 6}" stroke-linecap="round" ` +
        `opacity="${wide ? 0.92 : 0.62}"/>`
    );
  }
  return out.join("\n    ");
}

/* ══════════════ 1. WHEEL AND TYRE ══════════════ */
function wheelSvg() {
  /* Near face, turned a little towards the viewer */
  const cx = 336, cy = 290, rx = 192, ry = 246;
  /* How far the far rim sits behind — this is the apparent tread width.
     Keep it modest: too much and the tyre reads as a barrel. */
  const dx = 112, dy = 12;
  const spokes = 14;

  const rimRx = 138, rimRy = 178;
  const faceRx = 118, faceRy = 152;

  let spokeSvg = "";
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 - Math.PI / 2;
    /* Split spokes: two thin legs meeting at the hub, which is what gives
       an aftermarket wheel its busy, expensive look. */
    [-0.055, 0.055].forEach((off) => {
      const a2 = a + off;
      spokeSvg +=
        `<path d="M ${n(cx + Math.cos(a) * 30)} ${n(cy + Math.sin(a) * 38)} ` +
        `L ${n(cx + Math.cos(a2) * faceRx * 0.97)} ${n(cy + Math.sin(a2) * faceRy * 0.97)}" ` +
        `stroke="#14171a" stroke-width="14" stroke-linecap="round"/>\n    `;
      spokeSvg +=
        `<path d="M ${n(cx + Math.cos(a) * 30)} ${n(cy + Math.sin(a) * 38)} ` +
        `L ${n(cx + Math.cos(a2) * faceRx * 0.97)} ${n(cy + Math.sin(a2) * faceRy * 0.97)}" ` +
        `stroke="#7c858f" stroke-width="5" stroke-linecap="round" opacity="0.95"/>\n    `;
    });
  }

  /* Lug nuts on the hub */
  let lugs = "";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    lugs += `<circle cx="${n(cx + Math.cos(a) * 44)}" cy="${n(cy + Math.sin(a) * 56)}" r="7" fill="#0d0f10"/>
    <circle cx="${n(cx + Math.cos(a) * 44)}" cy="${n(cy + Math.sin(a) * 56 - 2)}" r="4.5" fill="#4a5158"/>\n    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
     aria-label="Illustration of an aftermarket golf cart wheel with an all-terrain tyre">
  <title>Aftermarket golf cart wheel and all-terrain tyre</title>
  ${commonDefs(`
    <linearGradient id="rim" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#2b3035"/>
      <stop offset="0.45" stop-color="#171a1e"/>
      <stop offset="1" stop-color="#0c0e10"/>
    </linearGradient>
    <linearGradient id="lip" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d757c"/>
      <stop offset="0.5" stop-color="#2c3135"/>
      <stop offset="1" stop-color="#14171a"/>
    </linearGradient>`)}
  ${backdrop()}

  <!-- Far rim of the tyre, offset to give the carcass its width -->
  <ellipse cx="${n(cx + dx)}" cy="${n(cy + dy)}" rx="${rx}" ry="${ry}" fill="#0a0b0c"/>

  <!-- The tread band: the crescent between far rim and near face -->
  <clipPath id="bandClip"><path d="${bandPath(cx, cy, rx, ry, dx, dy)}"/></clipPath>
  <path d="${bandPath(cx, cy, rx, ry, dx, dy)}" fill="url(#tread)"/>
  <g clip-path="url(#bandClip)">
    ${treadBlocks({ cx, cy, rx, ry, dx, dy, fromDeg: -90, toDeg: 90, count: 26 })}
    <!-- Circumferential groove. Without it the blocks read as machined
         ribs; with it they read as two staggered rows of tread. -->
    <path d="M ${n(cx + dx / 2)} ${n(cy + dy / 2 - ry)} A ${rx} ${ry} 0 0 1 ${n(cx + dx / 2)} ${n(cy + dy / 2 + ry)}"
          fill="none" stroke="#3f464d" stroke-width="8" opacity="0.7"/>
  </g>
  <path d="${bandPath(cx, cy, rx, ry, dx, dy)}" fill="none" stroke="#0b0e11" stroke-width="3"/>

  <!-- Near sidewall -->
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#rubber)"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#07080a" stroke-width="3"/>
  <!-- Moulded rings and a hint of raised lettering on the sidewall -->
  <ellipse cx="${cx}" cy="${cy}" rx="${n(rx - 20)}" ry="${n(ry - 26)}" fill="none" stroke="#000" stroke-width="3" opacity="0.55"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${n(rx - 34)}" ry="${n(ry - 44)}" fill="url(#sidewall)"/>
  <g opacity="0.4" stroke="#8a929a" stroke-width="3" stroke-linecap="round">
    <path d="M ${n(cx - 150)} ${n(cy + 96)} l 22 -9"/>
    <path d="M ${n(cx - 140)} ${n(cy + 118)} l 30 -12"/>
  </g>

  <!-- Rim -->
  <ellipse cx="${cx}" cy="${cy}" rx="${rimRx}" ry="${rimRy}" fill="url(#lip)"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${n(rimRx - 9)}" ry="${n(rimRy - 12)}" fill="url(#rim)"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${n(rimRx - 9)}" ry="${n(rimRy - 12)}" fill="none" stroke="#0a0c0d" stroke-width="3"/>

  <!-- Spokes -->
  <g>
    ${spokeSvg.trim()}
  </g>

  <!-- Hub and cap -->
  <ellipse cx="${cx}" cy="${cy}" rx="72" ry="92" fill="#191c1f"/>
  <ellipse cx="${cx}" cy="${cy}" rx="72" ry="92" fill="none" stroke="#0a0c0d" stroke-width="3"/>
  ${lugs.trim()}
  <ellipse cx="${cx}" cy="${cy}" rx="34" ry="43" fill="#101314" stroke="#4a5158" stroke-width="3"/>
  <path d="M ${cx} ${cy - 20} l 17 10 v 20 l -17 10 l -17 -10 v -20 Z"
        fill="none" stroke="#E36623" stroke-width="3" stroke-linejoin="round"/>

  <!-- Specular sweep across the upper left of the whole wheel -->
  <path d="M ${n(cx - rx * 0.72)} ${n(cy - ry * 0.5)}
           A ${rx} ${ry} 0 0 1 ${n(cx + rx * 0.1)} ${n(cy - ry * 0.95)}"
        fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="9" stroke-linecap="round"/>
</svg>
`;
}

/* ══════════════ 2. TYRE ONLY ══════════════ */
function tyreSvg() {
  /* Laid over further than the wheel, so the tread is the subject and the
     barrel is visible through the middle. */
  const cx = 322, cy = 292, rx = 166, ry = 242;
  const dx = 140, dy = 10;
  const bandRx = 112, bandRy = 172;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
     aria-label="Illustration of an all-terrain golf cart tyre showing the tread pattern">
  <title>All-terrain golf cart tyre</title>
  ${commonDefs(`
    <radialGradient id="barrel" cx="0.42" cy="0.4" r="0.75">
      <stop offset="0" stop-color="#0a0b0c"/>
      <stop offset="0.65" stop-color="#15181a"/>
      <stop offset="1" stop-color="#22262a"/>
    </radialGradient>`)}
  ${backdrop()}

  <!-- Far rim -->
  <ellipse cx="${n(cx + dx)}" cy="${n(cy + dy)}" rx="${rx}" ry="${ry}" fill="#0a0b0c"/>

  <!-- Tread band across the middle -->
  <clipPath id="bandClip"><path d="${bandPath(cx, cy, rx, ry, dx, dy)}"/></clipPath>
  <path d="${bandPath(cx, cy, rx, ry, dx, dy)}" fill="url(#tread)"/>

  <!-- Blocks, clipped to the band, with a circumferential groove down the
       centre — which is what an all-terrain tread looks like, rather than
       one row of teeth. -->
  <g clip-path="url(#bandClip)">
    ${treadBlocks({ cx, cy, rx, ry, dx, dy, fromDeg: -90, toDeg: 90, count: 30, inset: 4 })}
    <path d="M ${n(cx + dx / 2)} ${n(cy + dy / 2 - ry)} A ${rx} ${ry} 0 0 1 ${n(cx + dx / 2)} ${n(cy + dy / 2 + ry)}"
          fill="none" stroke="#3d444b" stroke-width="9" opacity="0.75"/>
  </g>
  <path d="${bandPath(cx, cy, rx, ry, dx, dy)}" fill="none" stroke="#0b0e11" stroke-width="3"/>

  <!-- Near sidewall -->
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#rubber)"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#07080a" stroke-width="3"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${n(rx - 18)}" ry="${n(ry - 26)}" fill="none" stroke="#000" stroke-width="3" opacity="0.5"/>

  <!-- Raised lettering, suggested rather than spelled out -->
  <g opacity="0.42" stroke="#949ba2" stroke-width="3.4" stroke-linecap="round">
    <path d="M ${n(cx - 118)} ${n(cy + 74)} l 26 -10"/>
    <path d="M ${n(cx - 108)} ${n(cy + 100)} l 34 -13"/>
    <path d="M ${n(cx - 92)} ${n(cy + 124)} l 22 -9"/>
  </g>

  <!-- The barrel, seen through the bead -->
  <ellipse cx="${cx}" cy="${cy}" rx="${bandRx}" ry="${bandRy}" fill="url(#barrel)"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${bandRx}" ry="${bandRy}" fill="none" stroke="#050607" stroke-width="4"/>
  <!-- Inner wall catching a little light on the far side -->
  <path d="M ${n(cx + 20)} ${n(cy - bandRy + 16)} A ${n(bandRx - 14)} ${n(bandRy - 14)} 0 0 1 ${n(cx + 20)} ${n(cy + bandRy - 16)}"
        fill="none" stroke="#2e3438" stroke-width="16" opacity="0.7"/>
  <!-- Bead seat -->
  <ellipse cx="${cx}" cy="${cy}" rx="${n(bandRx + 12)}" ry="${n(bandRy + 16)}" fill="none" stroke="#3a4045" stroke-width="4" opacity="0.5"/>

  <!-- Specular sweep -->
  <path d="M ${n(cx - rx * 0.74)} ${n(cy - ry * 0.46)}
           A ${rx} ${ry} 0 0 1 ${n(cx + rx * 0.06)} ${n(cy - ry * 0.96)}"
        fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="10" stroke-linecap="round"/>
</svg>
`;
}

fs.writeFileSync(OUT + "acc-wheels.svg", wheelSvg(), "utf8");
fs.writeFileSync(OUT + "acc-tires.svg", tyreSvg(), "utf8");

[["acc-wheels.svg", wheelSvg()], ["acc-tires.svg", tyreSvg()]].forEach(([f, s]) => {
  const open = (s.match(/<[a-zA-Z]/g) || []).length;
  const close = (s.match(/<\//g) || []).length + (s.match(/\/>/g) || []).length;
  console.log(`  ${f.padEnd(18)} ${String(s.length).padStart(6)} bytes  tags ${open}/${close} ${open === close ? "balanced" : "*** UNBALANCED ***"}`);
});
