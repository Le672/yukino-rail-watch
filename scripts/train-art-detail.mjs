// Original SVG finishing details shared by every passenger model. These never
// alter the silhouette, stripe geometry, generation, or attribution of a model.
export const ART_REVISION = '4, 2026-10-18';
export function detailTrainSvg(input, { coach = false } = {}) {
  let svg = input.replace(/<!-- detail-v4-start -->[\s\S]*?<!-- detail-v4-end -->/g, '');
  const outline = svg.match(/<clipPath id="(?:car|bodyClip)"><path d="([^"]+)"/);
  const windows = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="(?:url\(#glass\)|#(?:253d49|1c3444|28434c))"[^>]*\/>/g)];
  const wheels = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="(?:6|7)"\s*\/>/g)].map(m=>[Number(m[1]),Number(m[2])]);
  if (wheels.length !== 4) throw new Error('A model must retain four visible wheel faces');
  const mark = value => `<!-- detail-v4-start -->${value}<!-- detail-v4-end -->`;
  const windowDefs = windows.map((m,i)=>`<clipPath id="detail-glass-${i}"><rect x="${m[1]}" y="${m[2]}" width="${m[3]}" height="${m[4]}" rx="1.6"/></clipPath>`).join('');
  const bodyDef = outline ? `<clipPath id="detail-body"><path d="${outline[1]}"/></clipPath>` : '<clipPath id="detail-body"><path d="M19 35Q20 25 32 25H287Q300 25 300 35V88H19Z"/></clipPath>';
  const defs = `<defs>${bodyDef}${windowDefs}<linearGradient id="detail-clearcoat" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".5"/><stop offset=".24" stop-color="#fff" stop-opacity="0"/><stop offset=".74" stop-color="#142d40" stop-opacity="0"/><stop offset="1" stop-color="#142d40" stop-opacity=".12"/></linearGradient><linearGradient id="detail-rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c9d5dd"/><stop offset=".45" stop-color="#708492"/><stop offset="1" stop-color="#344955"/></linearGradient></defs>`;
  svg = svg.replace('</metadata>', ` Fine detail revision ${ART_REVISION}.</metadata>`).replace(/ Fine detail revision [^.]+\.(?= Fine detail revision)/g,'');
  svg = svg.replace('</metadata>', `</metadata>${mark(defs)}`);
  // Use the actual window rectangles of each model, including independent and
  // double-deck windows. There is no blanket black belt across CRH2/CRH5.
  const glazing = windows.map((m,i)=>{
    const x=Number(m[1]),y=Number(m[2]),w=Number(m[3]),h=Number(m[4]);
    return `<g clip-path="url(#detail-glass-${i})"><path d="M${x} ${y+1}h${w}" stroke="#b5d5e5" stroke-width=".8" opacity=".6"/><path d="M${x+w*.3} ${y}h${w*.2}l${-h*.5} ${h}h${-w*.2}Z" fill="#d5edf8" opacity=".14"/><path d="M${x} ${y+h-.8}h${w}" stroke="#0a2030" stroke-width="1.1" opacity=".65"/></g>`;
  }).join('');
  const first=wheels[0],second=wheels[1],third=wheels[2],fourth=wheels[3], axleY=first[1];
  const bogies=[[first,second],[third,fourth]].map(pair=>{
    const left=pair[0][0],right=pair[1][0],y=pair[0][1];
    return `<path d="M${left-5} ${y-5}H${right+5}" stroke="#263d48" stroke-width="3.2" stroke-linecap="round"/><path d="M${left+3} ${y-5}h${right-left-6}" stroke="#8b9da6" stroke-width="1.1"/>${[left+6,right-7].map(x=>`<path d="M${x} ${y-8}l2 1-2 1 2 1-2 1" stroke="#677c88" stroke-width=".7" fill="none"/>`).join('')}`;
  }).join('');
  const runningGear = `<g>${bogies}${wheels.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="5.8" fill="#203541" stroke="#536b78" stroke-width=".8"/><circle cx="${x}" cy="${y}" r="3.5" fill="url(#detail-rim)"/><circle cx="${x}" cy="${y}" r="1.5" fill="#d7e2e8"/><path d="M${x-3.4} ${y-.8}a3.5 3.5 0 0 1 3.2-2.7" stroke="#e9f1f5" stroke-width=".7" fill="none" opacity=".7"/>`).join('')}<path d="M${second[0]+12} ${axleY-5}h${third[0]-second[0]-23}v5H${second[0]+12}Z" fill="#536875"/><path d="M${second[0]+15} ${axleY-4}h${third[0]-second[0]-29}" stroke="#9aabb4" stroke-width=".7"/>${[0,1,2,3,4].map(i=>`<path d="M${second[0]+24+i*20} ${axleY-4}v3" stroke="#2b434f" stroke-width=".65"/>`).join('')}</g>`;
  const body = `<g clip-path="url(#detail-body)"><path d="M0 18H320V90H0Z" fill="url(#detail-clearcoat)"/>${outline?`<path d="${outline[1]}" fill="none" stroke="#fff" stroke-width="2.5" opacity=".36" transform="translate(0 1.4)"/>`:''}${glazing}<path d="M${coach?22:117} 79H${coach?297:300}" stroke="#e2e9eb" stroke-width=".7" opacity=".7"/><path d="M${coach?22:117} 81H${coach?297:300}" stroke="#536e7d" stroke-width=".55" opacity=".45"/></g>`;
  // A narrow gangway at the car end, not an invented additional coach.
  const gangway = coach ? '' : '<path d="M307.4 30v55" stroke="#273d4a" stroke-width="2"/><path d="M309.6 33v50" stroke="#84969e" stroke-width="1" stroke-dasharray="1.5 1.1"/>';
  return svg.replace('</svg>', `${mark(body+runningGear+gangway)}</svg>`);
}
