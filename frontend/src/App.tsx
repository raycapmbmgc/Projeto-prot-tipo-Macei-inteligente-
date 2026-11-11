import {useEffect,useMemo,useRef,useState} from 'react';
import maplibregl from 'maplibre-gl';
import {distance,project,type Point} from './navigation';
import {api,modeLabels,readFavorites,samePlace,type BusRoute,type Capabilities,type Place,type Report,type Road,type Route,type RouteReply,type SavedRoute} from './data';
import {Hospitals} from './Hospitals';
import {Compass} from './Compass';
import {AdminPanel,OfflinePanel,ReportsPanel} from './SupportPanels';
import {pages,RoadTable,EducationalGraph,type Page} from './OriginalNavigation';
import {VehicleProfileField,type VehicleProfile} from './VehicleProfile';
import {BusExplorer} from './BusExplorer';

const initialCapabilities:Capabilities={modes:['car'],transit:false,live_traffic:false,closure_routing:false,admin_protected:true,assistant:false};
type Traffic={source:string|null;features:{geometry:{coordinates:number[]};properties:{id:string;description:string;status:string;observed_at:string}}[]};

export default function App(){
  const [page,setPage]=useState<Page>('inicio'),[globalQuery,setGlobalQuery]=useState('');
  const container=useRef<HTMLDivElement>(null),map=useRef<maplibregl.Map|null>(null),routePanel=useRef<HTMLElement>(null);
  const gpsMarker=useRef<maplibregl.Marker|null>(null),watch=useRef<number|null>(null),lastFix=useRef(0),lastRecalc=useRef(0),spoken=useRef(''),requestId=useRef(0),startRequested=useRef(false),passed=useRef(0);
  const routeController=useRef<AbortController|null>(null),searchController=useRef<AbortController|null>(null);
  const [origin,setOrigin]=useState<Point|null>(null),[accuracy,setAccuracy]=useState<number|null>(null),[tracking,setTracking]=useState(false),[follow,setFollow]=useState(false);
  const [destination,setDestination]=useState<Place|null>(null),[waypoints,setWaypoints]=useState<Place[]>([]),[mode,setMode]=useState('car'),[objective,setObjective]=useState('fastest');
  const [vehicleProfile,setVehicleProfile]=useState<VehicleProfile>('standard'),[authorizationDeclared,setAuthorizationDeclared]=useState(false),[gpsDenied,setGpsDenied]=useState(false);
  const [busRoute,setBusRoute]=useState<BusRoute|null>(null),[focusedStop,setFocusedStop]=useState<Point|null>(null);
  const [avoidSteps,setAvoidSteps]=useState(false),[preferLit,setPreferLit]=useState(false),[avoidHills,setAvoidHills]=useState(false);
  const [caps,setCaps]=useState(initialCapabilities),[hospitals,setHospitals]=useState<Place[]>([]),[hospitalsLoading,setHospitalsLoading]=useState(true),[roads,setRoads]=useState<Road[]>([]),[reports,setReports]=useState<Report[]>([]),[traffic,setTraffic]=useState<Traffic|null>(null);
  const [favorites,setFavorites]=useState(readFavorites),[routes,setRoutes]=useState<Route[]>([]),[chosen,setChosen]=useState(0),[warnings,setWarnings]=useState<string[]>([]),[explanation,setExplanation]=useState(''),[preview,setPreview]=useState<SavedRoute|null>(null);
  const [status,setStatus]=useState('Escolha um hospital e defina sua origem para traçar a rota.'),[busy,setBusy]=useState(false),[searchBusy,setSearchBusy]=useState(false),[ready,setReady]=useState(false),[online,setOnline]=useState(navigator.onLine),[eventsLive,setEventsLive]=useState(false);
  const [nav,setNav]=useState<'idle'|'active'|'paused'>('idle'),[progress,setProgress]=useState(0),[remaining,setRemaining]=useState(0),[step,setStep]=useState(0),[voice,setVoice]=useState(false);
  const [query,setQuery]=useState(''),[searchFor,setSearchFor]=useState<'origin'|'destination'|'waypoint'>('origin'),[results,setResults]=useState<Place[]>([]);
  const [assistantMessage,setAssistantMessage]=useState(''),[assistantReply,setAssistantReply]=useState(''),[assistantBusy,setAssistantBusy]=useState(false);
  const route=preview?undefined:routes[chosen],displayRoute=preview?.route??route,displayDestination=preview?.destination??destination;
  const stepProgress=useMemo(()=>route?.steps.map(s=>project({lat:s.coordinate[1],lon:s.coordinate[0]},route.geometry.coordinates).progress)??[],[route]);

  function invalidate(){
    requestId.current++;routeController.current?.abort();startRequested.current=false;passed.current=0;
    setBusy(false);setRoutes([]);setPreview(null);setNav('idle');setWarnings([]);setExplanation('');window.speechSynthesis?.cancel();
  }
  function chooseHospital(p:Place){
    if(p.routable===false){setStatus('Esta unidade ainda não possui coordenadas utilizáveis. Consulte o endereço e a fonte cadastral.');return;}
    invalidate();setDestination(p);setPage('mapa');setStatus(`Destino: ${p.name}. Defina a origem e calcule o trajeto.`);
    map.current?.easeTo({center:[p.lon,p.lat],zoom:15});
    requestAnimationFrame(()=>routePanel.current?.scrollIntoView({behavior:'smooth',block:'nearest'}));
  }
  function stopGps(){
    startRequested.current=false;if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);
    watch.current=null;lastFix.current=0;setTracking(false);setFollow(false);setNav('idle');window.speechSynthesis?.cancel();
  }
  function locate(){
    if(!navigator.geolocation){startRequested.current=false;setStatus('Localização indisponível. Pesquise a origem manualmente.');return;}
    if(!window.isSecureContext){startRequested.current=false;setStatus('O GPS exige uma conexão HTTPS ou acesso local. Pesquise a origem manualmente.');return;}
    if(watch.current!==null)return;
    setStatus('Aguardando permissão de localização…');setFollow(true);setGpsDenied(false);
    watch.current=navigator.geolocation.watchPosition(p=>{
      if(p.timestamp-lastFix.current<3000)return;lastFix.current=p.timestamp;
      setOrigin({lat:p.coords.latitude,lon:p.coords.longitude});setAccuracy(p.coords.accuracy);setTracking(true);
      if(startRequested.current){startRequested.current=false;setNav('active');}
      setStatus('GPS atualizado. Confira a precisão antes de seguir.');
    },e=>{stopGps();setGpsDenied(e.code===1);setStatus(e.code===1?'O navegador bloqueou a localização. Você pode informar sua origem manualmente.':'Sem sinal de localização. Tente novamente ou informe sua origem.');},{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
  }
  async function loadHospitals(){
    setHospitalsLoading(true);
    try{setHospitals(await api<Place[]>('/hospitals'));}catch(e){setStatus((e as Error).message);}finally{setHospitalsLoading(false);}
  }
  async function refreshIncidents(){
    const results=await Promise.allSettled([api<Road[]>('/roads'),api<Report[]>('/reports')]);
    if(results[0].status==='fulfilled')setRoads(results[0].value);
    if(results[1].status==='fulfilled')setReports(results[1].value);
    if(results.some(r=>r.status==='rejected'))setStatus('Não foi possível atualizar as ocorrências. Os registros exibidos podem estar desatualizados.');
  }
  function refreshAll(){void loadHospitals();void refreshIncidents();}
  useEffect(()=>{
    void loadHospitals();void refreshIncidents();
    api<Capabilities>('/capabilities').then(setCaps).catch(e=>setStatus(e.message));
    let m:maplibregl.Map|undefined;
    try{
      m=new maplibregl.Map({container:container.current!,style:{version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm'}]},center:[-35.7089,-9.6498],zoom:13});map.current=m;
      m.addControl(new maplibregl.NavigationControl());
      m.on('style.load',()=>{m!.addSource('route',{type:'geojson',data:{type:'FeatureCollection',features:[]}});m!.addLayer({id:'route',type:'line',source:'route',paint:{'line-color':'#a80d22','line-width':6}});m!.addSource('bus',{type:'geojson',data:{type:'FeatureCollection',features:[]}});m!.addLayer({id:'bus',type:'line',source:'bus',paint:{'line-color':'#176e92','line-width':5,'line-opacity':.85}});setReady(true);});
      m.on('click',e=>{invalidate();setDestination({lat:e.lngLat.lat,lon:e.lngLat.lng,name:'Ponto selecionado no mapa'});setStatus('Ponto selecionado. Para ir a um hospital, escolha-o na lista.');});
      m.on('dragstart',()=>setFollow(false));m.on('error',()=>setStatus('O mapa não carregou completamente. Confira a conexão; a lista de hospitais continua disponível.'));
    }catch{setStatus('Mapa indisponível neste navegador. Você ainda pode pesquisar hospitais e consultar instruções.');}
    const connected=()=>{setOnline(true);void loadHospitals();void refreshIncidents();};
    const disconnected=()=>{setOnline(false);setStatus('Sem conexão. Consulte as instruções de um percurso salvo; mapas e novos trajetos precisam de rede.');};
    window.addEventListener('online',connected);window.addEventListener('offline',disconnected);
    let ws:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,disposed=false;
    function connect(){
      ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/events`);
      ws.onopen=()=>{setEventsLive(true);void refreshIncidents();};
      ws.onmessage=e=>{try{const event=JSON.parse(e.data);if(event.type==='roads.changed'||event.type==='reports.changed')void refreshIncidents();}catch{/* Ignore invalid events and resync on reconnect. */}};
      ws.onclose=()=>{setEventsLive(false);if(!disposed)timer=setTimeout(connect,5000);};
      ws.onerror=()=>ws?.close();
    }
    connect();
    const polling=window.setInterval(()=>void refreshIncidents(),60000);
    return()=>{disposed=true;clearTimeout(timer);clearInterval(polling);ws?.close();window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected);routeController.current?.abort();searchController.current?.abort();if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);window.speechSynthesis?.cancel();m?.remove();};
  },[]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>map.current?.resize());return()=>cancelAnimationFrame(frame);},[page]);
  useEffect(()=>{
    if(!caps.live_traffic)return;
    let disposed=false;
    const update=()=>api<Traffic>('/traffic').then(data=>{if(!disposed)setTraffic(data);}).catch(()=>{if(!disposed){setTraffic(null);setStatus('Fonte de trânsito indisponível. Não há confirmação das condições atuais.');}});
    void update();const timer=setInterval(()=>void update(),60000);return()=>{disposed=true;clearInterval(timer);};
  },[caps.live_traffic]);
  useEffect(()=>{
    if(!ready||!map.current)return;
    const markers=hospitals.filter(h=>h.routable!==false&&Number.isFinite(h.lat)&&Number.isFinite(h.lon)).map(h=>{
      const button=document.createElement('button');button.className='hospital-map-marker';button.textContent='✚';button.title=h.name;button.setAttribute('aria-label','Selecionar '+h.name);
      button.onclick=e=>{e.stopPropagation();chooseHospital(h);};
      return new maplibregl.Marker({element:button}).setLngLat([h.lon,h.lat]).addTo(map.current!);
    });return()=>markers.forEach(m=>m.remove());
  },[hospitals,ready]);
  useEffect(()=>{
    if(!ready||!map.current)return;
    const source=map.current.getSource('bus') as maplibregl.GeoJSONSource;
    source?.setData(busRoute?{type:'Feature',properties:{},geometry:busRoute.geometry}:{type:'FeatureCollection',features:[]});
    map.current.setLayoutProperty('bus','visibility',page==='onibus'?'visible':'none');
    map.current.setLayoutProperty('route','visibility',page==='onibus'?'none':'visible');
    if(busRoute&&page==='onibus'){const bounds=new maplibregl.LngLatBounds();busRoute.geometry.coordinates.flat().forEach(c=>bounds.extend([c[0],c[1]]));map.current.fitBounds(bounds,{padding:50});}
    const markers=page==='onibus'?(busRoute?.stops??[]).map(s=>{const el=document.createElement('div');el.className='bus-map-marker';el.title='Parada do itinerário OSM';return new maplibregl.Marker({element:el}).setLngLat([s.lon,s.lat]).addTo(map.current!);}):[];
    return()=>markers.forEach(m=>m.remove());
  },[busRoute,page,ready]);
  useEffect(()=>{
    if(!focusedStop||!map.current||!ready||page!=='onibus')return;
    const marker=new maplibregl.Marker({color:'#176e92'}).setLngLat([focusedStop.lon,focusedStop.lat]).addTo(map.current);
    map.current.easeTo({center:[focusedStop.lon,focusedStop.lat],zoom:17});return()=>{marker.remove();};
  },[focusedStop,page,ready]);
  useEffect(()=>{
    if(!ready||!map.current)return;
    const active=reports.filter(r=>r.verification!=='resolved'&&new Date(r.expires_at).getTime()>Date.now());
    const markers=active.map(r=>{
      const button=document.createElement('button');button.className='incident-map-marker '+r.verification;button.textContent='!';button.title=(r.verification==='verified'?'Verificada: ':'Não verificada: ')+r.description;
      button.setAttribute('aria-label',button.title);button.onclick=e=>{e.stopPropagation();setStatus(button.title);};
      return new maplibregl.Marker({element:button}).setLngLat([r.location.lon,r.location.lat]).addTo(map.current!);
    });
    const trafficMarkers=(traffic?.features??[]).map(f=>{
      const button=document.createElement('button');button.className='incident-map-marker verified';button.textContent=f.properties.status==='closed'?'×':'!';button.title=f.properties.description+' · '+traffic?.source;button.setAttribute('aria-label',button.title);button.onclick=e=>{e.stopPropagation();setStatus(button.title);};
      return new maplibregl.Marker({element:button}).setLngLat([f.geometry.coordinates[0],f.geometry.coordinates[1]]).addTo(map.current!);
    });return()=>[...markers,...trafficMarkers].forEach(m=>m.remove());
  },[reports,traffic,ready]);
  useEffect(()=>{
    if(!ready||!map.current||!displayDestination)return;
    const marker=new maplibregl.Marker({color:'#a80d22'}).setLngLat([displayDestination.lon,displayDestination.lat]).addTo(map.current);return()=>{marker.remove();};
  },[displayDestination,ready]);
  useEffect(()=>{
    if(!ready||!map.current)return;
    const markers=waypoints.map((p,i)=>{const button=document.createElement('div');button.className='waypoint-marker';button.textContent=String(i+1);return new maplibregl.Marker({element:button}).setLngLat([p.lon,p.lat]).addTo(map.current!);});
    return()=>markers.forEach(m=>m.remove());
  },[waypoints,ready]);
  useEffect(()=>{
    if(!ready||!map.current||!origin)return;
    if(!gpsMarker.current)gpsMarker.current=new maplibregl.Marker({color:'#2563eb'}).setLngLat([origin.lon,origin.lat]).addTo(map.current);
    gpsMarker.current.setLngLat([origin.lon,origin.lat]);
    if(follow)map.current.easeTo({center:[origin.lon,origin.lat],zoom:nav==='active'?17:15});
  },[origin,follow,nav,ready]);
  useEffect(()=>{
    if(!ready||!map.current)return;
    const source=map.current.getSource('route') as maplibregl.GeoJSONSource;
    source?.setData(displayRoute?{type:'Feature',properties:{},geometry:displayRoute.geometry}:{type:'FeatureCollection',features:[]});
    if(displayRoute){const bounds=new maplibregl.LngLatBounds();displayRoute.geometry.coordinates.forEach(c=>bounds.extend([c[0],c[1]]));map.current.fitBounds(bounds,{padding:55});setRemaining(displayRoute.distance);setProgress(0);setStep(0);spoken.current='';}
  },[displayRoute,ready]);
  // Reset instructions even if WebGL is unavailable.
  useEffect(()=>{setStep(0);setProgress(0);setRemaining(displayRoute?.distance??0);spoken.current='';},[displayRoute]);

  async function calculate(from=origin){
    if(!from||!destination){setStatus('Defina sua origem e selecione um hospital.');return;}
    routeController.current?.abort();const controller=new AbortController();routeController.current=controller;
    const id=++requestId.current;setBusy(true);setPreview(null);
    try{
      const pedestrian=mode==='walk'||mode==='wheelchair';
      const reply=await api<RouteReply>('/routes',{method:'POST',signal:controller.signal,body:JSON.stringify({origin:from,destination,mode,objective,vehicle_profile:mode==='car'?vehicleProfile:'standard',authorization_declared:authorizationDeclared,waypoints:waypoints.slice(passed.current),avoid_steps:pedestrian&&avoidSteps,prefer_lit:pedestrian&&preferLit,avoid_hills:pedestrian&&avoidHills})});
      if(id!==requestId.current)return;
      if(!reply.routes.length)throw Error('Nenhum trajeto encontrado. Tente outro ponto de origem.');
      setRoutes(reply.routes);setChosen(0);setWarnings(reply.warnings);setExplanation(reply.provider+' · '+reply.explanation);setStatus('Trajeto calculado. Confira as instruções antes de iniciar.');
    }catch(e){if(id===requestId.current&&(e as Error).name!=='AbortError'){setNav('paused');setStatus((e as Error).message);}}
    finally{if(id===requestId.current)setBusy(false);}
  }
  useEffect(()=>{
    if(nav!=='active'||!origin||!route||!tracking){window.speechSynthesis?.cancel();return;}
    const p=project(origin,route.geometry.coordinates);setProgress(p.progress);setRemaining(p.remaining);
    while(passed.current<waypoints.length&&distance(origin,waypoints[passed.current])<Math.max(30,Math.min(accuracy??20,50)))passed.current++;
    let next=step;while(next<route.steps.length-1 && stepProgress[next+1]<=p.progress+20/Math.max(1,route.distance))next++;
    setStep(next);const instruction=route.steps[next]?.instruction;
    if(voice&&instruction&&spoken.current!==instruction&&'speechSynthesis' in window){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(instruction);utterance.lang='pt-BR';speechSynthesis.speak(utterance);spoken.current=instruction;}
    if(!voice)window.speechSynthesis?.cancel();
    if(p.offset>Math.max(60,(accuracy??20)*2)&&Date.now()-lastRecalc.current>30000&&!busy){lastRecalc.current=Date.now();void calculate(origin);}
    if(p.progress>.98&&destination&&distance(origin,destination)<30&&(accuracy??0)<100){setNav('idle');setStatus('Você chegou ao destino. Confirme a entrada do hospital.');window.speechSynthesis?.cancel();}
  },[origin,nav,route,tracking,voice,step,stepProgress,accuracy,busy,destination,waypoints]);
  function toggleFavorite(place:Place){
    const exists=favorites.some(p=>samePlace(p,place));const next=exists?favorites.filter(p=>!samePlace(p,place)):[...favorites,place];
    if(next.length>50){setStatus('Limite de 50 favoritos. Remova um local para salvar outro.');return;}
    try{localStorage.setItem('maceio:favorites',JSON.stringify(next));setFavorites(next);setStatus(exists?'Local removido dos favoritos.':'Favorito salvo somente neste navegador.');}catch{setStatus('Armazenamento indisponível. Não foi possível salvar os favoritos.');}
  }
  async function search(e:React.FormEvent){
    e.preventDefault();searchController.current?.abort();const controller=new AbortController();searchController.current=controller;setSearchBusy(true);setResults([]);
    try{const reply=await api<Place[]>('/search?q='+encodeURIComponent(query),{signal:controller.signal});if(controller!==searchController.current)return;setResults(reply);setStatus(reply.length?'Selecione um resultado.':'Nenhum endereço encontrado. Tente incluir bairro e Maceió.');}
    catch(e){if((e as Error).name!=='AbortError')setStatus((e as Error).message);}finally{if(controller===searchController.current)setSearchBusy(false);}
  }
  function selectSearch(p:Place){
    invalidate();
    if(searchFor==='origin'){stopGps();setOrigin(p);setAccuracy(null);map.current?.flyTo({center:[p.lon,p.lat],zoom:15});}
    else if(searchFor==='waypoint'){if(waypoints.length>=5){setStatus('Você pode adicionar até cinco paradas.');return;}setWaypoints([...waypoints,p]);}
    else setDestination(p);
    setResults([]);setStatus(searchFor==='waypoint'?'Parada adicionada antes do hospital. Calcule o percurso novamente.':'Ponto selecionado. Calcule o trajeto quando estiver pronto.');
  }
  async function askAssistant(e:React.FormEvent){
    e.preventDefault();setAssistantBusy(true);
    try{const reply=await api<{answer:string;destination_query:string|null;mode:string|null;vehicle_profile:VehicleProfile|null}>('/assistant',{method:'POST',body:JSON.stringify({message:assistantMessage})});setAssistantReply(reply.answer);if(reply.destination_query){setQuery(reply.destination_query);setSearchFor('destination');const found=hospitals.find(h=>h.name===reply.destination_query);if(found)chooseHospital(found);}if(reply.mode&&caps.modes.includes(reply.mode)){invalidate();setMode(reply.mode);setVehicleProfile('standard');setAuthorizationDeclared(false);}if(reply.vehicle_profile){invalidate();setMode('car');setVehicleProfile(reply.vehicle_profile);setAuthorizationDeclared(false);}}
    catch(e){setAssistantReply((e as Error).message);}finally{setAssistantBusy(false);}
  }
  const pedestrian=mode==='walk'||mode==='wheelchair';
  const currentPage=pages.find(p=>p.id===page)!;
  const showMap=['inicio','mapa','rotas','onibus'].includes(page);
  const showPlanner=['inicio','mapa','rotas','hospitais'].includes(page);
  return <div className="app original-shell"><aside className="sidebar">
    <a className="brand original-logo" href="/" aria-label="Maceió Inteligente — início"><img src="/branding/logo.png" alt="Maceió Inteligente — Rotas de Emergência" width="1536" height="1024" decoding="async"/></a>
    <div className="tagline">Seu caminho até o hospital, com orientação.</div><div className="nav-label">Menu principal</div>
    <nav className="nav" aria-label="Menu principal">{pages.map(p=><button key={p.id} className={page===p.id?'active':''} aria-current={page===p.id?'page':undefined} onClick={()=>{setPage(p.id);setStatus('');window.scrollTo({top:0,behavior:'smooth'});}}><span className="nav-icon" aria-hidden="true">{p.icon}</span>{p.label}</button>)}</nav>
    <div className="sidebar-bottom">Maceió · Alagoas<br/>Hospitais, UPAs e caminhos para o cuidado.</div>
  </aside><div className="main original-main">
    <header className="topbar"><form className="searchbox" onSubmit={e=>{e.preventDefault();const matches=hospitals.filter(h=>h.name.toLocaleLowerCase('pt-BR').includes(globalQuery.toLocaleLowerCase('pt-BR')));if(matches.length===1)chooseHospital(matches[0]);else{setPage('hospitais');setStatus(matches.length?`${matches.length} hospitais correspondem à pesquisa. Use o filtro da lista.`:'Hospital não encontrado. Consulte a lista ou pesquise um endereço.');}}}><span aria-hidden="true">⌕</span><input aria-label="Buscar hospital" value={globalQuery} onChange={e=>setGlobalQuery(e.target.value)} placeholder="Buscar hospital..."/><button type="submit" className="search-submit">Buscar</button></form><div className="top-actions"><button className="circle-btn" title="Ocorrências" aria-label="Abrir ocorrências" onClick={()=>setPage('ocorrencias')}>⚑</button><button className="circle-btn" title="Ajuda" aria-label="Como traçar uma rota" onClick={()=>setStatus('Escolha um hospital, ative o GPS ou informe a origem, calcule a rota e pressione Iniciar navegação.')}>?</button><span className={'connection-pill '+(!online?'offline':'')}>{online?'Conectado':'Sem conexão'}</span></div></header>
    <div className="content original-content"><div className="page-heading"><div><div className="eyebrow">{page==='inicio'?'Painel principal':'Maceió Inteligente'}</div><h1>{currentPage.title}</h1><p>{currentPage.description}</p></div>{!showMap&&<button className="button secondary" onClick={()=>setPage('mapa')}>Abrir mapa</button>}</div>
    <div className={'hospital-workspace page-'+page}>
    <div className="planner-column" hidden={!showPlanner}>
    <section className="card red origin-card" hidden={page==='hospitais'}>
    <p className="eyebrow">SEU CAMINHO ATÉ O CUIDADO</p><h1>Encontre um hospital.<br/>{' '}Siga com orientação.</h1>
    <p className="muted">Escolha um hospital em Maceió e compare os trajetos a partir de onde você está.</p>
    <button className="primary w-full" onClick={locate} disabled={tracking}>◎ Usar minha localização</button>{tracking&&<button onClick={stopGps}>Interromper GPS</button>}
    <p className="hint">{accuracy!==null?`Precisão estimada: ${Math.round(accuracy)} m${accuracy>50?' · sinal aproximado':''}`:'O GPS só é acessado com sua permissão. Você também pode pesquisar uma origem.'}</p>
    <button className="manual-origin" onClick={()=>{setSearchFor('origin');setPage('rotas');requestAnimationFrame(()=>document.getElementById('query')?.focus());}}>Definir origem manualmente</button>
    {gpsDenied&&<div className="gps-help">Para reativar o GPS, abra as permissões pelo ícone ao lado do endereço do navegador e permita “Localização”. A origem manual continua disponível.</div>}
    </section>
    <div className="card" hidden={page==='mapa'||page==='rotas'}><Hospitals hospitals={hospitals} origin={origin} destination={destination} favorites={favorites} onSelect={chooseHospital} onFavorite={toggleFavorite} loading={hospitalsLoading} onReload={()=>void loadHospitals()}/></div>
    <section ref={routePanel} className="route-planner card" hidden={page==='hospitais'} aria-labelledby="route-title"><h2 id="route-title">Seu trajeto até o hospital</h2>
      <div className="endpoints"><p><i className={origin?'dot blue':'dot'}/>{origin?'Origem definida':'Informe a origem ou ative o GPS'}</p><p><i className="dot red"/>{destination?.name||'Escolha um hospital na lista'}</p></div>
      <form onSubmit={search}><label htmlFor="searchFor">Pesquisar endereço para</label><select id="searchFor" value={searchFor} onChange={e=>{searchController.current?.abort();setSearchBusy(false);setResults([]);setSearchFor(e.target.value as typeof searchFor);}}><option value="origin">Origem manual</option><option value="waypoint">Parada intermediária</option><option value="destination">Outro destino</option></select>
        <label htmlFor="query">Endereço ou estabelecimento</label><input id="query" minLength={3} maxLength={180} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ex.: Rua do Comércio, Maceió" required/><button disabled={searchBusy||!online}>{searchBusy?'Pesquisando…':'Buscar endereço →'}</button>
      </form><div className="results">{results.map((p,i)=><button key={i} onClick={()=>selectSearch(p)}>{p.name}</button>)}</div>
      {waypoints.length>0&&<div className="waypoints"><h3>Paradas antes do destino</h3><ol>{waypoints.map((p,i)=><li key={i}><span>{p.name}</span><div><button aria-label={'Mover parada '+(i+1)+' para cima'} disabled={i===0||nav==='active'} onClick={()=>{invalidate();const next=[...waypoints];[next[i-1],next[i]]=[next[i],next[i-1]];setWaypoints(next);}}>↑</button><button disabled={nav==='active'} aria-label={'Remover parada '+(i+1)} onClick={()=>{invalidate();setWaypoints(waypoints.filter((_,n)=>n!==i));}}>Remover</button></div></li>)}</ol></div>}
      <div className="field-pair"><div><label htmlFor="mode">Como ir</label><select id="mode" value={mode} onChange={e=>{invalidate();setMode(e.target.value);setVehicleProfile('standard');setAuthorizationDeclared(false);}}>{Object.entries(modeLabels).map(([id,label])=><option value={id} disabled={!caps.modes.includes(id)} key={id}>{label}{!caps.modes.includes(id)?' · indisponível':''}</option>)}</select></div><div><label htmlFor="objective">Preferência</label><select id="objective" value={objective} onChange={e=>{invalidate();setObjective(e.target.value);}}><option value="fastest">Mais rápida</option><option value="shortest">Mais curta</option></select></div></div>
      {mode==='car'&&<VehicleProfileField profile={vehicleProfile} declared={authorizationDeclared} onProfile={profile=>{invalidate();setVehicleProfile(profile);setAuthorizationDeclared(false);}} onDeclared={value=>{invalidate();setAuthorizationDeclared(value);}}/>}
      {pedestrian&&<fieldset className="preferences"><legend>Personalizar o caminho</legend><label><input type="checkbox" checked={avoidSteps} onChange={e=>{invalidate();setAvoidSteps(e.target.checked);}}/> Preferir caminhos sem escadas</label><label><input type="checkbox" checked={preferLit} onChange={e=>{invalidate();setPreferLit(e.target.checked);}}/> Preferir vias iluminadas</label><label><input type="checkbox" checked={avoidHills} onChange={e=>{invalidate();setAvoidHills(e.target.checked);}}/> Preferir menos ladeiras</label><p className="hint">Preferências baseadas no mapa. Não garantem acessibilidade ou condições atuais da via.</p></fieldset>}
      <button className="primary w-full" disabled={busy||!origin||!destination||!online||mode==='car'&&vehicleProfile!=='standard'&&!authorizationDeclared} onClick={()=>void calculate()}>{busy?'Calculando trajeto…':'Encontrar rotas até o destino →'}</button>
      {destination&&<button className="text-button" onClick={()=>toggleFavorite(destination)}>{favorites.some(p=>samePlace(p,destination))?'★ Remover destino dos favoritos':'☆ Salvar destino favorito'}</button>}
      <div className="route-options">{!preview&&routes.map((r,i)=><button className={chosen===i?'selected':''} aria-pressed={chosen===i} key={i} onClick={()=>{setChosen(i);setNav('idle');window.speechSynthesis?.cancel();}}><strong>{Math.max(1,Math.round(r.duration/60))} min</strong><span>{(r.distance/1000).toFixed(1)} km · Opção {i+1}{i===0?' · recomendada':''}</span></button>)}</div>
      {explanation&&!preview&&<p className="hint">{explanation} A recomendação compara trajetos; não avalia atendimento ou adequação clínica do hospital.</p>}
      {warnings.length>0&&!preview&&<ul className="route-warnings">{warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul>}
      {preview&&<div className="offline-notice"><strong>Percurso salvo: {preview.destination.name}</strong><p>Salvo em {new Date(preview.savedAt).toLocaleString('pt-BR')}. As condições podem ter mudado. Calcule uma rota atualizada antes de navegar.</p><button onClick={()=>setPreview(null)}>Voltar ao planejamento</button></div>}
      {displayRoute&&<section className="navigation"><h2>{preview?'Instruções salvas':nav==='active'?'Navegando até o destino':nav==='paused'?'Navegação pausada':'Pronto para sair'}</h2>
        <strong>{displayRoute.steps[step]?.instruction}</strong><p>{displayRoute.steps[step]?.street}</p>
        <div className="metrics"><span>{(remaining/1000).toFixed(1)} km {preview?'no percurso':'restantes'}</span><span>{preview?`${Math.round(displayRoute.duration/60)} min estimados na consulta`:'Chegada estimada '+new Date(Date.now()+displayRoute.duration*(1-progress)*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span></div>
        {!preview&&<><progress value={progress} max={1}/><label><input type="checkbox" checked={voice} onChange={e=>{setVoice(e.target.checked);if(!e.target.checked)window.speechSynthesis?.cancel();}} disabled={!('speechSynthesis' in window)}/> Instruções por voz</label>
          <button className="primary" disabled={!route||busy} onClick={()=>{if(!route)return;if(nav==='active'){setNav('paused');return;}if(!tracking){startRequested.current=true;locate();return;}setFollow(true);setNav('active');}}>{nav==='active'?'Pausar':'Iniciar navegação'}</button>{' '}
          <button onClick={()=>{startRequested.current=false;setNav('idle');setProgress(0);setStep(0);setRemaining(route?.distance??0);window.speechSynthesis?.cancel();}}>Encerrar</button>{' '}<button onClick={()=>void calculate()} disabled={busy||!online}>Recalcular</button>
        </>}
        <details><summary>Instruções completas</summary><ol>{displayRoute.steps.map((s,i)=><li key={i}>{s.instruction} · {Math.round(s.distance)} m</li>)}</ol></details>
      </section>}
    </section>
    </div>
    <section className="map-panel card" hidden={!showMap}>
    <div className="card-head"><div><span className="eyebrow">{page==='onibus'?'TRANSPORTE PÚBLICO':'MAPA E PERCURSO'}</span><h2>{page==='onibus'?busRoute?.name||'Linhas e pontos de Maceió':displayDestination?.name||'Hospitais e UPAs de Maceió'}</h2></div>{page==='onibus'?<button disabled={!busRoute} onClick={()=>setBusRoute(null)}>Limpar itinerário</button>:<span className="badge">{route?`${Math.round(route.duration/60)} min`:'Selecione uma unidade'}</span>}</div>
    <div className="map-surface"><div className="map" ref={container} aria-label="Mapa de hospitais e trajetos de Maceió"/>
    <div className="map-label">✚ HOSPITAIS <span>Toque em uma cruz para selecionar</span></div>
    <div className="map-tools"><Compass map={map.current}/><button onClick={()=>{if(origin){setFollow(true);map.current?.easeTo({center:[origin.lon,origin.lat],zoom:17});}}} disabled={!origin}>◎ Centralizar</button></div></div>
    <div className="map-legend"><span><span className={'legend-line '+(page==='onibus'?'bus':'')}/>{page==='onibus'?'Itinerário de ônibus':'Trajeto selecionado'}</span><span><span className="legend-dot"/>Hospital / UPA</span></div><p className="hint">{page==='onibus'?'Percursos OSM: geometria disponível não equivale a horário ou ponto de embarque confirmado.':eventsLive?'Ocorrências conectadas':'Atualizações de ocorrências por consulta'}</p>
    {displayRoute&&page!=='onibus'&&<div className="route-metrics"><div className="metric"><small>Distância do trajeto</small><strong>{(displayRoute.distance/1000).toFixed(1)} km</strong></div><div className="metric"><small>Tempo estimado</small><strong>{Math.max(1,Math.round(displayRoute.duration/60))} min</strong></div></div>}
    </section></div>
    <section className="card support-area" hidden={page!=='favoritos'}>
    <details open><summary>Meus locais favoritos ({favorites.length})</summary><p className="hint">Salvos somente neste navegador. Nenhuma posição é adicionada automaticamente.</p>{favorites.map((p,i)=><div className="favorite" key={i}><button onClick={()=>chooseHospital(p)}>{p.name}</button><button aria-label={'Remover favorito '+p.name} onClick={()=>toggleFavorite(p)}>×</button></div>)}</details>
    <OfflinePanel route={displayRoute} destination={displayDestination} warnings={preview?.warnings??warnings} onPreview={saved=>{setNav('idle');setPreview(saved);setPage('rotas');window.speechSynthesis?.cancel();}} onMessage={setStatus}/>
    </section>
    <section className="card support-area" hidden={page!=='ocorrencias'}><ReportsPanel reports={reports} selected={destination} onRefresh={()=>void refreshIncidents()} onMessage={setStatus}/></section>
    <section className="card support-area" hidden={page!=='config'&&page!=='rotas'}>
    <details><summary>Assistente para planejar o trajeto</summary><p className="hint">{caps.assistant_provider==='ollama'?'Assistente com IA configurada. Sua pergunta é enviada ao serviço; o GPS não é incluído.':'Assistente local: reconhece nomes de unidades e modos de deslocamento, sem depender de IA externa.'} Não faz triagem nem confirma atendimento.</p><form onSubmit={askAssistant}><label htmlFor="assistant">Como deseja chegar à unidade?</label><input id="assistant" minLength={3} maxLength={1000} required value={assistantMessage} onChange={e=>setAssistantMessage(e.target.value)} placeholder="Quero ir ao HGE de ambulância"/><button disabled={assistantBusy||!online}>{assistantBusy?'Consultando…':'Planejar com o assistente'}</button></form><p className="hint" role="status">{assistantReply}</p></details>
    <button className="text-button" onClick={()=>setPage('onibus')}>Consultar ônibus, terminais e pontos próximos →</button>
    {caps.live_traffic&&<details><summary>Informações de trânsito</summary><p className="hint">Fonte: {traffic?.source??'indisponível'}. Lentidão não é incorporada ao tempo estimado. Bloqueios georreferenciados são enviados ao provedor compatível para solicitar desvios.</p>{traffic?.features.map(f=><p key={f.properties.id}>{f.properties.description} · observado em {new Date(f.properties.observed_at).toLocaleString('pt-BR')}</p>)}</details>}
    </section>
    <section className="card support-area" hidden={page!=='config'}><AdminPanel roads={roads} reports={reports} selected={destination} capabilities={caps} onRefresh={refreshAll} onMessage={setStatus}/><details><summary>Fontes de dados e privacidade</summary><p className="hint">Unidades de saúde: CNES/Ministério da Saúde. Linhas e pontos: Observatório da Cidade. As datas cadastrais aparecem nos detalhes das unidades. Não há vagas ou filas hospitalares em tempo real. GPS somente com permissão; origem e destino são enviados ao provedor para calcular trajetos. Favoritos e percursos salvos ficam neste navegador.</p></details></section>
    {page==='onibus'&&<section className="card support-area"><BusExplorer origin={origin} destination={destination} hasSchedules={caps.transit} onShowRoute={data=>{setBusRoute(data);setFocusedStop(null);setStatus('Itinerário OSM exibido: '+data.name);}} onFocusStop={stop=>{setFocusedStop(stop);setStatus('Ponto selecionado: '+stop.name);}} onAddStop={stop=>{if(waypoints.length>=5){setStatus('Limite de cinco paradas.');return;}invalidate();setWaypoints([...waypoints,stop]);setPage('rotas');setStatus('Ponto de ônibus adicionado ao trajeto antes do hospital.');}} onMessage={setStatus}/></section>}
    <div hidden={page!=='hash'}><RoadTable roads={roads}/></div><div hidden={page!=='grafo'}><EducationalGraph stops={waypoints.length}/></div>
    {status&&<div className="app-status" role="status" aria-live="polite"><span>{status}</span><button onClick={()=>setStatus('')} aria-label="Dispensar mensagem">×</button></div>}
    <p className="footer-note">Maceió Inteligente · Rotas para unidades de saúde · © OpenStreetMap contributors <button className="text-button" onClick={()=>setPage('config')}>Fontes e privacidade</button></p>
    </div></div></div>;
}
