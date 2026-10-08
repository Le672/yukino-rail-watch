import { railApiUrl } from "./rail-api";
import { loadJourney } from "./rail-position-data";
import { loadCachedRailway, loadRailNetworkStations } from "./rail-network";
import { railwayToWgs84, validLocation } from "./rail-gps";
import type { LocationFix, Wgs84RailwayRoute } from "./rail-gps";
import type { BoardRow, StationBoardData } from "./rail-board";
import { chinaDateTime, distanceKm } from "./train-position";
import type { Coordinate, RailwayMapData, TrainJourney } from "./train-position";

export type DetectionStation = { code: string; name: string; coordinate: Coordinate; distanceKm: number };
export type DetectionRoute = { journey: TrainJourney; map: RailwayMapData; route: Wgs84RailwayRoute };
export type DetectedTrain = DetectionRoute & {
  key: string; score: number; errorMeters: number; timeErrorMinutes: number;
  direction: "same" | "unknown"; nextIndex: number; confidence: "strong" | "possible";
};
export type DetectionProgress = {
  routes: DetectionRoute[]; stations: number; timetables: number; failed: number;
  truncated: boolean; complete: boolean;
};
const boards = new Map<string, { until: number; value: StationBoardData }>();
const MINUTE = 60000;

export function nearbyDetectionStations(stations: { code: string; name: string; coordinate: Coordinate }[], fix: LocationFix): DetectionStation[] {
  if (!validLocation(fix) || fix.accuracy > 2500) return [];
  const point: Coordinate = [fix.longitude, fix.latitude];
  return stations.map(station => ({ ...station, distanceKm: distanceKm(point, station.coordinate) }))
    .filter(station => station.distanceKm <= 240).sort((a,b) => a.distanceKm - b.distanceKm).slice(0,18);
}
function bearing(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180, y = Math.sin((b[0]-a[0])*rad)*Math.cos(b[1]*rad);
  const x = Math.cos(a[1]*rad)*Math.sin(b[1]*rad)-Math.sin(a[1]*rad)*Math.cos(b[1]*rad)*Math.cos((b[0]-a[0])*rad);
  return (Math.atan2(y,x)/rad+360)%360;
}
const angle = (a: number, b: number) => Math.abs((a-b+540)%360-180);
export function projectDetectionFix(route: Wgs84RailwayRoute, fix: LocationFix) {
  const target: Coordinate = [fix.longitude,fix.latitude], cos = Math.cos(fix.latitude*Math.PI/180);
  let best = { distanceKm: 0, errorMeters: Infinity, heading: 0 };
  const margin = Math.max(.004, (fix.accuracy/1000+1)/111);
  for (let i=1;i<route.points.length;i++) {
    const a=route.points[i-1], b=route.points[i];
    if (Math.min(a[1],b[1])-margin>fix.latitude || Math.max(a[1],b[1])+margin<fix.latitude ||
        Math.min(a[0],b[0])-margin/cos>fix.longitude || Math.max(a[0],b[0])+margin/cos<fix.longitude) continue;
    const dx=(b[0]-a[0])*cos,dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,(dx*(target[0]-a[0])*cos+dy*(target[1]-a[1]))/(dx*dx+dy*dy||1)));
    const point: Coordinate=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    const errorMeters=distanceKm(target,point)*1000;
    if (errorMeters<best.errorMeters) best={errorMeters,distanceKm:route.distances[i-1]+(route.distances[i]-route.distances[i-1])*t,heading:bearing(a,b)};
  }
  return best;
}

