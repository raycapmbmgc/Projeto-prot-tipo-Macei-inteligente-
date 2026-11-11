import {useState} from 'react';
import {api,readSavedRoute,type Place,type Route,type Report,type Road,type SavedRoute,type Capabilities} from './data';
import type {Point} from './navigation';

export function OfflinePanel({route,destination,warnings,onPreview,onMessage}:{route:Route|undefined;destination:Place|null;warnings:string[];onPreview:(saved:SavedRoute)=>void;onMessage:(message:string)=>void}) {
  const [saved,setSaved]=useState(readSavedRoute);
  function save(){
    if(!route||!destination)return;
    const item={route,destination,warnings,savedAt:new Date().toISOString()};
    try {localStorage.setItem('maceio:saved-route',JSON.stringify(item));setSaved(item);onMessage('Percurso salvo somente neste dispositivo.');}
    catch {onMessage('Não foi possível salvar: armazenamento indisponível ou cheio.');}
  }
  function remove(){try{localStorage.removeItem('maceio:saved-route');setSaved(null);}catch{onMessage('Não foi possível apagar o percurso.');}}
  function exportRoute(){
    if(!route)return;
    const content={type:'Feature',properties:{destination:destination?.name,saved_at:new Date().toISOString()},geometry:route.geometry};
    const url=URL.createObjectURL(new Blob([JSON.stringify(content)],{type:'application/geo+json'}));
    const link=document.createElement('a');link.href=url;link.download='rota-hospital.geojson';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <details><summary>Percurso offline e exportação</summary><p className="hint">Ao salvar, o trajeto e o destino ficam neste navegador até você apagá-los. Incluem o ponto de partida. Sem rede, consulte as instruções; mapa, novos cálculos e atualizações precisam de conexão.</p>
    <button disabled={!route||!destination} onClick={save}>Salvar percurso neste dispositivo</button>{' '}<button disabled={!route} onClick={exportRoute}>Exportar GeoJSON</button>
    {saved&&<div className="saved-route"><strong>{saved.destination.name}</strong><p className="hint">Salvo em {new Date(saved.savedAt).toLocaleString('pt-BR')}. Condições podem ter mudado.</p><button onClick={()=>onPreview(saved)}>Consultar percurso salvo</button>{' '}<button onClick={remove}>Apagar percurso</button></div>}
  </details>;
}

export function ReportsPanel({reports,selected,onRefresh,onMessage}:{reports:Report[];selected:Place|null;onRefresh:()=>void;onMessage:(s:string)=>void}) {
  const [description,setDescription]=useState(''),[kind,setKind]=useState('blockage'),[lat,setLat]=useState(''),[lon,setLon]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);
    try {await api('/reports',{method:'POST',body:JSON.stringify({description,kind,location:{lat:Number(lat),lon:Number(lon)},consent})});setDescription('');setConsent(false);onMessage('Ocorrência enviada como não verificada. Uma pessoa administradora fará a avaliação.');onRefresh();}
    catch(e){onMessage((e as Error).message);}finally{setBusy(false);}
  }
  const labels:Record<string,string>={unverified:'Não verificada',verified:'Verificada',resolved:'Resolvida'};
  return <details><summary>Ocorrências no caminho ({reports.length})</summary><p className="hint">Relatos da comunidade não verificados não alteram rotas. Não inclua nomes, informações de pacientes ou outros dados pessoais.</p>
    <form onSubmit={submit}><label htmlFor="report-kind">Tipo</label><select id="report-kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="blockage">Via bloqueada</option><option value="pothole">Buraco ou obstáculo</option><option value="flood">Alagamento</option><option value="other">Outro</option></select>
      <label htmlFor="report-description">O que aconteceu?</label><textarea id="report-description" value={description} onChange={e=>setDescription(e.target.value)} required minLength={5} maxLength={500}/>
      <div className="field-pair"><div><label htmlFor="report-lat">Latitude</label><input id="report-lat" type="number" step="any" min={-90} max={90} required value={lat} onChange={e=>setLat(e.target.value)}/></div><div><label htmlFor="report-lon">Longitude</label><input id="report-lon" type="number" step="any" min={-180} max={180} required value={lon} onChange={e=>setLon(e.target.value)}/></div></div>
      <button type="button" disabled={!selected} onClick={()=>{if(selected){setLat(String(selected.lat));setLon(String(selected.lon));}}}>Usar ponto de destino selecionado</button>
      <label className="check"><input type="checkbox" required checked={consent} onChange={e=>setConsent(e.target.checked)}/> Autorizo publicar este relato e suas coordenadas no mapa por até 24 horas.</label><button disabled={busy}>{busy?'Enviando…':'Enviar ocorrência'}</button>
    </form>
    <div className="report-list">{reports.map(r=><article key={r.id} className="report-card"><span className={'badge '+r.verification}>{labels[r.verification]||r.verification}</span><p>{r.description}</p><small>{new Date(r.created_at).toLocaleString('pt-BR')} · {r.location.lat.toFixed(5)}, {r.location.lon.toFixed(5)}</small></article>)}</div>
  </details>;
}

