import {useMemo,useState} from 'react';
import {distance,type Point} from './navigation';
import {samePlace,type Place} from './data';

type Props={hospitals:Place[]; origin:Point|null; destination:Place|null; favorites:Place[]; onSelect:(p:Place)=>void; onFavorite:(p:Place)=>void; loading:boolean; onReload:()=>void};

export function Hospitals({hospitals,origin,destination,favorites,onSelect,onFavorite,loading,onReload}:Props) {
  const [filter,setFilter]=useState(''),[accessible,setAccessible]=useState(false),[onlyFavorites,setOnlyFavorites]=useState(false),[kind,setKind]=useState('all'),[ownership,setOwnership]=useState('all');
  const list=useMemo(()=>hospitals.filter(h=>h.name.toLocaleLowerCase('pt-BR').includes(filter.toLocaleLowerCase('pt-BR')))
    .filter(h=>!accessible || h.wheelchair==='yes' && !!h.verified_at)
    .filter(h=>!onlyFavorites || favorites.some(p=>samePlace(p,h)))
    .filter(h=>kind==='all'||h.facility_type===kind).filter(h=>ownership==='all'||h.ownership===ownership)
    .map(h=>({...h,distance_m:origin&&h.routable!==false?distance(origin,h):undefined})).sort((a,b)=>(a.distance_m??Infinity)-(b.distance_m??Infinity)),[hospitals,origin,filter,accessible,onlyFavorites,favorites,kind,ownership]);
  return <section className="hospital-section" aria-labelledby="hospital-title">
    <div className="section-heading"><h2 id="hospital-title">Hospitais e UPAs</h2><span className="count">{list.length} / {hospitals.length}</span></div>
    <label htmlFor="hospital-search">Nome do hospital</label>
    <input id="hospital-search" type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Ex.: Hospital Geral do Estado"/>
    <div className="field-pair"><div><label htmlFor="facility-kind">Tipo de unidade</label><select id="facility-kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">Todas</option><option value="hospital">Hospitais e hospitais-dia</option><option value="upa">UPAs</option><option value="urgent_care">Pronto atendimento</option></select></div><div><label htmlFor="ownership">Rede</label><select id="ownership" value={ownership} onChange={e=>setOwnership(e.target.value)}><option value="all">Pública e particular</option><option value="public">Pública</option><option value="private">Particular / filantrópica</option></select></div></div>
    <div className="filter-row"><label><input type="checkbox" checked={onlyFavorites} onChange={e=>setOnlyFavorites(e.target.checked)}/> Favoritos</label><label><input type="checkbox" checked={accessible} onChange={e=>setAccessible(e.target.checked)}/> Acesso informado</label></div>
    <p className="hint">{origin?'Ordenados pela distância em linha reta. O tempo por ruas aparece ao calcular a rota.':'Defina a origem para ordenar por proximidade.'} O cadastro não informa vagas, filas ou atendimento em tempo real.</p>
    {loading?<p role="status">Carregando hospitais…</p>:<div className="hospital-list">{list.map((h,i)=>{
      const saved=favorites.some(p=>samePlace(p,h));
      return <article key={h.id??i} className={'hospital-card '+(destination && samePlace(h,destination)?'selected':'')}>
        <div className="hospital-card-heading"><span className="hospital-symbol" aria-hidden="true">✚</span><h3>{h.name}</h3><button className="star" aria-label={(saved?'Remover dos':'Adicionar aos')+' favoritos: '+h.name} aria-pressed={saved} onClick={()=>onFavorite(h)}>{saved?'★':'☆'}</button></div>
        <p>{h.address || 'Endereço não informado'}</p>
        <div className="facility-tags"><span>{h.unit_type||'Hospital'}</span><span>{h.ownership==='public'?'Rede pública':h.ownership==='private'?'Particular / filantrópico':'Rede não informada'}</span></div>
        {h.distance_m!==undefined && <span className="distance">{(h.distance_m/1000).toFixed(1)} km em linha reta</span>}
        <details className="source-details"><summary>Dados da unidade {h.cnes?'· CNES '+h.cnes:''}</summary><p className="data-note">{h.demo?'Cadastro demonstrativo · confirme os dados':`Fonte: ${h.source || 'Não informada'}`}</p>{h.registry_updated_at&&<p className="data-note">Atualização cadastral: {h.registry_updated_at.split('T')[0].split('-').reverse().join('/')}</p>}{h.phone&&<p className="data-note">Telefone cadastrado: {h.phone}</p>}{h.source_url&&<a href={h.source_url} target="_blank" rel="noreferrer">Consultar fonte</a>}</details>
        <p className="data-note">{h.wheelchair==='yes'&&h.verified_at?`Acesso para cadeira de rodas informado em ${new Date(h.verified_at).toLocaleDateString('pt-BR')}`:h.wheelchair==='no'?'Cadastro informa ausência de acesso para cadeira de rodas':'Acessibilidade não verificada'}</p>
        <button className="primary w-full" disabled={h.routable===false} onClick={()=>onSelect(h)}>{h.routable===false?'Coordenadas não disponíveis':destination && samePlace(h,destination)?'Unidade selecionada':'Traçar rota para esta unidade'} →</button>
      </article>;
    })}</div>}
    {!loading && !list.length && <p className="hint">Nenhum hospital corresponde ao filtro. Dados ausentes de acessibilidade não são tratados como confirmação.</p>}
    <button className="text-button" onClick={onReload} disabled={loading}>Atualizar hospitais</button>
  </section>;
}