/** Local-only ranking. A position never proves identity; overlapping trains remain candidates. */
export function rankDetectedTrains(routes: DetectionRoute[], samples: readonly LocationFix[], now: number) {
  const fix=samples.at(-1);
  if (!fix || !validLocation(fix) || now-fix.timestamp>30000 || fix.timestamp>now+5000 || fix.accuracy>2500)
    return { candidates: [] as DetectedTrain[], automatic: null as DetectedTrain | null };
  const first=samples.find(sample => validLocation(sample) && sample.accuracy<=2500 && fix.timestamp-sample.timestamp>=10000 && fix.timestamp-sample.timestamp<=90000);
  const seconds=first ? (fix.timestamp-first.timestamp)/1000 : 0;
  const velocity=fix.speed!==null && Number.isFinite(fix.speed) && fix.speed>=0 && fix.speed<=600/3.6 ? fix.speed : null;
  const candidates: DetectedTrain[]=[];
  for (const item of routes) {
    const {journey,route}=item, stops=journey.stops;
    if (now<stops[0].departureAt-15*MINUTE || now>stops.at(-1)!.arrivalAt+180*MINUTE) continue;
    const projected=projectDetectionFix(route,fix);
    if (projected.errorMeters>Math.max(250,fix.accuracy*1.5)) continue;
    let direction: DetectedTrain["direction"]="unknown", headingPenalty=0;
    if (first) {
      const before=projectDetectionFix(route,first), delta=projected.distanceKm-before.distanceKm;
      const uncertainty=(first.accuracy+fix.accuracy)/1000;
      if (before.errorMeters<=Math.max(250,first.accuracy*1.5)) {
        if (delta < -Math.max(.15,uncertainty*1.2)) continue;
        if (delta > Math.max(.15,uncertainty*1.2) && delta<=seconds/3600*600+uncertainty) direction="same";
        if (Math.abs(delta)>seconds/3600*600+uncertainty+.3) continue;
      }
    }
    if (velocity!==null && velocity>5 && fix.heading!==null && Number.isFinite(fix.heading)) {
      const difference=angle(fix.heading,projected.heading);
      if (difference>110) continue;
      if (difference<45) direction="same";
      headingPenalty=difference/15;
    }
    let nextIndex=route.stopDistances.findIndex((distance,index)=>index>0 && distance>projected.distanceKm);
    if (nextIndex<1) nextIndex=stops.length-1;
    const previous=nextIndex-1, start=route.stopDistances[previous], end=route.stopDistances[nextIndex];
    const fraction=Math.max(0,Math.min(1,(projected.distanceKm-start)/(end-start||1)));
    let predictedAt=stops[previous].departureAt+(stops[nextIndex].arrivalAt-stops[previous].departureAt)*fraction;
    const stationIndex=route.stopDistances.findIndex(distance=>Math.abs(distance-projected.distanceKm)*1000<=Math.max(100,fix.accuracy));
    if (stationIndex>=0 && (velocity===null || velocity<3) && now>=stops[stationIndex].arrivalAt && now<=stops[stationIndex].departureAt) {
      predictedAt=now; nextIndex=Math.min(stops.length-1,stationIndex+1);
    }
    const timeErrorMinutes=(now-predictedAt)/MINUTE;
    // Large disruption can retain a candidate, but cannot create a confident automatic match.
    if (timeErrorMinutes < -25 || timeErrorMinutes>150) continue;
    const score=projected.errorMeters/Math.max(50,fix.accuracy)*12+Math.abs(timeErrorMinutes)*2+headingPenalty;
    const strong=fix.accuracy<=200 && projected.errorMeters<=Math.max(100,fix.accuracy) && Math.abs(timeErrorMinutes)<=4 && direction==="same" &&
      samples.length>=3 && seconds>=10;
    candidates.push({...item,key:`${journey.date}/${[...journey.codes].sort().join("/")}`,score,errorMeters:projected.errorMeters,timeErrorMinutes,direction,nextIndex,confidence:strong?"strong":"possible"});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const keys=new Set<string>(), unique=candidates.filter(candidate=>{
    if(keys.has(candidate.key))return false;keys.add(candidate.key);return true;
  });
  const best=unique[0];
  return { candidates:unique.slice(0,8), automatic:best?.confidence==="strong" && (!unique[1] || unique[1].score-best.score>=16) ? best : null };
}

export function boardDetectionReferences(boards: { board: StationBoardData; station: DetectionStation }[], fix: LocationFix, now: number) {
  const references=new Map<string,{row:BoardRow;score:number}>();
  for (const {board,station} of boards) for (const row of board.rows) {
    if (!row.originDate || !row.train || !row.trainNo) continue;
    if (fix.speed!==null && fix.speed>180/3.6 && !/^[GDC]/.test(row.train)) continue;
    const events=[row.arrivalAt,row.departureAt].filter((at):at is number=>at!==null && Number.isFinite(at));
    const speed=fix.speed!==null && fix.speed>15 ? fix.speed*3.6 : /^[GDC]/.test(row.train)?220:90;
    const travelMinutes=station.distanceKm/speed*60;
    const score=Math.min(...events.map(at=>Math.abs(Math.abs(at-now)/MINUTE-travelMinutes)))+station.distanceKm/100;
    if (!events.some(at=>Math.abs(at-now)<=180*MINUTE)) continue;
    const key=`${row.trainNo}/${row.originDate}`;
    if (!references.has(key) || score<references.get(key)!.score) references.set(key,{row,score});
  }
  return [...references.values()].sort((a,b)=>a.score-b.score).map(value=>value.row);
}

async function loadBoard(station: DetectionStation,date: string,signal: AbortSignal) {
  const key=`${station.code}/${date}`, cached=boards.get(key);
  if (cached && cached.until>Date.now()) return cached.value;
  const response=await fetch(railApiUrl(new URLSearchParams({mode:"board",station:station.code,date})),{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  const value=await response.json() as StationBoardData & {error?:string};
  if (!response.ok || value.source!=="12306" || value.stationCode!==station.code || value.date!==date || !Array.isArray(value.rows)) throw new Error(value.error||"12306 到发车次暂不可用");
  if (boards.size>=80) boards.delete(boards.keys().next().value!);
  boards.set(key,{until:Date.now()+60000,value}); return value;
}

/** Only station codes, dates and public train codes leave the device. No GPS coordinate is submitted. */
export async function discoverTrainRoutes(fix: LocationFix,samples: readonly LocationFix[],now: number,signal: AbortSignal,onProgress:(value:DetectionProgress)=>void) {
  const stations=nearbyDetectionStations(await loadRailNetworkStations(),fix);
  if (!stations.length) throw new Error("定位误差过大或附近缺少铁路车站资料，等待更准确的定位。");
  const date=chinaDateTime(now).slice(0,10), hour=Number(chinaDateTime(now).slice(11,13));
  const dates=[date,...(hour<3?[chinaDateTime(now-86400000).slice(0,10)]:hour>=21?[chinaDateTime(now+86400000).slice(0,10)]:[])];
  const progress:DetectionProgress={routes:[],stations:0,timetables:0,failed:0,truncated:false,complete:false};
  const seen=new Set<string>(), obtained: {board:StationBoardData;station:DetectionStation}[]=[];
  const emit=()=>{if(!signal.aborted)onProgress({...progress,routes:[...progress.routes]});};
  for (let offset=0;offset<stations.length && !signal.aborted;offset+=6) {
    const queue=stations.slice(offset,offset+6).flatMap(station=>dates.map(day=>({station,day})));
    await Promise.all(Array.from({length:3},async()=>{
      while(queue.length && !signal.aborted){const {station,day}=queue.shift()!;try{obtained.push({station,board:await loadBoard(station,day,signal)});}catch{if(!signal.aborted)progress.failed++;}}
    }));
    if(signal.aborted)break;
    progress.stations=Math.min(offset+6,stations.length); emit();
    const refs=boardDetectionReferences(obtained,fix,now).filter(row=>!seen.has(`${row.trainNo}/${row.originDate}`));
    if(refs.length>24)progress.truncated=true;
    const timetableQueue=refs.slice(0,24);
    await Promise.all(Array.from({length:3},async()=>{
      while(timetableQueue.length && !signal.aborted){
        const row=timetableQueue.shift()!, key=`${row.trainNo}/${row.originDate}`; seen.add(key);
        try{
          const journey=await loadJourney(row.train,row.originDate);
          if(signal.aborted)break;
          const map=await loadCachedRailway(journey);
          if(signal.aborted)break;
          progress.timetables++;
          if(map?.route){const item={journey,map,route:railwayToWgs84(map.route)};
            if(rankDetectedTrains([item],samples,now).candidates.length)progress.routes.push(item);
          }else progress.failed++;
        }catch{if(!signal.aborted)progress.failed++;}
        emit();
      }
    }));
  }
  progress.complete=!signal.aborted;emit();return progress;
}
