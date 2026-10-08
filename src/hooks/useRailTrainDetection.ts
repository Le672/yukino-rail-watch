import { useEffect, useMemo, useRef, useState } from "react";
import { discoverTrainRoutes, rankDetectedTrains } from "../lib/rail-train-detection";
import type { DetectionProgress } from "../lib/rail-train-detection";
import { validLocation } from "../lib/rail-gps";
import type { LocationFix } from "../lib/rail-gps";
import { distanceKm } from "../lib/train-position";

const empty:DetectionProgress={routes:[],stations:0,timetables:0,failed:0,truncated:false,complete:false};
export function useRailTrainDetection(enabled:boolean,fix:LocationFix|null,samples:readonly LocationFix[],now:number) {
  const [progress,setProgress]=useState<DetectionProgress>(empty);
  const [loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
  const control=useRef<AbortController|null>(null), pending=useRef(false);
  const previous=useRef<{at:number;fix:LocationFix}|null>(null);
  useEffect(()=>{
    const controller=new AbortController();control.current=controller;
    previous.current=null;pending.current=false;setProgress(empty);setError(null);setLoading(false);
    return()=>{controller.abort();if(control.current===controller)control.current=null;};
  },[enabled]);
  useEffect(()=>{
    const controller=control.current;
    if(!enabled || !controller || controller.signal.aborted || pending.current || !fix || !validLocation(fix) ||
       now-fix.timestamp>30000 || fix.timestamp>now+5000)return;
    if(fix.accuracy>2500){setError("定位误差超过 2.5 公里，暂无法识别车次，等待更准确的信号。");return;}
    if(previous.current && now-previous.current.at<90000 && distanceKm([fix.longitude,fix.latitude],[previous.current.fix.longitude,previous.current.fix.latitude])<30)return;
    previous.current={at:now,fix};pending.current=true;setLoading(true);setError(null);
    void discoverTrainRoutes(fix,samples,now,controller.signal,value=>setProgress(value)).catch(cause=>{
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"车次识别暂不可用");
    }).finally(()=>{if(!controller.signal.aborted){pending.current=false;setLoading(false);}});
  },[enabled,fix,samples,now]);
  const tick=Math.floor(now/5000);
  const ranked=useMemo(()=>enabled?rankDetectedTrains(progress.routes,samples,now):{candidates:[],automatic:null},[enabled,progress.routes,samples,tick]);
  // Failed/capped searches cannot establish that alternatives were excluded.
  const automatic=progress.complete && !progress.failed && !progress.truncated ? ranked.automatic : null;
  return {...ranked,automatic,progress,loading,error};
}
