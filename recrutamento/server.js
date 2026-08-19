#!/usr/bin/env node
/**
 * Sistema de Recrutamento (executive search) — servidor local sem dependências.
 *
 * Guarda tudo em dados/base.json (JSON puro, fácil de copiar/versionar).
 * Sobe um site estático em public/ e uma API mínima.
 *
 *   node server.js            -> http://localhost:8090
 *   PORT=9000 node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8090;
const RAIZ = __dirname;
const PUBLICO = path.join(RAIZ, 'public');
const PASTA_DADOS = path.join(RAIZ, 'dados');
const ARQ_BASE = path.join(PASTA_DADOS, 'base.json');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function baseVazia() {
  return { versao: 1, candidatos: [], clientes: [], assignments: [], atividades: [] };
}

function lerBase() {
  try {
    const bruto = fs.readFileSync(ARQ_BASE, 'utf8');
    const dados = JSON.parse(bruto);
    return Object.assign(baseVazia(), dados);
  } catch (e) {
    return baseVazia();
  }
}

function gravarBase(base) {
  fs.mkdirSync(PASTA_DADOS, { recursive: true });
  const tmp = ARQ_BASE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(base, null, 2), 'utf8');
  fs.renameSync(tmp, ARQ_BASE);
}

function backupDiario(base) {
  try {
    const dia = new Date().toISOString().slice(0, 10);
    const pasta = path.join(PASTA_DADOS, 'backups');
    fs.mkdirSync(pasta, { recursive: true });
    const alvo = path.join(pasta, `base-${dia}.json`);
    if (!fs.existsSync(alvo)) fs.writeFileSync(alvo, JSON.stringify(base, null, 2), 'utf8');
  } catch (e) { /* backup é best-effort */ }
}

function json(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(texto);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    let tamanho = 0;
    req.on('data', (p) => {
      tamanho += p.length;
      if (tamanho > 20 * 1024 * 1024) { reject(new Error('corpo grande demais')); req.destroy(); return; }
      dados += p;
    });
    req.on('end', () => {
      try { resolve(dados ? JSON.parse(dados) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function servirArquivo(res, arquivo) {
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Não encontrado'); return; }
    const tipo = TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-cache' });
    res.end(conteudo);
  });
}

/** Campos que o próprio profissional pode editar pelo link de atualização. */
const CAMPOS_PORTAL = [
  'nome', 'headline', 'empresaAtual', 'cargoAtual', 'localizacao', 'email',
  'telefone', 'linkedinUrl', 'resumo', 'experiencias', 'formacao',
  'competencias', 'idiomas', 'remuneracao', 'disponibilidade', 'interesses'
];

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rota = decodeURIComponent(url.pathname);

  try {
    // ---------- API ----------
    if (rota === '/api/base' && req.method === 'GET') {
      return json(res, 200, lerBase());
    }

    if (rota === '/api/base' && req.method === 'PUT') {
      const corpo = await lerCorpo(req);
      const atual = lerBase();
      // Trava simples de concorrência: quem gravou com versão velha recarrega.
      if (typeof corpo.versao === 'number' && corpo.versao < atual.versao) {
        return json(res, 409, { erro: 'conflito', versaoAtual: atual.versao });
      }
      const nova = Object.assign(baseVazia(), corpo, { versao: atual.versao + 1 });
      backupDiario(atual);
      gravarBase(nova);
      return json(res, 200, { ok: true, versao: nova.versao });
    }

    // Portal do candidato (LGPD: o próprio titular revisa e atualiza os dados)
    const mPortalApi = rota.match(/^\/api\/portal\/([A-Za-z0-9_-]{8,})$/);
    if (mPortalApi) {
      const token = mPortalApi[1];
      const base = lerBase();
      const cand = base.candidatos.find((c) => c.tokenPortal === token);
      if (!cand) return json(res, 404, { erro: 'link inválido ou expirado' });

      if (req.method === 'GET') {
        const publico = {};
        CAMPOS_PORTAL.forEach((k) => { publico[k] = cand[k]; });
        publico.id = cand.id;
        publico.consentimento = cand.consentimento || null;
        return json(res, 200, publico);
      }

      if (req.method === 'PUT') {
        const corpo = await lerCorpo(req);
        CAMPOS_PORTAL.forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(corpo, k)) cand[k] = corpo[k];
        });
        cand.consentimento = {
          status: corpo.consente ? 'concedido' : 'negado',
          data: new Date().toISOString(),
          base: 'consentimento do titular (art. 7º, I — LGPD)',
          origem: 'portal de atualização',
          observacao: corpo.observacaoConsentimento || ''
        };
        cand.atualizadoEm = new Date().toISOString();
        cand.fonte = 'atualizado pelo próprio profissional';
        base.atividades = base.atividades || [];
        base.atividades.unshift({
          id: crypto.randomUUID(),
          data: new Date().toISOString(),
          tipo: 'portal',
          texto: `${cand.nome} atualizou o próprio perfil pelo link`,
          candidatoId: cand.id
        });
        base.atividades = base.atividades.slice(0, 500);
        base.versao = (base.versao || 1) + 1;
        gravarBase(base);
        return json(res, 200, { ok: true });
      }

      if (req.method === 'DELETE') {
        // Direito de eliminação (art. 18, VI da LGPD)
        base.candidatos = base.candidatos.filter((c) => c.id !== cand.id);
        base.assignments.forEach((a) => {
          a.candidatos = (a.candidatos || []).filter((v) => v.candidatoId !== cand.id);
        });
        base.atividades = base.atividades || [];
        base.atividades.unshift({
          id: crypto.randomUUID(),
          data: new Date().toISOString(),
          tipo: 'lgpd',
          texto: `Dados de ${cand.nome} eliminados a pedido do titular`
        });
        base.versao = (base.versao || 1) + 1;
        backupDiario(lerBase());
        gravarBase(base);
        return json(res, 200, { ok: true });
      }
    }

    // ---------- Estático ----------
    const mPortal = rota.match(/^\/portal\/([A-Za-z0-9_-]{8,})$/);
    if (mPortal) return servirArquivo(res, path.join(PUBLICO, 'atualizar.html'));

    let arquivo = rota === '/' ? '/index.html' : rota;
    const destino = path.normalize(path.join(PUBLICO, arquivo));
    if (!destino.startsWith(PUBLICO)) { res.writeHead(403); res.end('Proibido'); return; }
    return servirArquivo(res, destino);
  } catch (e) {
    return json(res, 500, { erro: String(e && e.message ? e.message : e) });
  }
});

function ipLocal() {
  const redes = os.networkInterfaces();
  for (const nome of Object.keys(redes)) {
    for (const rede of redes[nome] || []) {
      if (rede.family === 'IPv4' && !rede.internal) return rede.address;
    }
  }
  return 'localhost';
}

servidor.listen(PORT, () => {
  if (!fs.existsSync(ARQ_BASE)) gravarBase(baseVazia());
  console.log('');
  console.log('  🧭  Sistema de Recrutamento rodando!');
  console.log('');
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  console.log(`  Na mesma rede:     http://${ipLocal()}:${PORT}`);
  console.log('');
  console.log(`  Base de dados:     ${ARQ_BASE}`);
  console.log('  Para parar: Ctrl+C');
  console.log('');
});
