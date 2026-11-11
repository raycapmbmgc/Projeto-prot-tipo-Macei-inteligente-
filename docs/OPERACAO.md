# Operação e dados externos

## Inicialização

No Windows, execute `powershell -ExecutionPolicy Bypass -File .\iniciar.ps1 -Instalar`. Isso instala as dependências em `.venv`, compila o frontend e inicia o servidor em http://127.0.0.1:8000. Depois use `.\iniciar.ps1`. Para testes e compilação use `.\iniciar.ps1 -Validar`.

O frontend mantém o **visual original**, com logo centralizada, perfis de veículo, catálogo CNES e catálogo de ônibus. `python app.py` inicia o Flask antigo na porta 5000, que possui somente suas APIs originais e não recebe automaticamente todos os recursos da plataforma.

Copie `.env.example` para `.env` se precisar de serviços opcionais. Variáveis já exportadas têm precedência. Sem configuração, o banco é `instance/platform.sqlite3`, o provedor é Valhalla comunitário e a administração é restrita a conexões locais. O banco `instance/maceio.sqlite3` do Flask não é substituído nem importado automaticamente.

## Hospitais e acessibilidade

O snapshot `data/healthcare-maceio.json` foi importado da API pública do Ministério da Saúde para o município 270430, tipos CNES 5, 7, 15, 20, 21, 62 e 73, com filtro de ativos. Inclui 50 registros (42 hospitais/hospitais-dia e 8 UPAs), com nomes, endereços, coordenadas e fonte. Natureza jurídica iniciada por 1 é classificada como pública; 2, 3, 4 ou 5, como particular/filantrópica. Isso não informa convênio, aceitação de pacientes, leitos ou acesso hospitalar pelo SUS.

O carregamento conserva o código CNES e a data de atualização de cada registro. Dados cadastrais podem estar desatualizados ou ter coordenadas imprecisas: confirme o endereço e a entrada antes de uso operacional. Não foi feita uma auditoria física das 50 unidades. A lista reflete a cobertura e as datas da fonte, não uma certificação de todas as unidades em funcionamento.

Na inicialização, a carga real substitui somente os hospitais demonstrativos de `seed.json` que permaneceram intactos. Outros registros do usuário são preservados. As distâncias da lista são geométricas; o percurso real aparece após calcular. Os indicadores “Aberto”, distâncias e tempos fictícios do protótipo não são apresentados como disponibilidade atual.

Em Configurações → Administração, registre hospitais com nome, coordenadas e fonte consultada. Para informar acesso para cadeira de rodas, inclua a data da verificação. Isso é um registro de proveniência, não uma auditoria automática. Não há integração com vagas, filas, triagem, disponibilidade de equipes ou especialidades em tempo real.

## Administração

Defina `ADMIN_TOKEN` com uma chave longa e aleatória antes de acesso remoto. Entre com ela na área de administração. A chave fica na memória da aba, não em `localStorage`, e é enviada como Bearer somente nas operações administrativas. Não há contas pessoais, recuperação de senha ou perfis de múltiplos administradores.

O painel permite cadastrar hospitais e bloqueios georreferenciados, alternar o estado das vias, validar relatos e consultar indicadores. Os relatos públicos expiram em 24 h para consulta; a base pode conservar registros para manutenção, por isso defina e execute uma política de retenção antes da implantação pública. Não solicite informações de pacientes nos relatos.

## Caminhada, bicicleta e cadeira de rodas

Quando VALHALLA_URL não está definido, usa-se `https://valhalla1.openstreetmap.de`, um servidor comunitário para demonstração. Rotas reais de carro, caminhada e bicicleta foram verificadas em uma consulta controlada com pontos públicos. Isso não substitui o teste físico de navegação. Em produção, configure um provedor dimensionado, com condições de uso e disponibilidade adequadas. VALHALLA_URL explicitamente vazio desativa esse provedor e mantém somente carro por OSRM. GeoJSON e polyline6 são aceitos pelo adapter.

O usuário pode declarar veículo comum, autorizado ou ambulância. Autorizado/ambulância exigem confirmação do perfil. Esses campos identificam o contexto, mas não validam licenças, não concedem prioridade e não ativam opções para ignorar acesso ou sentido de circulação.

Paradas são enviadas em ordem. Bloqueios com coordenadas e relatos validados de bloqueio/alagamento são enviados em `exclude_locations`; os pontos são associados pelo provedor às vias próximas, então revise o trajeto. OSRM não recebe esses desvios. Preferências de cadeira de rodas, iluminação, escadas e ladeiras são parâmetros de custo do Valhalla e não certificam acessibilidade. Preferência por sombra ainda não existe por falta de dados verificados.

