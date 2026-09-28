// Original vector drawings. Exact-model photo evidence lives in the catalogue.
// Shared primitives describe a verified head shape, never a model fallback.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'src/data/train-art.json'), 'utf8'));
const profiles = {
  'CR400AF': ['af', 'red'], 'CR400AF-A': ['af', 'red'], 'CR400AF-B': ['af', 'red'], 'CR400AF-G': ['af', 'red'],
  'CR400AF-C': ['afz', 'ribbon'], 'CR400AF-Z': ['afz', 'ribbon'], 'CR400AF-AZ': ['afz', 'ribbon'], 'CR400AF-BZ': ['afz', 'ribbon'],
  'CR400AF-S': ['afz', 'ribbon'], 'CR400AF-AS': ['afz', 'ribbon'], 'CR400AF-BS': ['afz', 'ribbon'], 'CR400AF-AE': ['afz', 'ribbon'],
  'CR400AF-GZ': ['afz', 'ribbon'],
  'CR400BF': ['bf', 'gold'], 'CR400BF-A': ['bf', 'gold'], 'CR400BF-B': ['bf', 'gold'], 'CR400BF-G': ['bf', 'gold'],
  'CR400BF-C': ['bfc', 'olympic'], 'CR400BF-Z': ['bfz', 'goldribbon'], 'CR400BF-AZ': ['bfz', 'goldribbon'],
  'CR400BF-BZ': ['bfz', 'goldribbon'], 'CR400BF-S': ['bfz', 'goldribbon'], 'CR400BF-AS': ['bfz', 'goldribbon'],
  'CR400BF-BS': ['bfz', 'goldribbon'], 'CR400BF-GZ': ['bfz', 'goldribbon'],
  'CR300AF': ['af', 'blue-red'], 'CR300BF': ['bf', 'blue-gold'],
  'CRH1A': ['regina', 'blue'], 'CRH1A-A': ['zefiro250', 'blue'], 'CRH1B': ['regina', 'blue'],
  'CRH2A': ['h2', 'blue'], 'CRH2B': ['h2', 'blue'], 'CRH2G': ['h2g', 'blue'],
  'CRH3A': ['h3a', 'blue'], 'CRH3C': ['velaro', 'blue'],
  'CRH380A': ['rocket', 'blue'], 'CRH380AL': ['rocket', 'blue'],
  'CRH380B': ['velaro', 'blue'], 'CRH380BG': ['velaro', 'blue'], 'CRH380BL': ['velaro', 'blue'],
  'CRH380CL': ['hcl', 'blue'], 'CRH380D': ['zefiro380', 'blue'],
  'CRH5A': ['h5', 'blue'], 'CRH5G': ['h5g', 'blue'], 'CRH6A': ['h6', 'blue'], 'CRH6F': ['h6f', 'blue'],
};

