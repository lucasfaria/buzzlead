// Servidor da POC. Cada rota /api/* equivale a um Route Handler do Next
// (app/api/.../route.js). A lógica fica em buzzlead.js.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { BuzzleadError, createAmbassador, getReferralLink, createReferral } from './buzzlead.js';

const PORT = process.env.PORT ?? 4000;

const json = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const readBody = async (req) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

const handlers = {
  // 1) cadastra embaixador e já devolve o link de indicação
  'POST /api/ambassadors': async (req, res) => {
    const { name, email, cellphone } = await readBody(req);
    if (!name || !email) return json(res, 400, { error: 'name e email são obrigatórios' });

    let created = true;
    try {
      await createAmbassador({ name, email, cellphone });
    } catch (err) {
      // 409 = já cadastrado: não é erro para o usuário, só busca o link existente
      if (err instanceof BuzzleadError && err.status === 409) created = false;
      else throw err;
    }
    const { data } = await getReferralLink(email);
    json(res, created ? 201 : 200, { created, hashid: data.hashid, link: data.link });
  },

  // 2) registra uma indicação atribuída ao embaixador (via hashid)
  'POST /api/referrals': async (req, res) => {
    const { hashid, lead } = await readBody(req);
    if (!hashid || !lead?.name || !lead?.email) {
      return json(res, 400, { error: 'hashid, lead.name e lead.email são obrigatórios' });
    }
    await createReferral({ hashid, lead });
    json(res, 201, { ok: true });
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/') {
      const html = await readFile(new URL('./public/index.html', import.meta.url));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    const handler = handlers[`${req.method} ${pathname}`];
    if (!handler) return json(res, 404, { error: 'rota não encontrada' });
    await handler(req, res);
  } catch (err) {
    if (err instanceof BuzzleadError) {
      const message = err.status === 409 ? 'Essa indicação já existe.' : err.body?.message ?? 'Erro na BuzzLead';
      return json(res, err.status, { error: message, upstream: err.body });
    }
    console.error(err);
    json(res, 500, { error: 'erro interno' });
  }
});

server.listen(PORT, () => {
  console.log(`POC no ar: http://localhost:${PORT}  (${process.env.MOCK === '1' ? 'MOCK' : 'API real'})`);
});
