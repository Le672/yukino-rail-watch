// Original code-native side views. Reference versions remain visibly labelled.
// The profile table records each inspected model rather than guessing by prefix.
import fs from 'node:fs';
import path from 'node:path';

const heads = {
  duck: ['M13 82Q11 75 29 67Q43 60 51 42Q65 22 100 21H302Q309 21 309 28V88H31Q15 88 13 82Z','M48 47Q54 27 82 24L104 24Q77 30 66 46Z','M69 37H91L94 44H67Z','M43 61 53 54 60 55 51 63Z',126,null],
  duckStandard: ['M12 82Q11 74 32 64Q49 55 64 34Q78 21 115 21H302Q309 21 309 28V88H29Q13 88 12 82Z','M47 54 68 34Q80 24 102 23L117 25Q91 29 74 45L58 55Z','M77 40 95 32 106 34V44L88 47Z','M42 64 53 56 60 57 50 65Z',128,null],
  rocketStandard: ['M10 83Q10 74 32 63L63 40Q81 22 120 21H302Q309 21 309 28V88H28Q12 88 10 83Z','M54 44Q75 23 110 22L128 24Q99 27 78 40Z','','M31 71 46 65 54 66 42 73Z',129,'M127 43H312V61H89Q104 49 127 43Z'],
  zefiro250: ['M21 82Q18 71 32 56L57 31Q71 21 103 21H302Q309 21 309 28V88H38Q23 88 21 82Z','M32 61 59 31Q77 21 96 23L110 26Q82 28 66 42L44 64Z','M60 43 78 30H96L96 47 69 52Z','M33 66 45 60 50 62 39 68Z',122,'M106 43H312V61H99Z'],
  cinova: ['M24 82Q21 64 31 43L43 28Q52 21 81 21H302Q309 21 309 28V88H39Q26 88 24 82Z','M29 62 38 32Q43 25 67 24L84 26Q65 31 55 44L43 66Z','M58 39 73 31 86 34V50L63 55Z','M30 68 42 66 48 69 33 72Z',115,'M90 43H312V64H72Z'],
  cinova2: ['M17 82Q15 67 36 50L67 27Q81 20 118 21H302Q309 21 309 28V88H35Q19 88 17 82Z','M25 68 56 41Q76 22 109 22L126 24Q97 30 79 46L37 73Z','M73 46 91 31H111L110 48 86 54Z','M30 69 46 58 51 60 38 72Z',126,'M115 43H312V63H93Z'],
  h3a: ['M15 82Q12 72 34 57L63 34Q79 21 118 21H302Q309 21 309 28V88H33Q17 88 15 82Z','M27 66 61 38Q79 24 108 23L120 26Q90 31 73 46L39 71Z','M75 47 99 33H117V51H82Z','M32 68 46 57 51 59 41 72Z',133,'M123 43H312V63H103Z'],
  h3x: ['M10 83Q8 76 27 64L65 38Q82 21 123 21H302Q309 21 309 28V88H28Q12 88 10 83Z','M24 68 62 42Q83 24 115 22L130 25Q101 30 78 48L38 74Z','M75 47 106 32H123V50L86 55Z','M31 69 47 58 55 61 41 73Z',134,'M127 43H312V63H104Z'],
  jPower: ['M27 82Q22 66 34 45Q49 21 91 20H302Q309 20 309 28V88H43Q29 88 27 82Z','M29 64Q31 40 61 25L96 22Q64 32 49 52L40 71Z','M57 47 74 31H90V50L65 56Z','M31 69 42 57 47 60 38 73Z',122,'M102 42H312V64H80Z'],
  j220: ['M23 82Q20 68 33 48L55 30Q70 20 103 20H302Q309 20 309 28V88H40Q25 88 23 82Z','M29 63 49 34Q66 22 93 22L108 25Q80 31 64 49L42 70Z','M67 46 85 31H98V50L76 55Z','M30 68 44 56 49 59 38 74Z',131,'M108 43H312V62H91Z'],
  flat: ['M32 82V33Q35 21 55 21H302Q309 21 309 28V88H42Q34 88 32 82Z','M32 33Q35 24 43 25L48 29V72H32Z','M52 35H69V54H52Z','M34 72H42V76H34Z',89,'M75 42H312V62H75Z'],
  ndj: ['M30 82Q25 74 32 53L42 31Q46 21 75 21H302Q309 21 309 28V88H45Q32 88 30 82Z','M31 63 40 33Q43 25 57 25L70 28 58 66Z','M62 36H76V54H59Z','M32 67H41V72H32Z',111,null],
};
const pathSvg = (d, fill) => `<path d="${d}" fill="${fill}"/>`;
const stroke = (d, color, width=2) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
const paints = {
  blue: stroke('M31 75Q82 61 115 64H314','#174e92',2.6),
  blueGold: stroke('M30 74Q81 61 116 65H314','#174e92',2.6)+stroke('M31 77Q82 64 116 68H314','#caa74c',.8),
  red: stroke('M29 72Q72 54 116 63H314','#ce3444',2.7),
  orange: pathSvg('M48 69 104 33 131 43 93 63Z','#ce8749')+stroke('M65 71 120 65H314','#174e92',2.6),
  winter: pathSvg('M20 81Q65 54 107 42H314V86H20Z','#e1eff7')+pathSvg('M32 82 101 52 129 58 166 48 210 61 252 46 314 56V87H32Z','#4f9abd')+stroke('M49 70 114 63H314','#1d548a',2),
  purple: pathSvg('M40 78 108 40H314V58H105L64 82Z','#574386')+pathSvg('M80 67 130 60 165 77 210 65 241 81 274 65 314 68V78L273 76 244 87 211 77 166 89 128 70Z','#c6338c'),
  sleeper: stroke('M33 73Q65 55 104 53H314','#1c3753',3)+pathSvg('M72 52Q103 40 127 39H314V59H104Z','#263c4b'),
  modernRed: pathSvg('M35 77 103 35 126 42 77 67Z','#bc2a36')+stroke('M76 64Q116 53 153 59H314','#bd293b',3)+pathSvg('M164 43h16v37h-16Z','#c93243'),
  greenJ: pathSvg('M37 62 93 35 117 43H314V65H89Z','#158b40')+pathSvg('M66 53 104 68H314V72H103L43 79Z','#dddf3e')+pathSvg('M16 25H314V42H76Z','#55be61'),
  whiteJ: pathSvg('M49 58 94 37 115 45H314V64H90Z','#166b4f')+stroke('M34 77Q68 57 86 61Q111 59 128 69H314','#ba3450',2.8)+stroke('M39 79Q71 64 92 66L127 73H314','#ba3450',1.4)+pathSvg('M18 85Q59 72 88 81H314V91H18Z','#166b4f'),
  crossGreen: pathSvg('M34 75 78 27H314V89H31Z','#3b9e46')+pathSvg('M74 47H314V64H72Z','#3b4a40')+stroke('M44 74 108 63H314','#c8483d',3)+stroke('M40 83 115 72H314','#d5d536',2),
  laos: pathSvg('M18 76Q63 41 101 40H314V63H99L35 86Z','#3449a3')+stroke('M31 77 112 62H314','#d1373b',4)+stroke('M31 81 111 66H314','#f5f6fa',3)+pathSvg('M18 85H314V91H18Z','#334393'),
  turquoise: pathSvg('M20 70 70 24H314V36H90L32 77Z','#39a7c8')+pathSvg('M62 53 105 41 145 48 145 60H100Z','#173954')+stroke('M40 78 116 65H314','#3e88c3',2.7),
  rainbow: pathSvg('M34 80 109 43H314V65H95Z','#257ca4')+pathSvg('M66 64 114 71H314V80H103L41 87Z','#dd5147')+pathSvg('M126 25h15v64h-15Z','#e4ac31')+pathSvg('M203 43h28v34h-28Z','#28a376'),
  greenWave: pathSvg('M58 67 112 44H314V67H109Z','#428360')+pathSvg('M91 68Q139 49 175 66Q224 93 260 72L314 66V77L261 83Q224 103 171 80Q140 67 91 73Z','#67a852'),
  redWave: stroke('M49 74 106 64H314','#c44951',2)+pathSvg('M92 64Q145 43 177 61Q218 91 258 66L314 59V70L260 79Q219 105 173 73Q141 56 92 69Z','#c74751'),
  orangeBand: stroke('M39 71 95 60H314','#da8735',3)+pathSvg('M93 32 121 45H314V49H119L85 40Z','#dd923c'),
  gold: stroke('M38 74 98 63H314','#b48a3d',3)+stroke('M45 77 98 66H314','#d7bb6c',1),
  flatBlue: stroke('M34 61H314','#256995',3)+pathSvg('M125 44h17v36h-17Z M225 44h17v36h-17Z','#3572a0'),
};

