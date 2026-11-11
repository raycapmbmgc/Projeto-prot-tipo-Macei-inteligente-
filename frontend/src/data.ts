import type {Point} from './navigation';

export type Place = Point & {name:string; id?:number; address?:string; category?:string; source?:string; source_url?:string; cnes?:string; facility_type?:string; unit_type?:string; ownership?:string; phone?:string|null; registry_updated_at?:string; routable?:boolean; demo?:boolean; wheelchair?:'yes'|'no'|'unknown'; verified_at?:string; distance_m?:number};
export type Step = {instruction:string; coordinate:number[]; street:string; distance:number; duration:number};
export type Route = {distance:number; duration:number; geometry:{type:'LineString'; coordinates:number[][]}; steps:Step[]};
export type Road = {id:string; name:string; status:string; location?:Point|null; expires_at?:string|null; source?:string};
export type Report = {id:string; description:string; kind:string; location:Point; verification:string; created_at:string; expires_at:string};
export type Capabilities = {modes:string[]; transit:boolean; bus_catalog?:boolean; live_traffic:boolean; closure_routing:boolean; admin_protected:boolean; assistant:boolean; assistant_provider?:'local'|'ollama'};
export type BusRoute={id:string;code:string;name:string;source:string;from?:string;to?:string;geometry:{type:'MultiLineString';coordinates:number[][][]};stops:{id:string;lat:number;lon:number;role:string}[]};
export type RouteReply = {routes:Route[]; provider:string; explanation:string; warnings:string[]};
export type SavedRoute = {destination:Place; route:Route; savedAt:string; warnings:string[]};
export const modeLabels:Record<string,string> = {car:'Carro',walk:'A pé',bike:'Bicicleta',wheelchair:'Cadeira de rodas'};

export async function api<T>(path:string, options:RequestInit={}):Promise<T> {
  let response:Response;
  try {response = await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});}
  catch (error) {
    if ((error as Error).name==='AbortError') throw error;
    throw Error('Sem conexão com o servidor. Confira a rede ou consulte um percurso salvo.');
  }
  if (response.status===204) return undefined as T;
  const data = await response.json().catch(()=>({detail:'Resposta inválida do servidor.'}));
  if (!response.ok) {
    const detail=typeof data.detail==='string'?data.detail: Array.isArray(data.detail)?data.detail.map((e:{msg:string})=>e.msg).join(' '):'Confira os dados e tente novamente.';
    throw Error(detail);
  }
  return data as T;
}

export function validPlace(value:unknown):value is Place {
  if (!value || typeof value!=='object') return false;
  const p=value as Place;
  return typeof p.name==='string' && p.name.length<=500 && Number.isFinite(p.lat) && Math.abs(p.lat)<=90 && Number.isFinite(p.lon) && Math.abs(p.lon)<=180;
}

export function readFavorites():Place[] {
  try {const items=JSON.parse(localStorage.getItem('maceio:favorites')||'[]');return Array.isArray(items)?items.filter(validPlace).slice(0,50):[];}
  catch {return [];}
}

export function samePlace(a:Place,b:Place) {return a.lat===b.lat && a.lon===b.lon && a.name===b.name;}

export function readSavedRoute():SavedRoute|null {
  try {
    const s=JSON.parse(localStorage.getItem('maceio:saved-route')||'null') as SavedRoute;
    if (!s || !validPlace(s.destination) || typeof s.savedAt!=='string' || !Number.isFinite(Date.parse(s.savedAt))) return null;
    const r=s.route;
    if (!r || !Number.isFinite(r.distance) || r.distance<0 || !Number.isFinite(r.duration) || r.duration<0 || r.geometry?.type!=='LineString' || !Array.isArray(r.geometry.coordinates) || r.geometry.coordinates.length<2 || r.geometry.coordinates.length>100000) return null;
    if (!r.geometry.coordinates.every(c=>Array.isArray(c) && c.length===2 && Number.isFinite(c[0]) && Math.abs(c[0])<=180 && Number.isFinite(c[1]) && Math.abs(c[1])<=90)) return null;
    if (!Array.isArray(r.steps) || !r.steps.every(x=>typeof x.instruction==='string' && typeof x.street==='string' && Number.isFinite(x.distance))) return null;
    return {...s,warnings:Array.isArray(s.warnings)?s.warnings.filter(x=>typeof x==='string'):[]};
  } catch {return null;}
}
