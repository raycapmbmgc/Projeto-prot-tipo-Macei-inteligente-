# Maceió Inteligente — rastreabilidade da ERS

Referência: ERS versão 1.0, de 04/11/2026, fornecida pela equipe. O produto prioriza **rotas para hospitais de Maceió** e preserva o menu lateral vermelho, o painel, as telas de mapa, hospitais e rotas e a logo fornecida pela usuária. A arquitetura da plataforma continua FastAPI + React/TypeScript + MapLibre. A versão Flask é mantida separadamente.

| Requisito | Implementação | Condição de operação / validação |
| --- | --- | --- |
| RF01 Mapa interativo | Mapa de Maceió com hospitais, percurso, origem, paradas e ocorrências | WebGL e conexão para os mapas OSM |
| RF02 Permissão de localização | Botão explícito; tratamento de recusa e origem manual | HTTPS ou localhost |
| RF03 Posição atual | Marcador GPS e precisão em metros | Dispositivo com sinal; teste físico pendente |
| RF04 Pesquisa | Filtro de hospitais e busca explícita de endereços | Geocodificador externo, com limite e cache |
| RF05 Cálculo de rotas | Origem, destino hospitalar e até cinco paradas | OSRM para carro; Valhalla para demais modos |
| RF06 Desenho do percurso | Geometria real retornada pelo provedor | Não são desenhadas linhas ilustrativas como rotas reais |
| RF07 Navegação guiada | Iniciar, pausar, encerrar e reconhecer chegada | Exige rota calculada e GPS ativo |
| RF08 Atualizar posição | `watchPosition`, limitado a uma atualização a cada três segundos | Não persiste trilha GPS |
| RF09 Recálculo após desvio | Projeção no trajeto; limiar de 60 m ou 2× precisão; intervalo mínimo de 30 s | Precisa de rede; conserva as paradas ainda não atingidas |
| RF10 Modos | Carro, a pé, bicicleta e preferências para cadeira de rodas | A pé, bicicleta e cadeira de rodas dependem de Valhalla |
| RF11 Tempo e distância | Valores do provedor e comparação de alternativas | Tempos estimados, sem lentidão em tempo real |
| RF12 Favoritos | Adicionar e remover hospitais/locais no navegador | Até 50; não exige conta e não sincroniza entre aparelhos |
| RF13 Ocorrências | Envio com coordenadas e consentimento; não verificada até moderação | Publicação por até 24 h; só relatos validados de bloqueio/alagamento são enviados ao Valhalla |
| RF14 Acessibilidade | Cadastro com fonte e data; filtro por acesso informado | Não garante acessibilidade do percurso ou condições atuais do local |
| RF15 Rotas personalizadas | Tempo/distância, preferências por iluminação, menos escadas e ladeiras | Preferências dependem do mapeamento; não há recomendação clínica de hospital |
| RF16 Indicadores | Administração: hospitais, fontes, registros de acessibilidade, relatos e bloqueios | Somente registros agregados deste sistema; autenticação necessária fora de localhost |
| RF17 Múltiplas paradas | Até cinco pontos antes do hospital; reordenar e remover | O provedor define o caminho; não há otimização automática da ordem |
| RF18 Voz | Instruções em pt-BR; opção de ativação e interrupção ao pausar/encerrar | API de voz do navegador; depende das vozes disponíveis |
| RF19 Offline limitado | PWA, interface em cache e percurso salvo por ação explícita | Sem download de mapas, novos trajetos ou atualização de ocorrências offline |
| RF20 Assistente | Interpretação da pesquisa e modo; não inicia navegação | Ollama e modelo configurados; sem GPS automático ou triagem médica |

## Regras de negócio

- RN01: o GPS só é solicitado por ação explícita; origem manual disponível.
- RN02: o controle de navegação exige uma rota válida.
- RN03: desvios podem acionar recálculo, respeitando precisão e intervalo.
- RN04: o GPS não é incluído no assistente nem em eventos WebSocket. Origem, destino e paradas são enviados ao provedor para calcular rotas. Percursos só são persistidos no navegador mediante a ação de salvar. Relatos publicam coordenadas apenas com consentimento explícito.
- RN05: o servidor atribui `unverified` aos relatos comunitários, independentemente do conteúdo enviado. Só administração pode validar, rejeitar ou resolver.
- RN06: perda de conexão, falhas de GPS e indisponibilidade dos serviços são comunicadas. Percurso salvo é apresentado como histórico, sem iniciar navegação como se estivesse atualizado.

## Requisitos não funcionais e aceite

Os testes automatizados verificam persistência isolada, permissões, validação geográfica, acessibilidade, consentimento, moderação, encaminhamento das paradas e preferências, tratamento de falhas e geometria de navegação. Eles simulam serviços externos.

RNF01 (p95 ≤ 2 s) e RNF06 (99% mensal) são **metas**, não resultados comprovados. Devem ser medidos no ambiente implantado. HTTPS depende do proxy/hosting; conformidade LGPD exige definir controlador, política de privacidade, retenção e operação. Responsividade foi implementada; compatibilidade entre navegadores, GPS, voz, bússola e o fluxo de caminhada precisam de aceite em dispositivos reais.

O aceite completo do MVP exige um Valhalla operacional com dados da região, teste real de caminhada e recálculo após desvio. Não basta compilar o frontend para declarar esse aceite concluído.
