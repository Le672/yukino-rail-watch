// Original side views from photographic evidence; China-EMU avatars are not traced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawCr200Art } from './draw-cr200-art.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
drawCr200Art(root);
const catalogue=JSON.parse(fs.readFileSync(path.join(root,'src/data/train-art.json'),'utf8'));
const profiles={
 'CR400AF':['af','af'],'CR400AF-A':['af','af'],'CR400AF-B':['af','af'],'CR400AF-G':['af','af'],
 'CR400AF-C':['afz','afc'],'CR400AF-Z':['afz','phoenix'],'CR400AF-AZ':['afz','phoenix'],'CR400AF-BZ':['afz','phoenix'],'CR400AF-AS':['afz','phoenix'],'CR400AF-BS':['afz','phoenix'],'CR400AF-AE':['afz','phoenix'],
 'CR400BF':['bf','bf'],'CR400BF-B':['bf','bf'],'CR400BF-G':['bf','bf'],
 'CR400BF-AZ':['bfz','dragon'],'CR400BF-BZ':['bfz','dragon'],'CR400BF-GZ':['bfz','dragon'],'CR400BF-AS':['bfz','upgrade'],'CR400BF-BS':['bfz','upgrade'],
 'CR300AF':['af300','af300'],'CR300BF':['bf300','bf300'],
 'CRH1A':['regina','regina'],'CRH1A-A':['z250','z250'],'CRH2G':['h2g','h2g'],'CRH3C':['h3c','velaro'],
 'CRH380A':['rocket','rocket'],'CRH380AL':['rocket','rocket'],'CRH380B':['h380b','velaro'],'CRH380BG':['h380b','velaro'],'CRH380BL':['h380b','velaro'],'CRH380CL':['hcl','velaro'],'CRH380D':['z380','z380'],'CRH5A':['h5','h5']
};
// [body outline, front mask, driver's SIDE window, headlight, door x, window belt]
const heads={
 af:['M17 80C15 69 27 62 36 52C45 31 66 21 94 21H302Q309 21 309 28V88H34Q18 88 17 80Z','M27 64C37 44 54 25 85 22L93 22C64 27 54 46 44 60L33 68Z','M56 49Q66 35 82 29L89 30V44L64 53Q57 54 56 49Z','M34 65 47 57 51 58 42 66Z',124,'M101 43H312V62H81Q88 50 101 43Z'],
 afz:['M12 82C12 74 27 68 41 60C58 42 70 24 100 21H302Q309 21 309 28V88H30Q13 88 12 82Z','M24 70Q46 52 61 35Q78 22 100 22L113 23Q81 27 68 43L36 73Z','M62 50Q77 34 93 31L105 32 100 46 72 56Q62 57 62 50Z','M34 66 48 57 52 58 43 67Z',123,'M110 43H312V63H79Q88 51 110 43Z'],
 bf:['M17 82C16 67 29 57 47 46C65 32 80 22 112 21H302Q309 21 309 28V88H36Q18 88 17 82Z','M33 58Q58 36 91 25L106 23Q72 33 47 57L35 63Z','M49 55Q44 51 49 46L81 31Q89 29 96 34L107 50Q93 56 73 58Q57 59 49 55Z','M29 69 40 64 43 65 35 72Z',137,'M115 44H312V63H98Z'],
 bfz:['M12 83Q11 75 29 65L62 40Q81 23 113 21H302Q309 21 309 28V88H28Q13 88 12 83Z','M21 72 56 45Q77 26 109 22L124 23Q95 27 74 44L32 76Z','M66 52 96 35H115V56H58Z','M29 68 46 58 50 60 34 71Z',126,'M114 44H312V63H64Z'],
 af300:['M18 81Q15 69 31 55Q50 27 79 22Q91 20 107 21H302Q309 21 309 28V88H35Q19 88 18 81Z','M29 67Q40 40 71 25L98 22Q68 32 58 48L40 70Z','M58 48 79 30H86L90 44 66 54Z','M31 64 42 54 47 56 39 67Z',123,'M105 43H312V62H82Z'],
 bf300:['M18 82Q16 66 36 51Q63 23 101 21H302Q309 21 309 28V88H35Q19 88 18 82Z','M27 66Q43 39 78 25L101 22Q67 34 52 54L36 71Z','M57 52Q57 43 85 30H99L99 47 69 57Z','M31 67 44 56 48 58 39 70Z',130,'M110 43H312V62H83Z'],
 regina:['M27 82Q24 67 29 49L35 30Q40 21 65 21H302Q309 21 309 28V88H40Q29 88 27 82Z','M27 62 34 30Q36 25 44 25L48 28 42 65Z','M50 35H65V54H47Z','M29 67H37V72H29Z',106,'M70 43H312V62H70Z'],
 z250:['M17 81Q14 72 30 62Q53 33 83 23Q95 20 120 21H302Q309 21 309 28V88H33Q18 88 17 81Z','M25 65Q50 35 78 26L105 22 100 28Q71 34 47 57L30 69Z','M62 48 84 33 103 32Q102 42 86 47L66 51Z','M29 67 43 60 47 61 35 69Z',124,'M116 44H312V61H97L82 54Z'],
 h2g:['M21 82Q17 68 33 53Q52 26 84 22Q97 20 118 21H302Q309 21 309 28V88H37Q23 88 21 82Z','M27 66Q36 40 70 25Q89 20 101 24Q68 32 57 48L37 72Z','M63 46 82 32H98L97 47 72 54Z','M31 64 43 55 47 58 39 68Z',125,'M109 43H312V61H93Z'],
 h3c:['M22 82Q19 62 40 47Q56 25 91 21H302Q309 21 309 28V88H38Q24 88 22 82Z','M31 62Q36 39 68 26L92 22Q67 29 54 45L37 66Z','M59 48Q65 36 81 32H103Q102 46 90 50L65 56Z','M29 69 37 58 43 60 36 72Z',128,'M112 43H312V62H97Z'],
 h380b:['M17 82Q14 69 33 55Q56 26 88 21H302Q309 21 309 28V88H34Q19 88 17 82Z','M25 67Q39 42 66 26L94 22Q65 31 52 49L34 70Z','M61 49Q72 35 85 32H107Q104 47 91 51L67 57Z','M28 70 40 57 46 60 35 73Z',130,'M113 43H312V62H98Z'],
 hcl:['M18 82Q16 69 35 57Q50 49 58 35Q70 21 109 21H302Q309 21 309 28V88H35Q20 88 18 82Z','M27 69Q45 57 52 40Q66 23 95 22L111 24Q77 30 67 48L36 73Z','M63 50Q67 32 90 31H108Q112 43 97 51L72 58Z','M32 66 44 56 48 59 38 70Z',133,'M117 43H312V62H99Z'],
 rocket:['M12 83Q10 77 23 70L54 50Q63 27 94 21H302Q309 21 309 28V88H30Q14 88 12 83Z','M39 56Q52 30 80 24L103 23Q78 29 65 43L45 59Z','M64 44Q74 32 88 30H109Q109 39 95 44L74 49Z','M43 60 59 52 67 52 60 59Z',124,'M115 43H312V61H94Z'],
 z380:['M16 82Q13 72 31 61Q57 34 88 24Q103 20 132 21H302Q309 21 309 28V88H32Q18 88 16 82Z','M25 64Q50 39 82 26L113 22Q83 30 57 51L30 68Z','M65 47Q82 32 103 31L116 35 99 46 73 51Z','M30 69 45 60 51 61 38 71Z',145,'M127 44H312V61H103L88 53Z'],
 h5:['M18 82Q15 73 29 62L59 36Q73 23 104 21H302Q309 21 309 28V88H34Q19 88 18 82Z','M25 69 57 40Q74 24 98 23L115 24Q83 29 68 42L35 71Z','M64 48 89 32 111 30Q111 40 96 45L69 55Z','M35 67 48 56 58 54 49 64Z',126,null]
};
const el=(d,f,extra='')=>`<path d="${d}" fill="${f}" ${extra}/>`;
const line=(d,c,w=1)=>el(d,'none',`stroke="${c}" stroke-width="${w}" stroke-linejoin="round"`);
const RED='#dc3040',GOLD='#d99b39',BLUE='#174e92';
function paintFor(p,h){
 if(p==='af'||p==='af300') return el('M51 76Q68 48 104 43L92 57 70 64Z',RED)+line('M69 64Q104 63 119 63H314',RED,2.6);
 if(p==='bf') return el('M41 73 94 30 121 42 99 64Z',GOLD)+el(h[2],'url(#glass)')+line('M54 69 114 66H314',GOLD,4)+line('M59 73 114 71H314',GOLD,1.5)+line('M48 58 88 27 106 25',GOLD,1.4);
 if(p==='bf300') return el('M42 72 89 28 114 41 88 61Z',GOLD)+line('M63 69Q101 63 122 63H314',GOLD,2.3);
 if(p==='phoenix') return el('M41 74Q73 41 103 29Q132 24 159 39L174 46Q132 30 110 40Q73 58 41 74Z',RED)+line('M45 72Q76 44 108 35Q136 31 164 43',GOLD,2.3)+el('M111 64Q157 58 189 73Q223 92 255 72Q278 57 314 66V76Q279 66 260 82Q224 104 186 83Q153 65 111 68Z',RED)+line('M114 65Q155 61 189 77Q224 95 257 77Q280 62 314 71',GOLD,2.5);
 if(p==='afc') return el('M35 76Q72 39 113 27Q151 24 180 38L314 38V42H181Q146 30 117 34Q77 45 35 76Z',RED)+line('M40 74Q77 44 117 33Q150 29 181 40H314',GOLD,2.1)+el('M65 66 112 61H314V65H113Z',RED);
 if(p==='dragon') return el('M36 75 108 39H314V65H84Z',RED)+el('M45 72 110 43H314V61H80Z','#152834')+el('M99 64Q142 60 175 72Q205 86 245 74Q278 62 314 64V78Q280 71 249 86Q207 100 171 86Q139 69 99 68Z',RED)+line('M99 68Q143 65 174 79Q209 94 247 81Q279 69 314 72',GOLD,2.7)+line('M96 41Q142 28 185 39',GOLD,2.2);
 if(p==='upgrade') return el('M35 75Q74 47 113 39Q151 30 174 40L182 45Q146 36 114 44L47 76Z',RED)+line('M83 49Q117 36 148 31Q173 31 191 40',GOLD,2.6)+el('M99 65Q150 57 180 73Q215 92 255 74Q282 61 314 65V78Q283 71 259 85Q214 106 178 86Q145 66 99 69Z',RED)+line('M101 68Q149 64 180 80Q216 97 256 81Q283 68 314 73',GOLD,2.7);
 if(p==='rocket') return el('M10 80Q34 64 50 43Q60 23 93 21H134Q98 32 80 49L27 84Z','url(#noseSilver)')+el('M21 84 83 57Q105 39 130 40L116 49 45 83Z','#fbfdff')+line('M39 77 94 64H314',BLUE,2.8);
 if(p==='velaro') return line('M39 73 78 61H314',BLUE,2.7)+el('M39 73 69 52 79 48 67 64Z',BLUE);
 if(p==='z250') return line('M31 69 79 62 104 66H314',BLUE,2.4);
 if(p==='z380') return line('M32 72Q63 65 101 66H314',BLUE,2.3);
 if(p==='regina') return line('M36 66H314','#1980bb',3)+line('M36 69H314','#69b5d8',1.2);
 if(p==='h2g') return line('M37 72Q73 67 108 64H314',BLUE,2.5);
 if(p==='h5') return line('M68 69 99 66H314',BLUE,2.6);
 throw Error('Unreviewed paint: '+p);
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const out=path.join(root,'src/assets/trains');fs.mkdirSync(out,{recursive:true});
for(const item of catalogue){
 if(item.accuracy==='reference'){
  if(!fs.existsSync(path.join(out,(item.asset||item.model)+'.svg'))) throw Error('Missing reference art: '+item.model);
  continue;
 }
 const profile=profiles[item.model];if(!profile) throw Error('No reviewed profile: '+item.model);
 const [head,paint]=profile,h=heads[head],silver=['af','afc','phoenix','dragon','upgrade','z380'].includes(paint),blueBody=['af300','bf300'].includes(paint);
 const xs=head==='regina'?[145,173,201,229,257,285]:[157,184,211,238,265,291];
 const windows=xs.map(x=>`<rect x="${x}" y="46" width="18" height="12" rx="1.8" fill="url(#glass)" stroke="#223746" stroke-width=".6"/>`).join('');
 const door=h[4];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 112" role="img" aria-labelledby="title desc">
<title id="title">${esc(item.model)} Q版首车侧视图</title><desc id="desc">${esc(item.livery+'。'+item.features+'。外观核对：'+item.reviewSource+'。首车比例压缩，参考外观，非实际编组。')}</desc>
<metadata>Yukino original side-view drawing, revision 2, 2026-09-29. CC BY-SA 4.0. Photo reference: ${esc(item.source)}; China-EMU review: ${esc(item.reviewSource)}. The site's front-view avatars are not reproduced.</metadata>
<defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${silver?'#eff2f3':'#fffef9'}"/><stop offset=".48" stop-color="${blueBody?'#d4e8f4':silver?'#cdd4da':'#f8faf7'}"/><stop offset="1" stop-color="${blueBody?'#58a2d2':silver?'#adb8c1':'#dbe1e1'}"/></linearGradient><linearGradient id="noseSilver" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d8e1e8"/><stop offset=".55" stop-color="#b8c6d0"/><stop offset="1" stop-color="#8b9fae"/></linearGradient><linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#3b5264"/><stop offset="1" stop-color="#122938"/></linearGradient><clipPath id="car"><path d="${h[0]}"/></clipPath></defs>
<ellipse cx="169" cy="102" rx="142" ry="3" fill="#315c42" opacity=".07"/>
<g fill="#293740"><rect x="70" y="84" width="43" height="10" rx="3"/><rect x="251" y="84" width="43" height="10" rx="3"/><circle cx="79" cy="95" r="6"/><circle cx="105" cy="95" r="6"/><circle cx="260" cy="95" r="6"/><circle cx="286" cy="95" r="6"/></g><g fill="#b0bac0"><circle cx="79" cy="95" r="2.5"/><circle cx="105" cy="95" r="2.5"/><circle cx="260" cy="95" r="2.5"/><circle cx="286" cy="95" r="2.5"/></g>
${el(h[0],'url(#body)')}<g clip-path="url(#car)">${el('M12 80H314V93H12Z',silver?'#687d8e':'#9daab1','opacity=".4"')}${h[5]?el(h[5],paint==='af'?'#6a737a':'#253d4e'):''}${paintFor(paint,h)}${windows}
${el(h[1],paint==='rocket'?'#284451':'#25323d')}${paint==='bf'?'':el(h[2],'url(#glass)','stroke="#253845" stroke-width="1.1"')}${line(h[1],['af','af300','dragon','upgrade'].includes(paint)?RED:paint==='bf300'?GOLD:'#435665',.9)}${el(h[3],'#f7f6db','stroke="#8a9293" stroke-width=".8"')}
${line(`M${door} 34H${door+17}V80H${door}Z`,'#71838c',1)}<rect x="${door+4}" y="41" width="9" height="18" rx="4.5" fill="url(#glass)"/>${line(`M${door+14} 67v4`,'#41545e',1)}${line('M302 27V87','#697b84',1.2)}${line('M111 79H307','#82959f',.8)}
${[166,196,226,256,284].map(x=>`<rect x="${x}" y="82" width="11" height="4" rx=".5" fill="#83949e" opacity=".6"/>`).join('')}${line('M181 24H207 M216 24H240 M251 24H278','#a5b5bc',1.4)}${line('M22 78Q28 73 37 73Q43 78 43 86','#788a94',.9)}${head==='rocket'&&item.model==='CRH380A'?xs.map(x=>line(`M${x+9} 47V57`,'#adbec7',1)).join(''):''}</g>${el(h[0],'none','stroke="#405666" stroke-width="1.5" stroke-linejoin="round"')}</svg>\n`;
 fs.writeFileSync(path.join(out,item.model+'.svg'),svg);
}
console.log(`Redrew ${catalogue.filter(item=>item.accuracy!=='reference').length} source-reviewed side views; retained ${catalogue.filter(item=>item.accuracy==='reference').length} reference images`);