Referência do adapter: [API oficial do Valhalla](https://valhalla.github.io/valhalla/api/route/api-reference/).

## Fonte opcional de trânsito

Configure `TRAFFIC_FEED_URL` e `TRAFFIC_FEED_SOURCE` somente com um endpoint autorizado que publique GeoJSON no contrato abaixo. A URL é configuração do servidor, nunca entrada do visitante. O adapter consulta por HTTP, limita a resposta a 2 MB / 2.000 pontos e mantém cache por 30 segundos. Os incidentes só são exibidos entre `observed_at` e `expires_at`.

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [-35.72, -9.66]},
    "properties": {
      "id": "identificador-da-fonte",
      "description": "Descrição do incidente",
      "status": "closed",
      "observed_at": "2026-11-11T09:00:00-03:00",
      "expires_at": "2026-11-11T10:00:00-03:00"
    }
  }]
}
```

O exemplo descreve o formato, não uma ocorrência real. Status: `closed` ou `slow`. Bloqueios podem ser enviados ao Valhalla; lentidão não ajusta tempos de viagem. A instalação não possui um feed oficial contratado ou conectado por padrão.

## Transporte público opcional

A tela Ônibus já possui 87 códigos de linha e 1.317 pontos/terminais de `data/transit-maceio.json`, importados da [planilha publicada pelo Observatório da Cidade](https://observatoriodacidade.maceio.al.gov.br/). Os 146 vínculos linha/terminal da planilha foram agrupados pelos 87 códigos; isso não significa que existam somente 87 linhas operando hoje. A fonte não fornece vigência individual, horários ou geometria completa de cada itinerário.

Pontos próximos ao hospital são consultados com distância em linha reta. Linhas podem ser pesquisadas por código/nome e seus terminais localizados no mapa. Uma linha vinculada a um terminal próximo não é apresentada como passando pelo hospital. O importador aceita geometrias OSM identificadas separadamente, mas a tentativa de carga nesta atualização não obteve geometrias utilizáveis. O sistema não desenha retas entre terminais como se fossem percursos reais.

Para planejamento completo de ônibus, o botão abre uma [URL de direções do Google Maps](https://developers.google.com/maps/documentation/urls/get-started) com `travelmode=transit`, sem chave de API. Origem e destino só são compartilhados ao abrir o link. Isso ocorre fora do aplicativo; as combinações/horários exibidos são responsabilidade desse provedor.

Para atualizar as cargas públicas:

```powershell
.venv\Scripts\python -m backend.catalog
.venv\Scripts\python -m backend.bus_catalog
```

`--skip-osm` permite atualizar somente a base oficial de linhas e pontos. As cargas mantêm proveniência e publicação atômica. Depois reinicie o backend ou use a recarga do catálogo na administração. A página da Prefeitura encaminhou a `transportes.smtt.maceio.al.gov.br`, que estava inacessível; não foi encontrado um GTFS atual e aberto para garantir todos os itinerários e horários dentro do aplicativo.

Importe um arquivo GTFS oficial, obtido com autorização, sem modificar o banco principal:

```powershell
.venv\Scripts\python -m backend.transit "C:\dados\gtfs-oficial.zip" --source "URL ou referência oficial e data"
```

O importador valida referências, horários e calendário e substitui o banco de horários de forma atômica. `GTFS_DB` permite escolher seu caminho. O planejador consulta apenas viagens diretas em horários fixos, paradas a até 800 m de origem/destino e exceções de calendário; considera horários após 24:00 do dia de serviço anterior. Caminhadas são estimadas em linha reta, sem garantir acesso às paradas. Não implementa baldeações, tarifas, veículos em tempo real, horários intermediários ausentes, GTFS Flex ou feeds por frequência. Não há GTFS real distribuído neste repositório.

Referência: [GTFS Schedule oficial](https://gtfs.org/documentation/schedule/reference/).

## IA, offline e implantação

- Assistente: planejamento local disponível sem dependências de IA. `OLLAMA_URL` e `OLLAMA_MODEL` habilitam um modelo opcional, com fallback local. Não inclui GPS automaticamente; não avalia sintomas ou adequação clínica.
- Offline: após a primeira visita online, o service worker guarda a interface e os arquivos de versão. Em Favoritos, salve o percurso explicitamente. A consulta offline não calcula um caminho novo nem baixa tiles OSM.
- PostgreSQL/PostGIS e Redis: utilize `compose.yaml`, configure as URLs e execute `.venv\Scripts\python -m alembic upgrade head` antes de iniciar. SQLite e memória local exigem um único worker. PostgreSQL e Redis não foram validados por integração nesta sessão.
- Produção: configure HTTPS, chave administrativa, provedores com capacidade para a demanda, backups, política de retenção e monitoramento. RNF01 e RNF06 precisam de medições após implantação.
