# Operação e dados externos

## Inicialização

No Windows, execute `powershell -ExecutionPolicy Bypass -File .\iniciar.ps1 -Instalar`. Isso instala as dependências em `.venv`, compila o frontend e inicia o servidor em http://127.0.0.1:8000. Depois use `.\iniciar.ps1`. Para testes e compilação use `.\iniciar.ps1 -Validar`.

O frontend mantém o **visual original**, agora com a logo fornecida, dados de trajeto do provedor e funcionalidades da ERS. `python app.py` inicia o Flask antigo na porta 5000, que possui somente suas APIs originais e não recebe automaticamente todos os recursos da plataforma.

Copie `.env.example` para `.env` se precisar de serviços opcionais. Variáveis já exportadas têm precedência. Sem configuração, o banco é `instance/platform.sqlite3`, o modo é carro via OSRM e a administração é restrita a conexões locais. O banco `instance/maceio.sqlite3` do Flask não é substituído nem importado automaticamente.

## Hospitais e acessibilidade

Os hospitais de `seed.json` são demonstrativos. A interface não mostra os tempos, distâncias ou indicadores “Aberto” fictícios que existiam no protótipo como se fossem atuais. As distâncias da lista são geométricas quando a origem é conhecida; o percurso real só aparece após calcular.

Em Configurações → Administração, registre hospitais com nome, coordenadas e fonte consultada. Para informar acesso para cadeira de rodas, inclua a data da verificação. Isso é um registro de proveniência, não uma auditoria automática. Não há integração com vagas, filas, triagem, disponibilidade de equipes ou especialidades em tempo real.

## Administração

Defina `ADMIN_TOKEN` com uma chave longa e aleatória antes de acesso remoto. Entre com ela na área de administração. A chave fica na memória da aba, não em `localStorage`, e é enviada como Bearer somente nas operações administrativas. Não há contas pessoais, recuperação de senha ou perfis de múltiplos administradores.

O painel permite cadastrar hospitais e bloqueios georreferenciados, alternar o estado das vias, validar relatos e consultar indicadores. Os relatos públicos expiram em 24 h para consulta; a base pode conservar registros para manutenção, por isso defina e execute uma política de retenção antes da implantação pública. Não solicite informações de pacientes nos relatos.

## Caminhada, bicicleta e cadeira de rodas

`VALHALLA_URL` deve apontar para um servidor Valhalla com dados OSM de Maceió carregados, GeoJSON e pt-BR. O repositório não inclui o grande conjunto cartográfico. Modos adicionais ficam indisponíveis sem essa configuração.

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

Importe um arquivo GTFS oficial, obtido com autorização, sem modificar o banco principal:

```powershell
.venv\Scripts\python -m backend.transit "C:\dados\gtfs-oficial.zip" --source "URL ou referência oficial e data"
```

O importador valida referências, horários e calendário e substitui o banco de horários de forma atômica. `GTFS_DB` permite escolher seu caminho. O planejador consulta apenas viagens diretas em horários fixos, paradas a até 800 m de origem/destino e exceções de calendário; considera horários após 24:00 do dia de serviço anterior. Caminhadas são estimadas em linha reta, sem garantir acesso às paradas. Não implementa baldeações, tarifas, veículos em tempo real, horários intermediários ausentes, GTFS Flex ou feeds por frequência. Não há GTFS real distribuído neste repositório.

Referência: [GTFS Schedule oficial](https://gtfs.org/documentation/schedule/reference/).

## IA, offline e implantação

- IA: configure `OLLAMA_URL` e `OLLAMA_MODEL` com um modelo instalado. Não inclui GPS automaticamente; não avalia sintomas ou adequação clínica.
- Offline: após a primeira visita online, o service worker guarda a interface e os arquivos de versão. Em Favoritos, salve o percurso explicitamente. A consulta offline não calcula um caminho novo nem baixa tiles OSM.
- PostgreSQL/PostGIS e Redis: utilize `compose.yaml`, configure as URLs e execute `.venv\Scripts\python -m alembic upgrade head` antes de iniciar. SQLite e memória local exigem um único worker. PostgreSQL e Redis não foram validados por integração nesta sessão.
- Produção: configure HTTPS, chave administrativa, provedores com capacidade para a demanda, backups, política de retenção e monitoramento. RNF01 e RNF06 precisam de medições após implantação.
