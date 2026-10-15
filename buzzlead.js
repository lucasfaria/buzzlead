// Cliente mínimo da API v2 da BuzzLead.
// Este arquivo é a parte que você leva para o projeto Next (lib/buzzlead.js).
// Roda SOMENTE no servidor: as chaves nunca podem ir para o navegador.

const BASE = (process.env.BUZZLEAD_BASE_URL ?? 'https://app.buzzlead.com.br/api/v2').replace(/\/$/, '');
const MOCK = process.env.MOCK === '1';
export const CAMPAIGN_ID = process.env.BUZZLEAD_CAMPAIGN_ID ?? '1';

export class BuzzleadError extends Error {
  constructor(status, body) {
    super(`BuzzLead respondeu ${status}`);
    this.status = status;
    this.body = body;
  }
}

// ---------- chamada real ----------
async function request(method, path, { query, body } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key-buzzlead': process.env.BUZZLEAD_API_KEY ?? '',
      'x-api-token-buzzlead': process.env.BUZZLEAD_API_TOKEN ?? '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  // Log do formato real das respostas: é o que você quer observar na POC
  console.log(`[buzzlead] ${method} ${url.pathname}${url.search} -> ${res.status}`, JSON.stringify(data).slice(0, 400));

  if (!res.ok) throw new BuzzleadError(res.status, data);
  return data;
}

// ---------- mock em memória ----------
const db = { ambassadors: new Map(), byHash: new Map(), referrals: new Set() };
const rand = () => Math.random().toString(36).slice(2, 6).toUpperCase();

const mock = {
  async createAmbassador({ name, email, cellphone }) {
    if (db.ambassadors.has(email)) throw new BuzzleadError(409, { message: 'Embaixador já existe' });
    const amb = { _id: `amb_${rand()}`, name, email, cellphone };
    amb.hashid = rand();
    db.ambassadors.set(email, amb);
    db.byHash.set(amb.hashid, amb);
    return amb;
  },
  async getReferralLink(email) {
    const amb = db.ambassadors.get(email);
    if (!amb) throw new BuzzleadError(404, { message: 'Embaixador ou campanha não encontrada' });
    return { status: 'success', data: { hashid: amb.hashid, numid: '1', campaign: { _id: CAMPAIGN_ID, name: 'Campanha mock' }, link: `https://indique.buzz/mock/${amb.hashid}` } };
  },
  async createReferral({ hashid, lead }) {
    const amb = db.byHash.get(hashid);
    if (!amb) throw new BuzzleadError(404, { message: 'Embaixador ou campanha não encontrados' });
    const key = `${hashid}|${lead.email}`;
    if (db.referrals.has(key)) throw new BuzzleadError(409, { message: 'Indicação já existente' });
    db.referrals.add(key);
    return { status: 'success', ambassador: amb.email, lead };
  },
};

// ---------- API pública do cliente ----------
export const createAmbassador = ({ name, email, cellphone }) =>
  MOCK ? mock.createAmbassador({ name, email, cellphone })
       : request('POST', '/ambassadors', { body: { name, email, cellphone, campaigns: [Number(CAMPAIGN_ID)] } });

export const getReferralLink = (email) =>
  MOCK ? mock.getReferralLink(email)
       : request('GET', `/referrals/${CAMPAIGN_ID}`, { query: { key: 'email', value: email } });

// hashid identifica o embaixador: é isso que "amarra" a indicação a ele
export const createReferral = ({ hashid, lead, channel = 'cadastroIndicacao' }) =>
  MOCK ? mock.createReferral({ hashid, lead })
       : request('POST', '/referrals', { body: { hashid, lead, channel } });
