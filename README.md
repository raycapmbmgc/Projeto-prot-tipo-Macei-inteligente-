# Maceio Inteligente

Evolucao incremental do prototipo. Identidade vermelha preservada. A versao Flask (`app.py`, `index.html`, `instance/maceio.sqlite3`) continua intacta e pode ser executada separadamente. A plataforma nova usa FastAPI e React/TypeScript; nao substitui nem apaga o banco antigo.

## Executar a plataforma nova

Python 3.12+ e Node 20.19+ ou 22.12+. No Windows use npm.cmd se a politica do PowerShell bloquear npm.ps1.

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-platform.txt
npm.cmd install --prefix frontend
npm.cmd run build --prefix frontend
.venv\Scripts\python run.py
```

Abra http://127.0.0.1:8000. Documentacao REST: /docs. Versao original: /legacy. Alternativamente, `python app.py` executa o Flask antigo na porta 5000.

Para desenvolvimento, execute `npm.cmd run dev --prefix frontend` em outro terminal. Vite encaminha API e WebSocket para a porta 8000.

Sem configuracao adicional, FastAPI cria SQLite em `instance/platform.sqlite3`, importa dados demonstrativos de seed.json e usa OSRM para carro. Isso e um modo local de desenvolvimento, nao uma validacao do ambiente PostGIS.

## PostgreSQL/PostGIS e Redis

O arquivo .env.example e uma referencia. Variaveis devem ser exportadas no terminal: o backend nao carrega .env automaticamente. Docker Compose usa .env para interpolacao.

```powershell
$env:POSTGRES_PASSWORD='defina-uma-senha'
docker compose up -d
$env:DATABASE_URL='postgresql+psycopg://maceio:SENHA_URL_ENCODED@localhost:5432/maceio'
$env:REDIS_URL='redis://localhost:6379/0'
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python run.py
```

PostGIS fornece `GET /api/places/nearby?lat=-9.65&lon=-35.71&radius=3000`. A carga inicial popula pontos hospitalares de demonstracao. Redis distribui eventos de vias entre processos e armazena pesquisas por 24h. Sem Redis, cache, limite de geocodificacao e WebSockets sao locais: execute somente um worker.

Nao foi feita importacao automatica das alteracoes do SQLite antigo. O arquivo original permanece disponivel. Dados hospitalares nao representam disponibilidade em tempo real.

## Caminhada, bicicleta e IA

Configure `VALHALLA_URL` para um servidor Valhalla com malha OSM da regiao carregada, suporte GeoJSON e idioma pt-BR. O adapter recebe manobras, distancias e tempos reais do provedor; sem Valhalla, somente carro e habilitado. O repositorio nao inclui os grandes arquivos cartograficos nem um servidor Valhalla provisionado.

Assistente: execute um servidor Ollama com um modelo instalado e exporte `OLLAMA_URL` e `OLLAMA_MODEL`. `POST /api/assistant` recebe `message`, retorna resposta validada por Pydantic e sugestoes de destino/modo. A sugestao preenche a busca, sem iniciar navegacao automaticamente. Sem modelo configurado retorna 503. Nenhuma chave de API fica no frontend. O GPS nao e enviado ao assistente.

## Implementado e limites

- GPS por acao explicita, watchPosition, precisao, marcador, centralizacao, parada e origem manual. Posicoes nao sao persistidas.
- Busca de enderecos explicita (sem autocomplete) via Nominatim com identificacao e limite/cache. Configure GEOCODER_USER_AGENT com contato real; use provedor proprio para maior escala.
- Destino por clique no mapa, alternativas, tempo/distancia calculados, selecao e preferencia por menor tempo ou distancia entre alternativas retornadas.
- Navegacao com progresso pela projecao em segmentos, chegada, voz opcional, pausa, encerramento e recalc quando desvio supera 60m ou 2x precisao, com intervalo minimo de 30s.
- Eventos de bloqueio por WebSocket, reconexao e persistencia. Bloqueios demonstrativos NAO modificam o grafo dos provedores.
- PWA com shell e assets locais em cache. Sem download offline de tiles OSM; busca, IA e rotas precisam de rede.
- Transporte publico, acessibilidade garantida, escadas, iluminacao, sombra, elevacao, transito e roteamento turistico nao estao implementados: faltam datasets verificados. Nenhum indicador e inventado.
- Bussola/orientacao pelo sensor ainda nao implementada. Orientacao manual pelo controle do mapa disponivel.
- Celery nao e necessario para os fluxos sincronos atuais; ainda nao ha processamento de grandes importacoes em segundo plano.

Producao requer HTTPS, provedor cartografico dimensionado e autenticacao administrativa. ADMIN_TOKEN protege alteracoes de vias via Authorization Bearer; a interface publica nao possui painel de login e recebe 401 nesse modo. O modo sem token deve permanecer local. O transporte de eventos nao inclui posicoes de usuarios. Nenhum teste de GPS em dispositivo fisico foi realizado neste ambiente.

## Testes

```powershell
.venv\Scripts\python -m pytest tests -q
npm.cmd test --prefix frontend
npm.cmd run build --prefix frontend
```

`test_app.py` valida separadamente o Flask legado. Testes novos usam SQLite temporario, sem alterar dados locais. Provedores externos sao simulados nos testes; requerem validacao de integracao no ambiente configurado.

Referencias: https://fastapi.tiangolo.com/advanced/websockets/ ; https://valhalla.github.io/valhalla/api/ ; https://operations.osmfoundation.org/policies/nominatim/ ; https://operations.osmfoundation.org/policies/tiles/
