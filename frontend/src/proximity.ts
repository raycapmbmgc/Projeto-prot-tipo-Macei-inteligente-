import {distance,type Point} from './navigation';
import type {Place} from './data';

export function nearestPlaces(origin:Point,places:Place[],limit=5){
  return places.filter(p=>p.routable!==false&&Number.isFinite(p.lat)&&Number.isFinite(p.lon))
    .map(p=>({...p,distance_m:distance(origin,p)})).sort((a,b)=>a.distance_m-b.distance_m||a.name.localeCompare(b.name,'pt-BR')).slice(0,limit);
}

export function formatDistance(metres:number){return metres<1000?`${Math.round(metres)} m`:`${(metres/1000).toFixed(1)} km`;}

// GPS updates the marker frequently, but nearby searches only need a new reference
// after meaningful movement. Manual origins always take effect immediately.
export function shouldRefreshReference(previous:Point|null,next:Point,tracking:boolean,elapsedMs:number){
  if(!previous)return true;
  const moved=distance(previous,next);
  return tracking?(moved>=1000||moved>=100&&elapsedMs>=15000):moved>.1;
}
