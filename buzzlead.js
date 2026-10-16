// Cliente mínimo da API v2 da BuzzLead.
// Este arquivo é a parte que você leva para o projeto Next (lib/buzzlead.js).
// Roda SOMENTE no servidor: as chaves nunca podem ir para o navegador.

const BASE = (process.env.BUZZLEAD_BASE_URL ?? 'https://app.buzzlead.com.br/api/v2').replace(/\/$/, '');
const MOCK = process.env.MOCK === '1';
export const CAMPAIGN_ID = process.env.BUZZLEAD_CAMPAIGN_ID ?? '1';
// Nome do campo personalizado de CPF, igual ao configurado no formulário da campanha na BuzzLead
export const CPF_FIELD_NAME = process.env.BUZZLEAD_CPF_FIELD_NAME ?? 'CPF para cadastro em pessoa física';

export class BuzzleadError extends Error {
  constructor(status, body) {
    super(`BuzzLead respondeu ${status}`);
    this.status = status;
    this.body = body;
  }
}

// CNPJ sem pontuação e em maiúsculas. Desde jul/2026 o CNPJ pode ser alfanumérico
// (12 posições A-Z/0-9 + 2 dígitos verificadores), então letras são mantidas.
export const normalizeCnpj = (value) => String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// Dígitos verificadores pelo módulo 11; cada caractere vale (código ASCII - 48),
// o que dá o valor numérico para dígitos e cobre o formato alfanumérico.
export function isValidCnpj(cnpj) {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (base) => {
    const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2].slice(13 - base.length);
    const sum = [...base].reduce((acc, ch, i) => acc + (ch.charCodeAt(0) - 48) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = dv(cnpj.slice(0, 12));
  const d2 = dv(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(`${d1}${d2}`);
}

export const normalizeCpf = (value) => String(value ?? '').replace(/\D/g, '');

export function isValidCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base) => {
    const sum = [...base].reduce((acc, d, i) => acc + Number(d) * (base.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = dv(cpf.slice(0, 9));
  return cpf.endsWith(`${d1}${dv(cpf.slice(0, 9) + d1)}`);
}

// Celular brasileiro no formato da API: { ddi, number }, com number = DDD + número.
// Aceita com ou sem DDI 55 e com qualquer máscara; devolve null se não reconhecer.
export function parseCellphone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2);
  return /^\d{10,11}$/.test(digits) ? { ddi: '55', number: digits } : null;
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
  async createAmbassador({ name, email, document, cellphone }) {
    if (db.ambassadors.has(email)) throw new BuzzleadError(409, { message: 'Embaixador já existe' });
    const amb = { _id: `amb_${rand()}`, name, email, document, cellphone };
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
// document = CNPJ do embaixador (campo "document" na raiz do body, só caracteres, sem pontuação)
export const createAmbassador = ({ name, email, document, cellphone }) =>
  MOCK ? mock.createAmbassador({ name, email, document, cellphone })
       : request('POST', '/ambassadors', { body: { name, email, document, cellphone, campaigns: [Number(CAMPAIGN_ID)] } });

export const getReferralLink = (email) =>
  MOCK ? mock.getReferralLink(email)
       : request('GET', `/referrals/${CAMPAIGN_ID}`, { query: { key: 'email', value: email } });

// hashid identifica o embaixador: é isso que "amarra" a indicação a ele.
// lead: { name, email, phone, document (CNPJ, PJ), company (empresa), customFields (CPF, PF) }.
// customFields não aparece no body documentado do POST /referrals, mas a API grava (testado em 16/10/2026).
export const createReferral = ({ hashid, lead, channel = 'cadastroIndicacao' }) =>
  MOCK ? mock.createReferral({ hashid, lead })
       : request('POST', '/referrals', { body: { hashid, lead, channel } });
