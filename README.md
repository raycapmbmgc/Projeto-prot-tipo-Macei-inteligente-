# Maceio Inteligente

Plataforma de **rotas para hospitais de Maceió**, com o visual original: menu lateral vermelho, painel, mapa, hospitais e alternativas de trajeto. A logo fornecida está integrada à plataforma e ao protótipo HTML. As funcionalidades da ERS foram conectadas à arquitetura FastAPI + React/TypeScript + MapLibre.

A versão Flask (`app.py`, `index.html`, `instance/maceio.sqlite3`) continua disponível separadamente, com suas APIs originais. O banco antigo não é substituído nem apagado. Para os recursos novos, utilize `run.py` ou `iniciar.ps1`.

Consulte a [matriz dos 20 requisitos da ERS](docs/REQUISITOS.md) e o [guia de operação e configuração](docs/OPERACAO.md). Caminhada, bicicleta, IA e dados externos exigem os serviços descritos nesses documentos; a compilação local não comprova o aceite completo do MVP.

## Executar a plataforma nova

No Windows, instale e compile com `.\iniciar.ps1 -Instalar`. Nas proximas execucoes use `.\iniciar.ps1`. Para executar os testes e recompilar, use `.\iniciar.ps1 -Validar`. O script interrompe a execucao se uma etapa falhar. Se necessario, libere o script somente para o terminal atual: `Set-ExecutionPolicy -Scope Process Bypass`.

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

Copie `.env.example` para `.env` se precisar configurar servicos opcionais. O backend carrega esse arquivo automaticamente; variaveis exportadas no terminal tem prioridade. Os valores vazios mantem SQLite e roteamento de carro, sem exigir Redis, Valhalla ou Ollama. Docker Compose tambem usa .env para interpolacao. Para PostgreSQL, preencha DATABASE_URL e POSTGRES_PASSWORD; para Redis, preencha REDIS_URL.

```powershell
$env:POSTGRES_PASSWORD='defina-uma-senha'
docker compose up -d
$env:DATABASE_URL='postgresql+psycopg://maceio:SENHA_URL_ENCODED@localhost:5432/maceio'
$env:REDIS_URL='redis://localhost:6379/0'
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python run.py
```

`GET /api/places/nearby?lat=-9.65&lon=-35.71&radius=3000&category=hospital` funciona com SQLite e PostGIS, retornando distâncias geométricas ordenadas. PostGIS utiliza o índice espacial. A carga inicial popula pontos hospitalares de demonstração. Redis distribui eventos de vias e relatos entre processos e armazena pesquisas por 24 h. Sem Redis, cache, limite de geocodificação e WebSockets são locais: execute somente um worker.

Nao foi feita importacao automatica das alteracoes do SQLite antigo. O arquivo original permanece disponivel. Dados hospitalares nao representam disponibilidade em tempo real.

## Caminhada, bicicleta e IA

Configure `VALHALLA_URL` para um servidor Valhalla com malha OSM da regiao carregada, suporte GeoJSON e idioma pt-BR. O adapter recebe manobras, distancias e tempos reais do provedor; sem Valhalla, somente carro e habilitado. O repositorio nao inclui os grandes arquivos cartograficos nem um servidor Valhalla provisionado.

Assistente: execute um servidor Ollama com um modelo instalado e exporte `OLLAMA_URL` e `OLLAMA_MODEL`. `POST /api/assistant` recebe `message`, retorna resposta validada por Pydantic e sugestoes de destino/modo. A sugestao preenche a busca, sem iniciar navegacao automaticamente. Sem modelo configurado retorna 503. Nenhuma chave de API fica no frontend. O GPS nao e enviado ao assistente.

## Implementado e limites

- GPS por acao explicita, watchPosition, precisao, marcador, centralizacao, parada e origem manual. Posicoes nao sao persistidas.
- Busca de enderecos explicita (sem autocomplete) via Nominatim com identificacao e limite/cache. Configure GEOCODER_USER_AGENT com contato real; use provedor proprio para maior escala.
- Destino por clique no mapa, alternativas, tempo/distancia calculados, selecao e preferencia por menor tempo ou distancia entre alternativas retornadas.
- Navegacao com progresso pela projecao em segmentos, chegada, voz opcional, pausa, encerramento e recalc quando desvio supera 60m ou 2x precisao, com intervalo minimo de 30s.
- Eventos de vias e relatos por WebSocket, reconexão e persistência. Bloqueios com coordenadas e relatos validados são enviados ao Valhalla para solicitar desvios. O OSRM não considera esses bloqueios; registros sem coordenadas não alteram trajetos.
- PWA com shell e assets locais em cache. Sem download offline de tiles OSM; busca, IA e rotas precisam de rede.
- Favoritos locais, até cinco paradas antes do hospital, consulta de percurso salvo e exportação GeoJSON.
- Relatos comunitários com consentimento e estado não verificado; moderação e indicadores agregados em Configurações → Administração.
- Cadastro de hospitais com fonte e registro datado de acessibilidade. Preferências de iluminação, menos ladeiras/escadas e cadeira de rodas dependem de Valhalla e do mapeamento; não garantem acessibilidade. Sombra permanece indisponível por falta de dados.
- Importação opcional de GTFS para consultas de linhas diretas programadas e adapter de trânsito GeoJSON com fonte e validade. Nenhum feed real acompanha a instalação; lentidão não é incorporada ao cálculo de tempo.
- Bússola por ação explícita em aparelhos compatíveis, com tratamento de ausência ou recusa do sensor. Orientação manual disponível no mapa.
- Celery nao e necessario para os fluxos sincronos atuais; ainda nao ha processamento de grandes importacoes em segundo plano.

Produção requer HTTPS e provedor cartográfico dimensionado. `ADMIN_TOKEN` protege alterações de vias, cadastro de hospitais, moderação e indicadores; a interface possui entrada administrativa por chave mantida somente na memória da aba. Sem token, a administração é restrita a conexões locais. Os eventos não incluem posições de usuários. Nenhum teste de GPS, voz ou bússola em dispositivo físico foi realizado neste ambiente. Os hospitais demonstrativos não indicam vagas, filas ou atendimento atual.

## Testes

```powershell
.venv\Scripts\python -m pytest tests -q
npm.cmd test --prefix frontend
npm.cmd run build --prefix frontend
```

`test_app.py` valida separadamente o Flask legado. Testes novos usam SQLite temporario, sem alterar dados locais. Provedores externos sao simulados nos testes; requerem validacao de integracao no ambiente configurado.

Referencias: https://fastapi.tiangolo.com/advanced/websockets/ ; https://valhalla.github.io/valhalla/api/ ; https://operations.osmfoundation.org/policies/nominatim/ ; https://operations.osmfoundation.org/policies/tiles/
