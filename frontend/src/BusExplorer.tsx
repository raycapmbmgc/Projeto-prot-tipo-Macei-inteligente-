import {useEffect,useRef,useState} from 'react';
import {api,type BusRoute,type Place} from './data';
import type {Point} from './navigation';
import {TransitPanel} from './SupportPanels';
import {useNearbyStops} from './useNearbyStops';

type Stop=Point&{id:string;name:string;type:string;district?:string;distance_m?:number;lines?:{id:string;code:string;name:string}[]};
type Line={id:string;code:string;name:string;terminals:Stop[];terminal_distance_m?:number|null};
type Mapped=Omit<BusRoute,'geometry'>&{distance_m?:number|null};
type Result={lines:Line[];mapped_routes:Mapped[];source:string;fetched_at?:string;note?:string};
type Status={transport:{configured:boolean;lines:number;stops:number;mapped_routes:number;fetched_at?:string}};

export function BusExplorer({origin,destination,hasSchedules,tracking=false,resetKey=0,onShowRoute,onFocusStop,onAddStop,onMessage}:{origin:Point|null;destination:Place|null;hasSchedules:boolean;tracking?:boolean;resetKey?:number;onShowRoute:(route:BusRoute)=>void;onFocusStop:(stop:Stop)=>void;onAddStop:(stop:Place)=>void;onMessage:(s:string)=>void}){
  const [query,setQuery]=useState(''),[result,setResult]=useState<Result|null>(null),[metadata,setMetadata]=useState<Status|null>(null),[busy,setBusy]=useState(false),[selected,setSelected]=useState(''),[reference,setReference]=useState<'origin'|'destination'>('origin'),[radius,setRadius]=useState(1500),[nearbyOnly,setNearbyOnly]=useState(false);
  const point=reference==='origin'?origin??destination:destination??origin;
  const atOrigin=!!origin&&point===origin;
  const nearby=useNearbyStops(point,atOrigin&&tracking,radius);
  const stops=nearby.stops;
  const lineController=useRef<AbortController|null>(null),routeController=useRef<AbortController|null>(null);
  useEffect(()=>{api<Status>('/catalog/status').then(setMetadata).catch(e=>onMessage(e.message));},[]);
  useEffect(()=>{routeController.current?.abort();routeController.current=null;setSelected('');},[resetKey]);
  useEffect(()=>()=>{lineController.current?.abort();routeController.current?.abort();},[]);
  async function load(search=''){
    lineController.current?.abort();const controller=new AbortController();lineController.current=controller;setBusy(true);
    try{const params=new URLSearchParams({q:search});if(nearby.reference){params.set('lat',String(nearby.reference.lat));params.set('lon',String(nearby.reference.lon));params.set('radius',String(radius));params.set('nearby_only',String(nearbyOnly));}const data=await api<Result>('/transit/lines?'+params,{signal:controller.signal});if(lineController.current===controller)setResult(data);}
    catch(e){if((e as Error).name!=='AbortError')onMessage((e as Error).message);}finally{if(lineController.current===controller)setBusy(false);}
  }
  useEffect(()=>{void load(query);},[nearby.reference,radius,nearbyOnly]);
  async function showRoute(id:string){
    routeController.current?.abort();const controller=new AbortController();routeController.current=controller;
    try{const route=await api<BusRoute>('/transit/lines/'+encodeURIComponent(id),{signal:controller.signal});if(routeController.current!==controller)return;setSelected(id);onShowRoute(route);}
    catch(e){if((e as Error).name!=='AbortError')onMessage((e as Error).message);}
  }
  return <section className="bus-explorer">
    <div className="transit-planning"><div><h2>Planejar viagem de ônibus até a unidade</h2><p>Consulte combinações de linhas e horários no Google Maps. Origem e destino serão compartilhados com esse provedor somente ao abrir o link.</p></div>{origin&&destination?<a className="button" href={'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',origin:origin.lat+','+origin.lon,destination:destination.lat+','+destination.lon,travelmode:'transit'})} target="_blank" rel="noreferrer">Planejar transporte público ↗</a>:<p className="hint">Defina a origem e escolha um hospital ou UPA para habilitar o planejamento.</p>}</div>
    <div className="catalog-stats"><div><strong>{metadata?.transport.lines??'—'}</strong><span>linhas no catálogo municipal</span></div><div><strong>{metadata?.transport.stops??'—'}</strong><span>terminais e pontos cadastrados</span></div><div><strong>{metadata?.transport.mapped_routes??'—'}</strong><span>itinerários com geometria OSM</span></div></div>
    <p className="hint">Fonte de linhas e pontos: <a href="https://observatoriodacidade.maceio.al.gov.br/" target="_blank" rel="noreferrer">Observatório da Cidade de Maceió</a>. {metadata?.transport.fetched_at?'Importação: '+new Date(metadata.transport.fetched_at).toLocaleDateString('pt-BR')+'. ':''}A fonte não informa a data de vigência de cada linha. Confirme a operação antes da viagem.</p>
    <div className="field-pair bus-reference"><div><label htmlFor="bus-reference">Buscar perto de</label><select id="bus-reference" value={atOrigin?'origin':'destination'} onChange={e=>setReference(e.target.value as 'origin'|'destination')}><option value="origin" disabled={!origin}>Minha origem em Maceió</option><option value="destination" disabled={!destination}>Hospital / destino escolhido</option></select></div><div><label htmlFor="bus-radius">Distância máxima</label><select id="bus-radius" value={radius} onChange={e=>setRadius(Number(e.target.value))}><option value={500}>500 metros</option><option value={1500}>1,5 km</option><option value={3000}>3 km</option></select></div></div>
    <label className="check"><input type="checkbox" checked={nearbyOnly} disabled={!point} onChange={e=>setNearbyOnly(e.target.checked)}/> Mostrar somente linhas de terminais dentro dessa distância</label>
    <form className="bus-search" onSubmit={e=>{e.preventDefault();void load(query);}}><label htmlFor="bus-query">Linha, número, bairro ou destino</label><div><input id="bus-query" value={query} onChange={e=>setQuery(e.target.value)} maxLength={150} placeholder="Ex.: 104, Trapiche ou Benedito Bentes"/><button disabled={busy}>{busy?'Buscando…':'Buscar linhas'}</button></div></form>
    <div className="bus-section"><h2>{atOrigin?'Pontos de ônibus próximos à sua origem':destination?'Pontos próximos a '+destination.name:'Pontos de ônibus em Maceió'}</h2>{!point?<p className="hint">Informe sua origem em Maceió ou escolha uma unidade para localizar pontos próximos.</p>:nearby.loading?<p className="hint">Buscando pontos próximos…</p>:nearby.error?<p className="hint">{nearby.error}</p>:stops.length?<div className="bus-stop-list">{stops.map(stop=><article key={stop.id} className="bus-card"><h3>{stop.name}</h3><p>{stop.type==='terminal'?'Terminal':'Ponto de ônibus'} · {stop.district} · {stop.distance_m} m em linha reta</p>{!!stop.lines?.length&&<p>Linhas cadastradas neste terminal: {stop.lines.map(l=>l.code).join(', ')}</p>}<div className="button-row"><button onClick={()=>onFocusStop(stop)}>Localizar no mapa</button><button onClick={()=>onAddStop({lat:stop.lat,lon:stop.lon,name:stop.name+' · '+(stop.district??'')})}>Adicionar como parada</button></div></article>)}</div>:<p className="hint">Nenhum ponto cadastrado dentro da distância selecionada.</p>}</div>
    {result&&<>
      <div className="bus-section"><h2>{point?'Itinerários mapeados próximos '+(atOrigin?'à sua origem':'ao destino'):'Itinerários mapeados'}</h2><p className="hint">Geometrias colaborativas do OpenStreetMap, dentro da distância selecionada. A proximidade do percurso não garante um ponto de embarque nem uma viagem direta a partir da sua origem.</p>{result.mapped_routes.length?<div className="bus-line-grid">{result.mapped_routes.map(line=><article className={'bus-card '+(selected===line.id?'selected':'')} key={line.id}><span className="line-code">{line.code||'Sem código'}</span><h3>{line.name}</h3><p>{line.from&&line.to?line.from+' → '+line.to:''}</p>{line.distance_m!==undefined&&line.distance_m!==null&&<p>Percurso a aproximadamente {line.distance_m} m da referência escolhida.</p>}<button onClick={()=>void showRoute(line.id)}>Mostrar itinerário no mapa</button><a className="source-link" href={line.source} target="_blank" rel="noreferrer">Fonte OSM</a></article>)}</div>:<p className="hint">Não há geometrias de linhas cadastradas nesta área ou com esse filtro. Consulte abaixo o catálogo oficial por terminal.</p>}</div>
      <div className="bus-section"><h2>Linhas por terminal ({result.lines.length})</h2><p className="hint">{point?'Ordenadas pelo terminal mais próximo '+(atOrigin?'da sua origem. ':'do destino. '):''}O vínculo com o terminal não descreve todas as ruas do itinerário nem comprova passagem pelo hospital.</p><div className="bus-line-grid">{result.lines.map(line=><article className="bus-card" key={line.id}><span className="line-code">{line.code}</span><h3>{line.name}</h3>{line.terminals.map(stop=><button className="terminal-link" key={stop.id} onClick={()=>onFocusStop(stop)}>{stop.name} ↗</button>)}{line.terminal_distance_m!==undefined&&line.terminal_distance_m!==null&&<p>Terminal mais próximo: {(line.terminal_distance_m/1000).toFixed(1)} km em linha reta.</p>}</article>)}</div></div>
    </>}
    {hasSchedules?<TransitPanel origin={origin} destination={destination} available/>:<p className="source-notice">A planilha municipal fornece linhas e pontos, mas não horários de partida. As consultas acima não exibem previsões de chegada ou viagens inventadas.</p>}
  </section>;
}
