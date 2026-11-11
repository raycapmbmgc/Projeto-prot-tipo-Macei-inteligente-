import {useEffect,useState} from 'react';
import type {Map} from 'maplibre-gl';

type SensorEvent=DeviceOrientationEvent & {webkitCompassHeading?:number};
type SensorConstructor=typeof DeviceOrientationEvent & {requestPermission?:()=>Promise<string>};

export function Compass({map}:{map:Map|null}) {
  const [enabled,setEnabled]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{
    if (!enabled || !map) return;
    let last=0,received=false;
    const handler=(event:DeviceOrientationEvent)=>{
      const e=event as SensorEvent;
      const raw=typeof e.webkitCompassHeading==='number'?e.webkitCompassHeading:e.absolute && e.alpha!==null?360-e.alpha:null;
      if (raw===null || !Number.isFinite(raw) || Date.now()-last<250) return;
      received=true;last=Date.now();
      const rotation=screen.orientation?.angle??0;
      map.rotateTo((raw+rotation)%360,{duration:200});setMessage('Bússola ativa');
    };
    window.addEventListener('deviceorientationabsolute',handler);
    window.addEventListener('deviceorientation',handler);
    const timeout=window.setTimeout(()=>{if(!received){setMessage('Orientação absoluta indisponível. Use o controle do mapa.');setEnabled(false);}},8000);
    return ()=>{clearTimeout(timeout);window.removeEventListener('deviceorientationabsolute',handler);window.removeEventListener('deviceorientation',handler);};
  },[enabled,map]);
  async function toggle(){
    if(enabled){setEnabled(false);map?.rotateTo(0);setMessage('');return;}
    if(!window.isSecureContext || !('DeviceOrientationEvent' in window)){setMessage('Bússola exige HTTPS e um dispositivo compatível.');return;}
    try {
      const sensor=DeviceOrientationEvent as SensorConstructor;
      if(sensor.requestPermission && await sensor.requestPermission()!=='granted'){setMessage('Permissão da bússola negada.');return;}
      setMessage('Aguardando sensor…');setEnabled(true);
    } catch {setMessage('Não foi possível acessar a bússola.');}
  }
  return <div className="compass"><button onClick={toggle} aria-pressed={enabled}>{enabled?'Desativar bússola':'Ativar bússola'}</button>{message&&<p role="status" className="hint">{message}</p>}</div>;
}
