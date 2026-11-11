import {useEffect,useRef,useState} from 'react';
import {api,modeLabels,type Place,type RouteReply} from './data';
import {distance,type Point} from './navigation';
import {vehicleLabels,type VehicleProfile} from './VehicleProfile';

export type RouteChoice={mode:string;profile:VehicleProfile;reply:RouteReply;origin:Point};
type Entry={mode:string;reply?:RouteReply;error?:string};

export function RouteComparison({origin,destination,waypoints,modes,tracking,online,avoidSteps,preferLit,avoidHills,onSelect,onBuses}:{origin:Point|null;destination:Place|null;waypoints:Place[];modes:string[];tracking:boolean;online:boolean;avoidSteps:boolean;preferLit:boolean;avoidHills:boolean;onSelect:(choice:RouteChoice)=>void;onBuses:()=>void}){
  const [entries,setEntries]=useState<Entry[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const controller=useRef<AbortController|null>(null),from=useRef<Point|null>(null);
  function reset(){controller.current?.abort();controller.current=null;from.current=null;setEntries([]);setBusy(false);setMessage('');}
  useEffect(()=>{reset();},[destination,waypoints,avoidSteps,preferLit,avoidHills]);
  useEffect(()=>{if(!origin||from.current&&distance(origin,from.current)>(tracking?100:.1))reset();},[origin,tracking]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function compare(){
    if(!origin||!destination)return;
    controller.current?.abort();const request=new AbortController();controller.current=request;from.current={...origin};const snapshot={...origin};
    setEntries([]);setBusy(true);
    try{
      for(const mode of ['car','walk','bike','wheelchair'].filter(mode=>modes.includes(mode))){
        if(request.signal.aborted)return;
        setMessage('Calculando: '+modeLabels[mode]+'…');
        try{
          const pedestrian=mode==='walk'||mode==='wheelchair';
          const reply=await api<RouteReply>('/routes',{method:'POST',signal:request.signal,body:JSON.stringify({origin:snapshot,destination,waypoints,mode,objective:'fastest',vehicle_profile:'standard',avoid_steps:pedestrian&&avoidSteps,prefer_lit:pedestrian&&preferLit,avoid_hills:pedestrian&&avoidHills})});
          if(request.signal.aborted||controller.current!==request)return;
          if(!reply.routes.length)throw Error('Nenhum percurso retornado.');
          setEntries(old=>[...old,{mode,reply}]);
        }catch(e){if((e as Error).name==='AbortError')return;if(controller.current===request)setEntries(old=>[...old,{mode,error:(e as Error).message}]);}
      }
      setMessage('Comparação calculada a partir da origem no momento da consulta.');
    }finally{if(controller.current===request)setBusy(false);}
  }
  function select(mode:string,profile:VehicleProfile,reply:RouteReply){if(from.current)onSelect({mode,profile,reply,origin:from.current});}
  return <details className="route-comparison"><summary>Rotas para cada modo e perfil de veículo</summary><p className="hint">Compare carro, caminhada, bicicleta e cadeira de rodas conforme a disponibilidade do provedor. Veículo autorizado e ambulância seguem as mesmas permissões viárias do carro comum; o perfil não cria uma redução de tempo.</p>
    <button className="primary" disabled={!origin||!destination||!online||busy} onClick={()=>void compare()}>{busy?'Comparando trajetos…':'Comparar formas de ir'}</button>{busy&&<button onClick={reset}>Cancelar comparação</button>}
    <div className="comparison-grid">{entries.flatMap(entry=>entry.mode==='car'?(['standard','authorized','ambulance'] as VehicleProfile[]).map(profile=><article className="comparison-card" key={profile}><h3>{vehicleLabels[profile]}</h3>{entry.reply?<><strong>{Math.max(1,Math.round(entry.reply.routes[0].duration/60))} min</strong><p>{(entry.reply.routes[0].distance/1000).toFixed(1)} km · {entry.reply.provider}</p>{profile!=='standard'&&<p className="hint">Mesma circulação do carro comum. Confirme o perfil antes de calcular e navegar.</p>}<button onClick={()=>select(entry.mode,profile,entry.reply!)}>Usar este perfil</button></>:<p className="hint">{entry.error}</p>}</article>):[<article className="comparison-card" key={entry.mode}><h3>{modeLabels[entry.mode]}</h3>{entry.reply?<><strong>{Math.max(1,Math.round(entry.reply.routes[0].duration/60))} min</strong><p>{(entry.reply.routes[0].distance/1000).toFixed(1)} km · {entry.reply.provider}</p><button onClick={()=>select(entry.mode,'standard',entry.reply!)}>Usar este trajeto</button></>:<p className="hint">{entry.error}</p>}</article>])}</div>
    <button className="text-button" onClick={onBuses}>Ônibus: pontos próximos e planejamento de viagem →</button><p className="hint" role="status">{message}</p>
  </details>;
}