const shapes = {
  af: { body:'M16 77 Q18 64 47 54 L82 28 Q91 21 112 21 H302 Q308 21 308 29 V85 H31 Q16 85 16 77Z', cab:'M56 49 85 29 Q89 26 100 26 L99 44 65 51Z', side:'M103 39 118 39 118 54 99 54Z' },
  afz: { body:'M12 80 Q13 69 47 61 Q59 57 80 37 Q95 21 128 21 H302 Q308 21 308 29 V85 H29 Q12 85 12 80Z', cab:'M59 51 Q79 33 96 29 L116 27 105 43 79 51Z', side:'M107 43 130 40 130 54 97 55Z' },
  bf: { body:'M20 74 Q20 55 43 43 L66 29 Q79 21 105 21 H302 Q308 21 308 29 V85 H37 Q20 85 20 74Z', cab:'M40 45 68 29 Q73 26 90 26 L91 43 56 49Z', side:'M94 39 116 39 116 54 91 54Z' },
  bfz: { body:'M12 81 Q14 73 43 62 L82 33 Q97 21 126 21 H302 Q308 21 308 29 V85 H30 Q12 85 12 81Z', cab:'M53 54 89 30 Q98 26 116 26 L105 43 70 57Z', side:'M109 41 134 39 134 54 104 56Z' },
  bfc: { body:'M13 80 Q13 70 38 63 L72 36 Q87 21 120 21 H302 Q308 21 308 29 V85 H30 Q13 85 13 80Z', cab:'M51 53 76 33 Q83 26 105 26 L105 44 68 54Z', side:'M110 39 132 39 132 54 106 54Z' },
  h2: { body:'M22 76 Q21 61 42 49 Q57 39 65 27 Q76 21 110 21 H302 Q308 21 308 29 V85 H39 Q22 85 22 76Z', cab:'M41 48 Q54 36 67 29 L88 28 87 42 58 49Z', side:'M96 39 H113 V53 H96Z' },
  rocket: { body:'M10 80 Q10 72 37 68 Q54 64 69 47 Q85 21 124 21 H302 Q308 21 308 29 V85 H28 Q10 85 10 80Z', cab:'M61 55 Q75 34 96 28 L117 26 105 40 80 49Z', side:'M109 41 H131 V54 H99Z' },
  velaro: { body:'M20 75 Q19 58 46 43 L69 29 Q81 21 110 21 H302 Q308 21 308 29 V85 H37 Q20 85 20 75Z', cab:'M41 44 71 28 H96 L96 43 55 50Z', side:'M101 38 H122 V53 H98Z' },
  hcl: { body:'M16 77 Q17 65 45 52 Q56 46 72 29 Q83 21 114 21 H302 Q308 21 308 29 V85 H34 Q16 85 16 77Z', cab:'M48 50 78 29 H99 L97 44 63 55Z', side:'M101 39 H124 V54 H97Z' },
  regina: { body:'M26 77 Q25 61 38 44 L52 27 Q62 21 86 21 H302 Q308 21 308 29 V85 H40 Q26 85 26 77Z', cab:'M36 44 56 29 H73 L69 47 40 52Z', side:'M78 34 H95 V54 H78Z' },
  zefiro250: { body:'M24 76 Q23 60 42 47 L65 28 Q75 21 105 21 H302 Q308 21 308 29 V85 H39 Q24 85 24 76Z', cab:'M40 47 70 27 H96 L88 46 51 54Z', side:'M102 39 H121 V54 H96Z' },
  zefiro380: { body:'M13 79 Q14 65 42 53 L75 30 Q89 21 117 21 H302 Q308 21 308 29 V85 H30 Q13 85 13 79Z', cab:'M46 52 80 29 H102 L99 43 60 57Z', side:'M106 38 H126 V54 H101Z' },
  h5: { body:'M24 78 Q24 59 42 48 L59 30 Q70 21 103 21 H302 Q308 21 308 29 V85 H39 Q24 85 24 78Z', cab:'M39 44 65 28 H85 L81 42 49 49Z', side:'M93 36 H112 V53 H90Z' },
  h5g: { body:'M20 80 Q20 64 41 49 L61 28 Q74 21 107 21 H302 Q308 21 308 29 V85 H37 Q20 85 20 80Z', cab:'M39 46 66 28 H91 L84 44 48 51Z', side:'M96 36 H115 V53 H91Z' },
  h3a: { body:'M20 77 Q21 58 46 43 L65 29 Q77 21 106 21 H302 Q308 21 308 29 V85 H36 Q20 85 20 77Z', cab:'M39 47 67 28 H92 L90 43 51 53Z', side:'M98 37 H118 V54 H93Z' },
  h2g: { body:'M23 77 Q23 59 42 48 L61 30 Q73 21 109 21 H302 Q308 21 308 29 V85 H38 Q23 85 23 77Z', cab:'M38 46 66 28 H89 L87 44 49 52Z', side:'M96 38 H117 V54 H92Z' },
  h6: { body:'M24 78 Q22 64 35 48 L45 29 Q52 21 79 21 H302 Q308 21 308 29 V85 H39 Q24 85 24 78Z', cab:'M35 47 48 29 H70 L68 50 40 55Z', side:'M76 35 H94 V54 H76Z' },
  h6f: { body:'M22 79 Q23 59 43 45 L62 29 Q74 21 102 21 H302 Q308 21 308 29 V85 H40 Q22 85 22 79Z', cab:'M37 48 65 28 H89 L84 46 48 56Z', side:'M94 36 H114 V54 H90Z' },
};
const esc = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const out = path.join(root, 'src/assets/trains');
fs.mkdirSync(out, { recursive: true });
for (const item of catalogue) {
  const profile = profiles[item.model];
  if (!profile) throw new Error('No inspected drawing profile: ' + item.model);
  const [head, paint] = profile;
  const shape = shapes[head];
  const fuxing = item.model.startsWith('CR400') || item.model.startsWith('CR300');
  const body = item.model.startsWith('CR300') ? '#afd4ed' : head === 'afz' || head === 'bfz' || item.model.startsWith('CR400AF') ? '#dfe6eb' : '#f7fafc';
  const stripe = ['red','blue-red'].includes(paint) ? '#cb3546' : paint === 'blue-gold' ? '#c48b3e' : ['gold','goldribbon'].includes(paint) ? '#c9a146' : '#2675bb';
  let livery = '';
  if (paint === 'ribbon') {
    livery = `<path d="M17 73 Q50 69 78 44 Q111 18 155 31 Q208 47 248 30 Q282 17 316 29" fill="none" stroke="#cb3046" stroke-width="9"/><path d="M17 77 Q52 73 79 49 Q112 24 156 36 Q209 52 249 35 Q282 23 316 34" fill="none" stroke="#efb846" stroke-width="3"/><path d="M42 83 Q88 58 135 63 Q179 83 225 68 Q270 50 316 70" fill="none" stroke="#ca3046" stroke-width="7"/><path d="M42 85 Q87 63 134 68 Q180 87 225 73 Q270 55 316 75" fill="none" stroke="#efb846" stroke-width="2.5"/>`;
  } else if (paint === 'goldribbon') {
    livery = `<path d="M26 76 Q56 64 82 47 Q111 31 153 36 Q174 39 200 36" fill="none" stroke="#c52d42" stroke-width="3"/><path d="M50 84 Q87 59 134 62 Q181 81 227 76 Q268 70 316 62" fill="none" stroke="#c52d42" stroke-width="10"/><path d="M43 83 Q87 64 134 69 Q180 86 227 81 Q269 75 316 67" fill="none" stroke="#c9a146" stroke-width="2.5"/>`;
  } else if (paint === 'olympic') {
    livery = `<path d="M8 65 Q56 60 91 52 Q141 44 190 54 Q245 67 316 53 V80 H8Z" fill="#5ba8db"/><path d="M48 80 Q90 55 154 62 Q213 82 270 67 L316 63" fill="none" stroke="#b6d9f0" stroke-width="8"/>`;
  } else if (fuxing) {
    livery = `<path d="M25 78 Q57 67 84 48 Q97 42 118 43 H316" fill="none" stroke="${stripe}" stroke-width="5"/><path d="M30 80 Q66 80 99 65 H316" fill="none" stroke="${stripe}" stroke-width="3"/>`;
    if (item.model.startsWith('CR300')) livery = `<path d="M12 69 Q59 79 111 76 H316 V89 H12Z" fill="#4488bd" opacity=".65"/>` + livery;
  } else {
    livery = `<path d="M15 63 H316" stroke="${stripe}" stroke-width="5"/><path d="M20 71 H316" stroke="${stripe}" stroke-width="2"/>`;
    if (head === 'rocket') livery += `<path d="M15 79 Q49 68 72 48 Q92 29 123 30" fill="none" stroke="#2675bb" stroke-width="4"/>`;
  }
  const band = fuxing || ['regina','zefiro250','zefiro380','h3a','h2g','h6','h6f','velaro','hcl','rocket'].includes(head);
  const windows = [174,201,228,255,282].map((x) => `<rect x="${x}" y="42" width="20" height="15" rx="3" fill="url(#glass)"/>`).join('');
  const twoPane = item.model === 'CRH380A' ? [174,201,228,255,282].map(x => `<path d="M${x+10} 43V56" stroke="#e6edf2" stroke-width="1.6"/>`).join('') : '';
  const doorX = head === 'regina' ? 126 : 143;
  const doorWidth = ['h6','h6f'].includes(head) ? 27 : 19;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 112" role="img" aria-labelledby="title desc">
<title id="title">${esc(item.model)} Q版首车侧视图</title><desc id="desc">${esc(item.livery+'。'+item.features+'。参考：'+item.source+'，摄影：'+item.author+'。首车示意，非完整编组。')}</desc>
<metadata>Original vector illustration: Yukino, 2026-09-28. CC BY-SA 4.0. Photo reference: ${esc(item.source)} (${esc(item.license)}).</metadata>
<defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".7" stop-color="${body}"/><stop offset="1" stop-color="#c9d4dd"/></linearGradient><linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#607e95"/><stop offset="1" stop-color="#243c50"/></linearGradient><clipPath id="car"><path d="${shape.body}"/></clipPath></defs>
<ellipse cx="166" cy="101" rx="143" ry="5" fill="#315c42" opacity=".08"/>
<g fill="#263c4c" stroke="#263c4c" stroke-width="1.5"><rect x="72" y="81" width="43" height="10" rx="4"/><rect x="250" y="81" width="42" height="10" rx="4"/><circle cx="81" cy="92" r="7"/><circle cx="106" cy="92" r="7"/><circle cx="258" cy="92" r="7"/><circle cx="283" cy="92" r="7"/></g>
<g fill="#b5c4cf"><circle cx="81" cy="92" r="3"/><circle cx="106" cy="92" r="3"/><circle cx="258" cy="92" r="3"/><circle cx="283" cy="92" r="3"/></g>
<path d="${shape.body}" fill="url(#body)"/>
<g clip-path="url(#car)"><path d="M10 80 H316 V90 H10Z" fill="#94a9b7" opacity=".55"/>${band ? '<path d="M116 40 H316 V60 H103Z" fill="#293d4e"/>' : ''}${livery}${windows}${twoPane}<path d="M${doorX} 34H${doorX+doorWidth}V80H${doorX}Z" fill="none" stroke="#7d939f" stroke-width="1.3"/><rect x="${doorX+4}" y="40" width="${doorWidth-8}" height="17" rx="2" fill="url(#glass)"/><path d="M${doorX+doorWidth-3} 65v5" stroke="#42586a" stroke-width="1.5"/><path d="M301 27V84" stroke="#8196a4" stroke-width="1.5"/><path d="M174 77H226" stroke="#93a7b5" stroke-width="1.1"/></g>
<path d="${shape.body}" fill="none" stroke="#425a6b" stroke-width="1.8" stroke-linejoin="round"/>
<g clip-path="url(#car)"><path d="${shape.cab}" fill="url(#glass)" stroke="#263f51" stroke-width="1.2"/><path d="${shape.side}" fill="url(#glass)" stroke="#263f51" stroke-width="1.2"/></g>
<path d="M${head==='regina'?32:27} 70l12-3" stroke="#f9f0b8" stroke-width="3.5" stroke-linecap="round"/>
<path d="M28 80Q36 78 47 80" fill="none" stroke="#8095a4" stroke-width="1.2"/><path d="M181 25H261" stroke="#e4ebef" stroke-width="3" stroke-linecap="round"/>
</svg>\n`;
  fs.writeFileSync(path.join(out, item.model + '.svg'), svg);
}
console.log(`Drew ${catalogue.length} exact-model SVGs`);