type Journey={trip_id:string;line:string;headsign:string;boarding:{name:string};alighting:{name:string};departure:string;arrival:string;walking_estimate_minutes:number;total_minutes:number};
export function TransitPanel({origin,destination,available}:{origin:Point|null;destination:Place|null;available:boolean}){
  const [result,setResult]=useState<{journeys:Journey[];source:string;warning?:string}|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function search(){
    setBusy(true);setMessage('');setResult(null);
    try{const reply=await api<{journeys:Journey[];source:string;warning:string}>('/transit/journeys',{method:'POST',body:JSON.stringify({origin,destination})});setResult(reply);if(!reply.journeys.length)setMessage('Nenhuma linha direta encontrada para estas paradas e horário.');}
    catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <details><summary>Transporte público até o hospital</summary>{!available?<p className="hint">Horários oficiais ainda não disponíveis neste sistema.</p>:<><p className="hint">Linhas diretas, com paradas a até 800 m de cada ponto. Horários programados, sem rastreamento dos veículos.</p><button disabled={!origin||!destination||busy} onClick={search}>{busy?'Consultando…':'Consultar próximas viagens'}</button>{result&&<><p className="hint">Fonte: {result.source}. {result.warning}</p>{result.journeys.map((j,i)=><article className="report-card" key={j.trip_id+i}><strong>{j.line}</strong><p>Sentido {j.headsign || 'não informado'}</p><p>{j.boarding.name} → {j.alighting.name}</p><p>{new Date(j.departure).toLocaleString('pt-BR')} → {new Date(j.arrival).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</p><small>{j.total_minutes} min incluindo espera · caminhada aproximada: {j.walking_estimate_minutes} min</small></article>)}</>}</>}<p role="status" className="hint">{message}</p></details>;
}

export function AdminPanel({roads,reports,selected,capabilities,onRefresh,onMessage}:{roads:Road[];reports:Report[];selected:Place|null;capabilities:Capabilities;onRefresh:()=>void;onMessage:(s:string)=>void}) {
  const [key,setKey]=useState(''),[token,setToken]=useState<string|null>(null),[busy,setBusy]=useState(false),[indicators,setIndicators]=useState<Record<string,number|string>|null>(null);
  const [hospitalName,setHospitalName]=useState(''),[address,setAddress]=useState(''),[source,setSource]=useState(''),[lat,setLat]=useState(''),[lon,setLon]=useState(''),[wheelchair,setWheelchair]=useState('unknown'),[verified,setVerified]=useState('');
  const [roadName,setRoadName]=useState('');
  const headers={'Authorization':'Bearer '+(token??key)};
  async function login(e:React.FormEvent){
    e.preventDefault();setBusy(true);
    try {await api('/admin/session',{method:'POST',headers});setToken(key);setKey('');onMessage('Administração habilitada nesta aba.');}
    catch(e){onMessage((e as Error).message);}finally{setBusy(false);}
  }
  async function action(path:string,method:string,body?:unknown){
    setBusy(true);
    try{await api(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});onRefresh();onMessage('Alteração salva.');}
    catch(e){onMessage((e as Error).message);}finally{setBusy(false);}
  }
  async function loadIndicators(){try{setIndicators(await api('/admin/indicators',{headers}));}catch(e){onMessage((e as Error).message);}}
  const indicatorLabels:Record<string,string>={hospitals:'Hospitais cadastrados',hospitals_with_source:'Hospitais com fonte informada',places_with_accessibility_record:'Locais com acessibilidade informada',reports_pending:'Relatos pendentes',reports_verified:'Relatos verificados',reports_resolved:'Relatos resolvidos',road_closures:'Vias com bloqueio ativo'};
  return <details className="admin-panel"><summary>Administração e indicadores</summary>
    {token===null?<form className="admin-login" onSubmit={login}><p className="hint">{capabilities.admin_protected?'Acesso aos cadastros, à validação de relatos e aos indicadores.':'O acesso local está disponível neste computador.'}</p>{capabilities.admin_protected&&<><label htmlFor="admin-key">Chave administrativa</label><input id="admin-key" type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required/></>}<button className="primary" disabled={busy}>{busy?'Verificando…':capabilities.admin_protected?'Entrar na administração':'Acessar administração local'}</button></form>:<>
      <button onClick={()=>{setToken(null);setIndicators(null);onMessage('Sessão administrativa encerrada.');}}>Sair</button>{' '}<button onClick={loadIndicators}>Atualizar indicadores</button>{' '}<button disabled={busy} onClick={()=>action('/admin/catalog/reload','POST')}>Recarregar catálogo importado</button>
      {indicators&&<><dl className="indicators">{Object.entries(indicatorLabels).map(([id,label])=><div key={id}><dt>{label}</dt><dd>{indicators[id]}</dd></div>)}</dl><p className="hint">{indicators.scope}</p></>}
      <h3>Validar relatos</h3>{reports.map(r=><div className="report-card" key={r.id}><p>{r.description}</p><span className="badge">{r.verification}</span><div className="button-row">{r.verification==='unverified'&&<><button disabled={busy} onClick={()=>action('/reports/'+r.id,'PATCH',{verification:'verified'})}>Validar</button><button disabled={busy} onClick={()=>action('/reports/'+r.id,'PATCH',{verification:'rejected'})}>Rejeitar</button></>}{r.verification!=='resolved'&&<button disabled={busy} onClick={()=>action('/reports/'+r.id,'PATCH',{verification:'resolved'})}>Resolver</button>}</div></div>)}
      <h3>Vias cadastradas</h3><p className="hint">{capabilities.closure_routing?'Bloqueios com coordenadas são enviados ao provedor para solicitar desvios.':'O provedor atual não considera estes bloqueios no cálculo.'}</p>
      {roads.map(r=><div className="road" key={r.id}><span>{r.name}<small>{r.status}{r.location?' · com coordenadas':' · sem coordenadas'}</small></span><button disabled={busy} onClick={()=>action('/roads/'+r.id,'PATCH',{status:r.status==='Bloqueada'?'Liberada':'Bloqueada'})}>{r.status==='Bloqueada'?'Liberar':'Bloquear'}</button></div>)}
      <form onSubmit={e=>{e.preventDefault();if(selected)void action('/roads','POST',{name:roadName,location:{lat:selected.lat,lon:selected.lon},status:'Bloqueada',expires_at:new Date(Date.now()+86400000).toISOString()});}}><label htmlFor="road-name">Novo bloqueio no ponto de destino selecionado</label><input id="road-name" value={roadName} onChange={e=>setRoadName(e.target.value)} required minLength={1} maxLength={120}/><button disabled={!selected||busy}>Registrar bloqueio por 24 horas</button></form>
      <h3>Cadastrar hospital</h3><form onSubmit={e=>{e.preventDefault();void action('/places','POST',{name:hospitalName,address,category:'hospital',lat:Number(lat),lon:Number(lon),source,wheelchair,verified_at:verified?new Date(verified).toISOString():null});}}>
        <label htmlFor="hospital-name">Nome</label><input id="hospital-name" value={hospitalName} onChange={e=>setHospitalName(e.target.value)} maxLength={180} required/>
        <label htmlFor="hospital-address">Endereço</label><input id="hospital-address" value={address} onChange={e=>setAddress(e.target.value)} maxLength={300}/>
        <div className="field-pair"><div><label htmlFor="hospital-lat">Latitude</label><input id="hospital-lat" type="number" step="any" min={-90} max={90} value={lat} onChange={e=>setLat(e.target.value)} required/></div><div><label htmlFor="hospital-lon">Longitude</label><input id="hospital-lon" type="number" step="any" min={-180} max={180} value={lon} onChange={e=>setLon(e.target.value)} required/></div></div>
        <button type="button" disabled={!selected} onClick={()=>{if(selected){setLat(String(selected.lat));setLon(String(selected.lon));}}}>Copiar coordenadas do destino</button>
        <label htmlFor="hospital-source">Fonte dos dados</label><input id="hospital-source" value={source} onChange={e=>setSource(e.target.value)} minLength={3} maxLength={500} required placeholder="URL ou referência do cadastro oficial"/>
        <label htmlFor="hospital-wheelchair">Acesso para cadeira de rodas</label><select id="hospital-wheelchair" value={wheelchair} onChange={e=>setWheelchair(e.target.value)}><option value="unknown">Não verificado</option><option value="yes">Acesso informado</option><option value="no">Sem acesso informado</option></select>
        <label htmlFor="hospital-verified">Data da verificação</label><input id="hospital-verified" type="datetime-local" value={verified} onChange={e=>setVerified(e.target.value)} required={wheelchair!=='unknown'}/><button disabled={busy}>Salvar hospital</button>
      </form>
    </>}
  </details>;
}