function coachSvg(item, p) {
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const green=['22B','25A','25B','25Z'].includes(p.type), red=p.type==='25G', redSilver=['25C','25DT'].includes(p.type);
  const color=green?'#284b3b':red?'#a7333d':redSilver?'#d9d9d3':'#eff2ef';
  const band=green?'#dec94d':red?'#efe7d1':redSilver?'#ba3946':'#215287';
  const windows=Array.from({length:8},(_,i)=>`<rect x="${65+i*27}" y="${p.double?40:44}" width="18" height="${p.double?13:24}" rx="${green?1.3:3}" fill="#253d49" stroke="#a3ada9" stroke-width="1"/>${green?`<path d="M${65+i*27} 54h18" stroke="#b5b6a3"/>`:''}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 112" role="img" aria-labelledby="title desc"><title id="title">${esc(item.model)} Q版客车车厢参考图</title><desc id="desc">${esc(item.referenceNote)}</desc><metadata>Yukino original vector drawing. Photo reference: ${esc(item.source)}; ${esc(item.author)}. CC BY-SA 4.0.</metadata><ellipse cx="160" cy="103" rx="147" ry="3" fill="#315c42" opacity=".07"/><g fill="#2e3c42"><rect x="46" y="86" width="53" height="9" rx="3"/><rect x="229" y="86" width="53" height="9" rx="3"/>${[56,88,240,271].map(x=>`<circle cx="${x}" cy="96" r="6"/>`).join('')}</g><g fill="#afb6b9">${[56,88,240,271].map(x=>`<circle cx="${x}" cy="96" r="2.3"/>`).join('')}</g><rect x="11" y="40" width="9" height="44" fill="#4d585b"/><rect x="299" y="40" width="9" height="44" fill="#4d585b"/><path d="M19 35Q20 25 32 25H287Q300 25 300 35V88H19Z" fill="${color}" stroke="#4b5d61" stroke-width="1.4"/><path d="M20 35Q20 25 32 25H287Q300 25 300 35Z" fill="#a2a9a8"/><path d="M20 39H299 M20 74H299" stroke="${band}" stroke-width="${green?2:4}"/>${!green&&!red&&!redSilver?'<path d="M59 39H285V73H59Z" fill="#245685"/>':''}${redSilver?'<path d="M20 72H299V88H20Z" fill="#4a98b0"/><path d="M20 72H299V78H20Z" fill="#ba3946"/>':''}${windows}${p.double?Array.from({length:8},(_,i)=>`<rect x="${65+i*27}" y="61" width="18" height="13" rx="2" fill="#253d49" stroke="#a3ada9" stroke-width=".8"/>`).join(''):''}<path d="M29 38h20v46H29Z M289 38h9v46h-9Z" fill="none" stroke="#859496"/><rect x="33" y="43" width="12" height="25" rx="3" fill="#28434c"/><path d="M19 85H300V89H19Z" fill="#52616a"/>${p.type==='22B'?Array.from({length:7},(_,i)=>`<path d="M${61+i*32} 28h13v-4h-13Z" fill="#7c898c"/>`).join(''):'<path d="M108 26h57v-5h-57Z M193 26h64v-5h-64Z" fill="#a3aeb0"/>'}</svg>\n`;
}

export function drawExtendedArt(root, render) {
  const catalogue=JSON.parse(fs.readFileSync(path.join(root,'src/data/train-art.json'),'utf8'));
  const profiles=JSON.parse(fs.readFileSync(path.join(root,'src/data/train-art-profiles.json'),'utf8'));
  let count=0;
  const generated=new Set();
  for(const item of catalogue) {
    const p=profiles[item.asset]; if(!p) continue;
    if(generated.has(item.asset)) continue;
    generated.add(item.asset);
    if(p.coach) fs.writeFileSync(path.join(root,'src/assets/trains',item.asset+'.svg'),coachSvg(item,p));
    else {
      const options={...p.options};
      if(heads[p.head]) options.head=heads[p.head];
      if(p.paint in paints) options.paintSvg=paints[p.paint];
      if(p.noPassengerWindows) options.windowsSvg='<path d="M164 48h32v11h-32Z M222 48h39v11h-39Z" fill="#677f78"/>'+Array.from({length:12},(_,i)=>`<path d="M${166+i*8} 48v10" stroke="#324b44" stroke-width="1"/>`).join('');
      if(p.double) options.windowsSvg=[43,65].map(y=>Array.from({length:6},(_,i)=>`<rect x="${159+i*27}" y="${y}" width="18" height="11" rx="2" fill="#1c3444"/>`).join('')).join('');
      render(item,[p.head,p.paint,options]);
    }
    count++;
  }
  console.log(`Drew ${count} additional passenger model reference illustrations`);
}
