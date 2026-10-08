import { describe,expect,it } from "vitest";
import { boardDetectionReferences,nearbyDetectionStations,rankDetectedTrains } from "../lib/rail-train-detection";
import type { DetectionRoute } from "../lib/rail-train-detection";
import type { LocationFix } from "../lib/rail-gps";
import type { BoardRow,StationBoardData } from "../lib/rail-board";
import { coordinateAt,distanceKm } from "../lib/train-position";
import type { TrainJourney } from "../lib/train-position";

const start=Date.parse("2026-10-07T15:00:00+08:00"),now=start+5*60000;
const points:[number,number][]=[[113,23],[113.5,23],[114,23]],length=distanceKm(points[0],points[1]);
function train(code:string,shift=0,reverse=false):DetectionRoute{
  const journey:TrainJourney={train:code,codes:[code],date:"2026-10-07",model:null,owner:null,checkedAt:now,source:"12306",stops:[
    {station:"始发",telecode:"AAA",trainCode:code,arrival:"15:00",departure:"15:00",arrivalAt:start+shift,departureAt:start+shift,day:0},
    {station:"中间",telecode:"BBB",trainCode:code,arrival:"15:10",departure:"15:11",arrivalAt:start+10*60000+shift,departureAt:start+11*60000+shift,day:0},
    {station:"终到",telecode:"CCC",trainCode:code,arrival:"15:21",departure:"15:21",arrivalAt:start+21*60000+shift,departureAt:start+21*60000+shift,day:0},
  ]};
  const route={points:reverse?[...points].reverse():points,distances:[0,length,2*length],stopDistances:[0,length,2*length],stops:reverse?[...points].reverse():points,lengthKm:2*length,coordinateSystem:"WGS84" as const};
  return{journey,route,map:{route,coordinateSystem:"WGS84",stations:route.stops,warning:null}};
}
const base=train("G123");
function samples(accuracy=10){return[-20,-10,0].map(seconds=>{
  const [longitude,latitude]=coordinateAt(base.route,length*(5*60+seconds)/600);
  return{longitude,latitude,accuracy,speed:85,heading:90,timestamp:now+seconds*1000} as LocationFix;
});}

describe("GPS identification against official journeys",()=>{
  it("selects the correct direction and timetable, and the next actual stop",()=>{
    const ranked=rankDetectedTrains([train("G321",0,true),train("G124",10*60000),base],samples(),now);
    expect(ranked.automatic?.journey.train).toBe("G123");
    expect(ranked.automatic?.nextIndex).toBe(1);
    expect(ranked.candidates.some(row=>row.journey.train==="G321")).toBe(false);
  });
  it("keeps overlapping trains ambiguous instead of inventing a unique identity",()=>{
    const ranked=rankDetectedTrains([base,train("G124",30000)],samples(),now);
    expect(ranked.candidates).toHaveLength(2);expect(ranked.automatic).toBeNull();
  });
  it("coarse positions can give candidates, but cannot automatically identify the train",()=>{
    const ranked=rankDetectedTrains([base],samples(1501),now);
    expect(ranked.candidates[0].journey.train).toBe("G123");expect(ranked.automatic).toBeNull();
  });
  it("does not identify from stale, future, off-track or single points",()=>{
    expect(rankDetectedTrains([base],samples(),now+31000).candidates).toHaveLength(0);
    expect(rankDetectedTrains([base],samples(),now-6000).candidates).toHaveLength(0);
    expect(rankDetectedTrains([base],samples().map(fix=>({...fix,latitude:24})),now).candidates).toHaveLength(0);
    expect(rankDetectedTrains([base],[samples().at(-1)!],now).automatic).toBeNull();
  });
  it("cross-day boards retain the true origin date and consolidate numbering changes",()=>{
    const row:BoardRow={id:"A/2026-10-06/K123",train:"K123",trainNo:"A",originDate:"2026-10-06",from:"始发",to:"终到",fromCode:"AAA",toCode:"CCC",arrival:"15:06",departure:"15:08",arrivalAt:now+60000,departureAt:now+180000,dwellMinutes:2,model:null};
    const board:StationBoardData={source:"12306",station:"中间",stationCode:"BBB",date:"2026-10-07",checkedAt:now,rows:[row,{...row,train:"K124"}]};
    const refs=boardDetectionReferences([{board,station:{code:"BBB",name:"中间",coordinate:points[1],distanceKm:10}}],{...samples().at(-1)!,speed:20},now);
    expect(refs).toHaveLength(1);expect(refs[0].originDate).toBe("2026-10-06");
  });
  it("looks up a national station index without city/operator restrictions and caps nearby requests",()=>{
    const stations=Array.from({length:30},(_,index)=>({code:`A${index}`,name:`铁路站${index}`,coordinate:[113+index*.001,23] as [number,number]}));
    const found=nearbyDetectionStations(stations,samples().at(-1)!);
    expect(found).toHaveLength(18);expect(found[0].distanceKm).toBeLessThan(found.at(-1)!.distanceKm);
    expect(nearbyDetectionStations(stations,{...samples().at(-1)!,accuracy:3000})).toHaveLength(0);
  });
});
