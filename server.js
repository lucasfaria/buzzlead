// Servidor da POC. Cada rota /api/* equivale a um Route Handler do Next
// (app/api/.../route.js). A lógica fica em buzzlead.js.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { BuzzleadError, CPF_FIELD_NAME, createAmbassador, getReferralLink, createReferral, normalizeCnpj, isValidCnpj, normalizeCpf, isValidCpf, parseCellphone } from './buzzlead.js';

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
    const { name, email, cnpj, cellphone } = await readBody(req);
    if (!name || !email || !cnpj) return json(res, 400, { error: 'name, email e cnpj são obrigatórios' });
    const document = normalizeCnpj(cnpj);
    if (!isValidCnpj(document)) return json(res, 400, { error: 'CNPJ inválido' });
    const phone = cellphone ? parseCellphone(cellphone) : undefined;
    if (phone === null) return json(res, 400, { error: 'Celular inválido: use DDD + número, com ou sem DDI 55' });

    let created = true;
    try {
      await createAmbassador({ name, email, document, cellphone: phone });
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
    const { hashid, lead: input } = await readBody(req);
    if (!hashid || !input?.name || !input?.email) {
      return json(res, 400, { error: 'hashid, lead.name e lead.email são obrigatórios' });
    }

    // PJ: CNPJ vai em lead.document; PF: CPF vai no campo personalizado da campanha (lead.customFields)
    const lead = { name: input.name, email: input.email, phone: input.phone, company: input.company || undefined };
    if (input.personType === 'PJ') {
      const cnpj = normalizeCnpj(input.cnpj);
      if (!isValidCnpj(cnpj)) return json(res, 400, { error: 'CNPJ do indicado inválido' });
      lead.document = cnpj;
    } else if (input.personType === 'PF') {
      const cpf = normalizeCpf(input.cpf);
      if (!isValidCpf(cpf)) return json(res, 400, { error: 'CPF do indicado inválido' });
      lead.customFields = [{ name: CPF_FIELD_NAME, type: 'number', value: cpf }];
    } else {
      return json(res, 400, { error: 'lead.personType deve ser PJ ou PF' });
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
