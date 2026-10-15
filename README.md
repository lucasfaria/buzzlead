# POC BuzzLead

Projeto isolado para testar o fluxo de embaixadores e indicações da API v2 da BuzzLead.
Sem dependências: precisa só de Node 20.6+.

## Rodar sem credenciais (mock em memória)
    npm run mock
    # http://localhost:4000

## Rodar contra a API real
    cp .env.example .env     # preencha BUZZLEAD_API_KEY, BUZZLEAD_API_TOKEN e BUZZLEAD_CAMPAIGN_ID
    npm start

No modo real, cada chamada à BuzzLead é logada no terminal (método, path, status e corpo),
para você ver o formato real das respostas.

## Estrutura
- `buzzlead.js`  cliente da API (vai para o Next como lib/buzzlead.js)
- `server.js`    rotas /api/ambassadors e /api/referrals (viram Route Handlers)
- `public/index.html`  duas telas: cadastro e indicação

## Fluxo
1. POST /api/ambassadors  → POST /ambassadors + GET /referrals/{campanha} → devolve hashid e link
2. POST /api/referrals    → POST /referrals com hashid (identifica o embaixador) + dados do lead
