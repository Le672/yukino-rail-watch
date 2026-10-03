import type { Station } from "./rail-tickets";

/** Candidate ordering only. Every usable service is independently checked against 12306 for the travel date. */
export const NATIONAL_CORRIDORS: readonly (readonly string[])[] = [
  ["北京西", "石家庄", "邯郸东", "安阳东", "郑州东", "信阳东", "武汉", "岳阳东", "长沙南", "衡阳东", "郴州西", "广州南", "深圳北", "香港西九龙"],
  ["北京南", "天津南", "德州东", "济南西", "泰安", "曲阜东", "徐州东", "蚌埠南", "南京南", "镇江南", "常州北", "无锡东", "苏州北", "上海虹桥"],
  ["北京朝阳", "承德南", "辽宁朝阳", "阜新", "沈阳", "铁岭西", "四平东", "长春西", "哈尔滨西", "大庆西", "齐齐哈尔南"],
  ["哈尔滨", "牡丹江", "佳木斯", "伊春西"],
  ["北京", "天津", "唐山", "秦皇岛", "山海关", "锦州南", "盘锦", "营口东", "大连北"],
  ["沈阳北", "丹东"],
  ["北京北", "清河", "张家口", "乌兰察布", "呼和浩特东", "包头", "鄂尔多斯", "银川"],
  ["呼和浩特", "集宁南", "大同", "张家口", "北京丰台"],
  ["青岛北", "济南东", "石家庄", "太原南", "临汾西", "运城北", "西安北", "宝鸡南", "天水南", "兰州西", "西宁", "张掖西", "嘉峪关南", "哈密", "吐鲁番北", "乌鲁木齐"],
  ["连云港", "徐州东", "商丘", "郑州东", "洛阳龙门", "三门峡南", "西安北"],
  ["上海虹桥", "嘉兴南", "杭州东", "义乌", "金华", "衢州", "上饶", "鹰潭北", "南昌西", "萍乡北", "长沙南", "怀化南", "铜仁南", "贵阳北", "安顺西", "盘州", "曲靖北", "昆明南"],
  ["上海虹桥", "南京南", "合肥南", "六安", "武汉", "宜昌东", "恩施", "重庆北", "成都东"],
  ["南京南", "芜湖", "宣城", "黄山北", "婺源", "上饶", "武夷山北", "南平市", "福州"],
  ["杭州东", "绍兴北", "宁波", "台州", "温州南", "福鼎", "宁德", "福州南", "莆田", "泉州南", "厦门北", "漳州", "潮汕", "惠阳", "深圳北"],
  ["郑州东", "平顶山西", "襄阳东", "万州北", "重庆北"],
  ["西安北", "汉中", "广元", "绵阳", "德阳", "成都东", "眉山东", "乐山", "宜宾西", "贵阳北", "桂林西", "贺州", "肇庆东", "佛山西", "广州南"],
  ["兰州", "陇南", "广元", "南充北", "重庆北", "重庆西", "遵义", "贵阳北", "都匀东", "桂林北", "柳州", "南宁东"],
  ["衡阳东", "永州", "桂林北", "柳州", "南宁东", "钦州东", "北海"],
  ["广州南", "江门", "阳江", "茂名", "湛江西", "海口", "海口东", "文昌", "琼海", "万宁", "陵水", "三亚"],
  ["海口东", "临高南", "白马井", "东方", "崖州", "三亚"],
  ["南宁", "百色", "富宁", "普者黑", "昆明南", "玉溪", "普洱", "西双版纳"],
  ["昆明", "楚雄", "大理", "丽江", "香格里拉"],
  ["西宁", "格尔木", "那曲", "拉萨", "山南", "林芝"],
  ["拉萨", "日喀则"],
  ["乌鲁木齐", "奎屯", "博乐", "伊宁"],
  ["乌鲁木齐", "吐鲁番北", "库尔勒", "阿克苏", "喀什", "和田"],
  ["济南", "淄博", "潍坊", "青岛", "烟台", "威海", "荣成"],
];

// Local intercity/suburban interchange candidates supplement the nationwide city-derived station index.
const LOCAL_NODES = ["广州南", "番禺", "佛山西", "东莞西", "广州新塘", "新塘南", "虎门", "虎门北", "广州北", "花都", "广州白云", "广州东", "肇庆", "鼎湖东", "常平", "惠州", "小金口", "东莞东", "常平东",
  "长沙", "暮云", "株洲", "株洲西", "湘潭", "湘潭北", "株洲南", "长沙西", "大丰", "清河", "北京北", "黄土店", "通州", "通州西", "怀柔北", "密云北", "古北口",
  "成都南", "犀浦", "安靖", "郫县西", "都江堰", "青城山", "彭州", "重庆南", "江津", "重庆西", "汉口", "武昌", "武汉东", "孝感东", "咸宁南", "黄冈东", "大冶北",
  "郑州", "南阳寨", "新郑机场", "郑州航空港", "宋城路", "开封", "中川机场", "兰州新区", "昆明", "昆明南", "大理", "丽江", "贵阳", "贵阳北", "贵阳东", "上海", "上海南", "上海松江", "杭州", "杭州西", "南京", "天津", "天津西", "塘沽", "滨海"];

