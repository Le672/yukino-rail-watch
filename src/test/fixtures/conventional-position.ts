// Excerpt of public RailGo K123 data checked on 2026-09-29; tests only, never product fallback data.
export const k123 = { success: true, data: { numberFull: ["K122", "K123"], rundays: ["20260929"], car: "25GDC600V", timetable: [
  { trainCode: "K123", station: "上海松江", stationTelecode: "IMH", day: 0, arrive: "12:03", depart: "12:03" },
  { trainCode: "K123", station: "嘉兴", stationTelecode: "JXH", day: 0, arrive: "12:36", depart: "12:39" },
  { trainCode: "K123", station: "谷城", stationTelecode: "GCN", day: 1, arrive: "09:32", depart: "09:35" },
  { trainCode: "K123", station: "十堰", stationTelecode: "SNN", day: 1, arrive: "10:43", depart: "10:43" },
] } };
export const k123Map = { success: true, data: { stations: [
  { 上海松江: [121.230588, 30.982601] }, { 嘉兴: [120.763489, 30.764099] },
  { 谷城: [111.603283, 32.264263] }, { 十堰: [110.78189, 32.603917] },
], train: {} } };
