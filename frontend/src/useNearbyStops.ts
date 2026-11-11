import {useEffect,useRef,useState} from 'react';
import {api} from './data';
import type {Point} from './navigation';
import {shouldRefreshReference} from './proximity';

export type NearbyStop=Point&{id:string;name:string;type:string;district?:string;distance_m?:number;lines?:{id:string;code:string;name:string}[]};

export function useNearbyStops(point:Point|null,tracking=false,radius=1500){
  const last=useRef<{point:Point|null;time:number;tracking:boolean}>({point:null,time:0,tracking});
  const [reference,setReference]=useState<Point|null>(null),[stops,setStops]=useState<NearbyStop[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if(!point){last.current={point:null,time:0,tracking};setReference(null);setStops([]);return;}
    const now=Date.now();
    if(last.current.tracking!==tracking||shouldRefreshReference(last.current.point,point,tracking,now-last.current.time)){
      last.current={point,time:now,tracking};setReference(point);
    }
  },[point,tracking]);
  useEffect(()=>{
    if(!reference){setStops([]);setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');setStops([]);
    api<NearbyStop[]>(`/transit/catalog/stops?lat=${reference.lat}&lon=${reference.lon}&radius=${radius}`,{signal:controller.signal})
      .then(setStops).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[reference,radius]);
  return {reference,stops,loading,error};
}
