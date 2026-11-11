export type Page='inicio'|'mapa'|'rotas'|'hospitais'|'favoritos'|'ocorrencias'|'hash'|'grafo'|'config';

export const pages:{id:Page;icon:string;label:string;title:string;description:string}[]=[
  {id:'inicio',icon:'⌂',label:'Início',title:'Encontre o hospital mais próximo',description:'Escolha um hospital, defina sua origem e compare os trajetos.'},
  {id:'mapa',icon:'▧',label:'Mapa',title:'Mapa de Maceió',description:'Explore os hospitais no mapa e consulte o percurso selecionado.'},
  {id:'rotas',icon:'⌁',label:'Rotas',title:'Rotas até o hospital',description:'Compare alternativas, personalize o caminho e inicie a navegação.'},
  {id:'hospitais',icon:'✚',label:'Hospitais',title:'Hospitais de Maceió',description:'Consulte as unidades cadastradas e escolha um destino.'},
  {id:'favoritos',icon:'☆',label:'Favoritos',title:'Meus locais e percursos',description:'Consulte os locais favoritos e o percurso salvo neste dispositivo.'},
  {id:'ocorrencias',icon:'⚑',label:'Ocorrências',title:'Ocorrências no caminho',description:'Registre obstáculos e consulte relatos da comunidade.'},
  {id:'hash',icon:'▤',label:'Tabela hash',title:'Tabela hash — ruas',description:'Consulta por identificador e situação das vias cadastradas.'},
  {id:'grafo',icon:'◎',label:'Grafo da cidade',title:'Como o roteamento funciona',description:'Uma representação didática das conexões entre origem, paradas e hospital.'},
  {id:'config',icon:'⚙',label:'Configurações',title:'Preferências e administração',description:'Consulte os recursos disponíveis e gerencie os cadastros.'}
];

export function RoadTable({roads}:{roads:{id:string;name:string;status:string;location?:{lat:number;lon:number}|null;expires_at?:string|null}[]}){
  return <section className="card"><h2>Vias cadastradas</h2><p className="graph-note">Bloqueios sem coordenadas não alteram trajetos. Registros demonstrativos não equivalem a informações de trânsito atuais. As alterações ficam na administração.</p><div className="table-wrap"><table><thead><tr><th>Chave</th><th>Via</th><th>Situação</th><th>Georreferência</th><th>Validade</th></tr></thead><tbody>{roads.map(r=><tr key={r.id}><td><code>{r.id}</code></td><td>{r.name}</td><td><span className={'badge '+(r.status==='Bloqueada'?'red':'green')}>{r.status}</span></td><td>{r.location?`${r.location.lat.toFixed(5)}, ${r.location.lon.toFixed(5)}`:'Não informada'}</td><td>{r.expires_at?new Date(r.expires_at).toLocaleString('pt-BR'):'Não informada'}</td></tr>)}</tbody></table></div></section>;
}

export function EducationalGraph({stops}:{stops:number}){
  const count=stops+2;
  const nodes=Array.from({length:count},(_,i)=>({x:55+i*480/(count-1),y:i===0?210:i===count-1?90:i%2?95:205}));
  return <div className="grid map-layout"><section className="card"><h2>Origem → paradas → hospital</h2><div className="graph-wrap"><svg viewBox="0 0 590 300" role="img" aria-label="Grafo didático, sem representar ruas reais"><g stroke="#e4bfc0" strokeWidth="3">{nodes.slice(1).map((p,i)=><line key={i} x1={nodes[i].x} y1={nodes[i].y} x2={p.x} y2={p.y}/>)}</g>{nodes.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r="16" fill={i===count-1?'#d83c50':i===0?'#159a68':'#1687f8'} stroke="white" strokeWidth="3"/><text x={p.x} y={p.y+40} fill="white" fontSize="11" textAnchor="middle">{i===0?'Origem':i===count-1?'Hospital':'Parada '+i}</text></g>)}</svg></div></section><section className="card"><h2>Como interpretar</h2><p className="graph-note">Nós representam pontos de interesse e cruzamentos. Arestas representam conexões; seus pesos podem ser distâncias ou tempos.</p><p className="graph-note">Este desenho é didático. A rota real usa o grafo viário do provedor e aparece nas telas Mapa e Rotas.</p></section></div>;
}
