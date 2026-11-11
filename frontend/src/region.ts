import boundary from './maceio-boundary.json';
import type {Point} from './navigation';

const geometry=boundary.features[0].geometry as {type:string;coordinates:unknown};
const polygons=(geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates) as number[][][][];
const points=polygons.flat(2);
export const MACEIO_CENTER:[number,number]=[-35.7089,-9.6498];
export const MACEIO_BOUNDS:[number,number,number,number]=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
export const MACEIO_MAP_BOUNDS:[[number,number],[number,number]]=[[MACEIO_BOUNDS[0]-.01,MACEIO_BOUNDS[1]-.01],[MACEIO_BOUNDS[2]+.01,MACEIO_BOUNDS[3]+.01]];

function inRing(lon:number,lat:number,ring:number[][]){
  let inside=false;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+ring.length-1)%ring.length];
    const cross=(lon-a[0])*(b[1]-a[1])-(lat-a[1])*(b[0]-a[0]);
    if(Math.abs(cross)<1e-12&&lon>=Math.min(a[0],b[0])-1e-10&&lon<=Math.max(a[0],b[0])+1e-10&&lat>=Math.min(a[1],b[1])-1e-10&&lat<=Math.max(a[1],b[1])+1e-10)return true;
    if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

export function isInMaceio(point:Point){
  const {lat,lon}=point;
  return Number.isFinite(lat)&&Number.isFinite(lon)&&lon>=MACEIO_BOUNDS[0]&&lon<=MACEIO_BOUNDS[2]&&lat>=MACEIO_BOUNDS[1]&&lat<=MACEIO_BOUNDS[3]&&polygons.some(p=>inRing(lon,lat,p[0])&&!p.slice(1).some(r=>inRing(lon,lat,r)));
}