export function officialCityKey(station: Station): string | null {
  if (!station.city?.trim()) return null;
  return `${station.city.trim()}/${station.cityCode?.trim() || ""}`;
}
export function sameOfficialCity(a: Station, b: Station) {
  return !!a.city?.trim() && a.city.trim() === b.city?.trim() && (!a.cityCode || !b.cityCode || a.cityCode === b.cityCode);
}
export function cityStations(station: Station, stations: Station[]) {
  return stations.filter(s => sameOfficialCity(station, s));
}

const CORE_STATIONS = new Set(["北京朝阳", "北京丰台", "清河", "上海虹桥", "天津西", "汉口", "武昌", "武汉东", "广州白云", "广州东", "广州南", "番禺", "佛山西", "犀浦", "安靖", "成都西", "重庆北", "重庆西", "重庆沙坪坝", "重庆南", "石家庄", "西安北", "乌鲁木齐南"]);
export function cityTransferReserve(from: Station, to: Station, requested: number) {
  const core = (station: Station) => CORE_STATIONS.has(station.name) || !!station.city &&
    (station.name === station.city || ["东", "西", "南", "北"].some(suffix => station.name === `${station.city}${suffix}`));
  // City metadata can include far suburbs. This is a conservative planning floor, not a driving-time estimate.
  return { minutes: Math.max(requested, core(from) && core(to) ? 0 : 180), outlying: !core(from) || !core(to) };
}

export function nationalHubRanking(from: Station, to: Station, stations: Station[]) {
  const byName = new Map(stations.map(s => [s.name, s]));
  const anchors = new Map<string, Station>(), graph = new Map<string, Set<string>>();
  const edge = (a: string, b: string) => { if (a === b) return; (graph.get(a) || graph.set(a, new Set()).get(a)!).add(b); (graph.get(b) || graph.set(b, new Set()).get(b)!).add(a); };
  for (const corridor of NATIONAL_CORRIDORS) {
    let previous: Station | undefined;
    for (const name of corridor) {
      const station = byName.get(name); if (!station) continue;
      anchors.set(station.code, station);
      if (previous) edge(previous.code, station.code);
      previous = station;
    }
  }
  for (const name of LOCAL_NODES) { const station = byName.get(name); if (station) anchors.set(station.code, station); }
  const cities = new Map<string, Station[]>();
  for (const s of stations) { const key = officialCityKey(s); if (key) { const list = cities.get(key) || []; list.push(s); cities.set(key, list); } }
  for (const group of cities.values()) {
    const known = group.filter(s => anchors.has(s.code));
    for (const s of known.slice(1)) edge(known[0].code, s.code);
    // Derive principal station candidates for every city, not a province or train-category whitelist.
    const principal = group.filter(s => s.name === s.city || ["东", "西", "南", "北", "东南", "东北", "西南", "西北"].some(suffix => s.name === `${s.city}${suffix}`));
    for (const s of principal.length ? principal : group.slice(0, 1)) anchors.set(s.code, s);
  }
  const distances = (endpoint: Station) => {
    const distances = new Map<string, number>();
    let seeds = [...anchors.values()].filter(s => graph.has(s.code) && (s.code === endpoint.code || sameOfficialCity(s, endpoint)));
    // Official regional codes provide fallback seeds for towns not situated on a named corridor.
    if (!seeds.length && endpoint.cityCode) seeds = [...anchors.values()].filter(s => graph.has(s.code) && s.cityCode?.slice(0, 2) === endpoint.cityCode!.slice(0, 2));
    const queue = seeds.map(s => s.code); for (const code of queue) distances.set(code, 0);
    for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) || []) if (!distances.has(next)) { distances.set(next, distances.get(queue[i])! + 1); queue.push(next); }
    for (const group of cities.values()) {
      let known = group.flatMap(s => distances.has(s.code) ? [distances.get(s.code)!] : []);
      if (!known.length && group[0].cityCode) known = [...anchors.values()].flatMap(s => graph.has(s.code) && s.cityCode?.slice(0, 2) === group[0].cityCode!.slice(0, 2) && distances.has(s.code) ? [distances.get(s.code)! + 3] : []);
      if (known.length) for (const s of group) distances.set(s.code, Math.min(...known));
    }
    return distances;
  };
  const start = distances(from), end = distances(to);
  const rank = (s: Station) => {
    const a = start.get(s.code), b = end.get(s.code);
    if (a != null && b != null) return (a + b) * 20 + Math.abs(a - b);
    return 1000 + (a ?? b ?? 500);
  };
  return { hubs: [...anchors.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "zh-CN")), rank };
}
