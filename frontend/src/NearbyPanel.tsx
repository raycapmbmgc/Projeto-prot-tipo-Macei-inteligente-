import {useMemo} from 'react';
import type {Place} from './data';
import type {Point} from './navigation';
import {formatDistance,nearestPlaces} from './proximity';
import type {NearbyStop} from './useNearbyStops';

export function NearbyPanel({origin,hospitals,stops,loading,error,onHospital,onStop,onHospitals,onBuses}:{origin:Point;hospitals:Place[];stops:NearbyStop[];loading:boolean;error:string;onHospital:(p:Place)=>void;onStop:(p:NearbyStop)=>void;onHospitals:()=>void;onBuses:()=>void}){
  const closest=useMemo(()=>nearestPlaces(origin,hospitals,3),[origin,hospitals]);
  return <section className="card nearby-panel" aria-labelledby="nearby-title"><div className="card-head"><div><span className="eyebrow">A PARTIR DA SUA ORIGEM</span><h2 id="nearby-title">Perto de você</h2></div><span className="badge green">Localização definida</span></div>
    <div className="nearby-columns"><div><div className="nearby-heading"><h3>Hospitais e UPAs mais próximos</h3><button className="text-button" onClick={onHospitals}>Ver todos</button></div><div className="nearby-list">{closest.map(p=><button className="nearby-item" key={p.id??p.name} onClick={()=>onHospital(p)}><span className="hospital-symbol" aria-hidden="true">✚</span><span><strong>{p.name}</strong><small>{p.facility_type==='upa'?'UPA':'Hospital'} · {p.ownership==='public'?'Rede pública':p.ownership==='private'?'Particular / filantrópico':'Rede não informada'}</small><small className="nearby-action">Ver trajeto →</small></span><b>{formatDistance(p.distance_m)}</b></button>)}</div></div>
    <div><div className="nearby-heading"><h3>Pontos de ônibus próximos a você</h3><button className="text-button" onClick={onBuses}>Ver ônibus</button></div>{loading?<p className="hint" role="status">Localizando pontos próximos…</p>:error?<p className="hint" role="status">{error}</p>:stops.length?<div className="nearby-list">{stops.slice(0,3).map(stop=><button className="nearby-item" key={stop.id} onClick={()=>onStop(stop)}><span className="bus-symbol" aria-hidden="true">▰</span><span><strong>{stop.name}</strong><small>{stop.district} · {stop.type==='terminal'?'Terminal':'Ponto de ônibus'}</small>{!!stop.lines?.length&&<small>Linhas: {stop.lines.map(l=>l.code).join(', ')}</small>}</span><b>{formatDistance(stop.distance_m??0)}</b></button>)}</div>:<p className="hint">Nenhum ponto cadastrado em até 1,5 km da sua origem.</p>}</div></div>
    <p className="hint nearby-note">Proximidade em linha reta, a partir da origem informada ou do GPS. Ao escolher a unidade, o trajeto usa as ruas e o modo de deslocamento selecionado.</p>
  </section>;
}
