import {useMemo,useState} from 'react';
import {distance,type Point} from './navigation';
import {samePlace,type Place} from './data';

type Props={hospitals:Place[]; origin:Point|null; destination:Place|null; favorites:Place[]; onSelect:(p:Place)=>void; onFavorite:(p:Place)=>void; loading:boolean; onReload:()=>void};

export function Hospitals({hospitals,origin,destination,favorites,onSelect,onFavorite,loading,onReload}:Props) {
  const [filter,setFilter]=useState(''),[accessible,setAccessible]=useState(false),[onlyFavorites,setOnlyFavorites]=useState(false);
  const list=useMemo(()=>hospitals.filter(h=>h.name.toLocaleLowerCase('pt-BR').includes(filter.toLocaleLowerCase('pt-BR')))
    .filter(h=>!accessible || h.wheelchair==='yes' && !!h.verified_at)
    .filter(h=>!onlyFavorites || favorites.some(p=>samePlace(p,h)))
    .map(h=>({...h,distance_m:origin?distance(origin,h):undefined})).sort((a,b)=>(a.distance_m??0)-(b.distance_m??0)),[hospitals,origin,filter,accessible,onlyFavorites,favorites]);
  return <section className="hospital-section" aria-labelledby="hospital-title">
    <div className="section-heading"><h2 id="hospital-title">Encontre um hospital</h2><span className="count">{hospitals.length}</span></div>
    <label htmlFor="hospital-search">Nome do hospital</label>
    <input id="hospital-search" type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Ex.: Hospital Geral do Estado"/>
    <div className="filter-row"><label><input type="checkbox" checked={onlyFavorites} onChange={e=>setOnlyFavorites(e.target.checked)}/> Favoritos</label><label><input type="checkbox" checked={accessible} onChange={e=>setAccessible(e.target.checked)}/> Acesso informado</label></div>
    <p className="hint">{origin?'Ordenados pela distância em linha reta. O tempo por ruas aparece ao calcular a rota.':'Defina a origem para ordenar por proximidade.'} O cadastro não informa vagas, filas ou atendimento em tempo real.</p>
    {loading?<p role="status">Carregando hospitais…</p>:<div className="hospital-list">{list.map((h,i)=>{
      const saved=favorites.some(p=>samePlace(p,h));
      return <article key={h.id??i} className={'hospital-card '+(destination && samePlace(h,destination)?'selected':'')}>
        <div className="hospital-card-heading"><span className="hospital-symbol" aria-hidden="true">✚</span><h3>{h.name}</h3><button className="star" aria-label={(saved?'Remover dos':'Adicionar aos')+' favoritos: '+h.name} aria-pressed={saved} onClick={()=>onFavorite(h)}>{saved?'★':'☆'}</button></div>
        <p>{h.address || 'Endereço não informado'}</p>
        {h.distance_m!==undefined && <span className="distance">{(h.distance_m/1000).toFixed(1)} km em linha reta</span>}
        <p className="data-note">{h.demo?'Cadastro demonstrativo · confirme os dados':`Fonte: ${h.source || 'Não informada'}`}</p>
        <p className="data-note">{h.wheelchair==='yes'&&h.verified_at?`Acesso para cadeira de rodas informado em ${new Date(h.verified_at).toLocaleDateString('pt-BR')}`:h.wheelchair==='no'?'Cadastro informa ausência de acesso para cadeira de rodas':'Acessibilidade não verificada'}</p>
        <button className="primary w-full" onClick={()=>onSelect(h)}>{destination && samePlace(h,destination)?'Hospital selecionado':'Traçar rota para este hospital'} →</button>
      </article>;
    })}</div>}
    {!loading && !list.length && <p className="hint">Nenhum hospital corresponde ao filtro. Dados ausentes de acessibilidade não são tratados como confirmação.</p>}
    <button className="text-button" onClick={onReload} disabled={loading}>Atualizar hospitais</button>
  </section>;
}
