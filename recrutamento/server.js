#!/usr/bin/env node
/**
 * Sistema de Recrutamento (executive search) — servidor local sem dependências.
 *
 * Guarda tudo em dados/base.json (JSON puro, fácil de copiar/versionar) e
 * controla o acesso por usuário e senha, com três papéis:
 *   admin      -> tudo, inclusive criar e gerir usuários
 *   consultor  -> tudo, menos usuários
 *   leitura    -> só consulta e relatórios
 *
 * No primeiro start ele cria o administrador e mostra a senha no terminal.
 *
 *   node server.js            -> http://localhost:8090
 *   PORT=9000 node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

const PORT = Number(process.env.PORT) || 8090;
const RAIZ = __dirname;
const PUBLICO = path.join(RAIZ, 'public');
const PASTA_DADOS = path.join(RAIZ, 'dados');
const ARQ_BASE = path.join(PASTA_DADOS, 'base.json');
const ARQ_PRIMEIRO_ACESSO = path.join(PASTA_DADOS, 'PRIMEIRO-ACESSO.txt');

const ADMIN_EMAIL = 'admin@recrutamento.local';
const ADMIN_SENHA_PADRAO = 'Admin@2026';
const HORAS_SESSAO = 12;
const MAX_TENTATIVAS = 10;          // por IP, dentro da janela
const JANELA_TENTATIVAS = 15 * 60e3;

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

/* ------------------------------- base ------------------------------- */

function baseVazia() {
  return { versao: 1, candidatos: [], clientes: [], assignments: [], atividades: [], usuarios: [] };
}

function lerBase() {
  try {
    return Object.assign(baseVazia(), JSON.parse(fs.readFileSync(ARQ_BASE, 'utf8')));
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

/* ------------------------------ senhas ------------------------------ */

function criarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), sal, 64).toString('hex');
  return { sal, hash };
}

function senhaConfere(senha, usuario) {
  if (!usuario || !usuario.sal || !usuario.hash) return false;
  const tentativa = crypto.scryptSync(String(senha), usuario.sal, 64);
  const guardado = Buffer.from(usuario.hash, 'hex');
  return tentativa.length === guardado.length && crypto.timingSafeEqual(tentativa, guardado);
}

function forcaDaSenha(senha) {
  const s = String(senha || '');
  if (s.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'A senha precisa misturar letras e números.';
  return null;
}

function usuarioPublico(u) {
  return {
    id: u.id, nome: u.nome, email: u.email, papel: u.papel, ativo: u.ativo !== false,
    criadoEm: u.criadoEm, ultimoAcesso: u.ultimoAcesso, precisaTrocarSenha: !!u.precisaTrocarSenha
  };
}

function garantirAdmin() {
  const base = lerBase();
  if ((base.usuarios || []).length) return null;
  const { sal, hash } = criarHash(ADMIN_SENHA_PADRAO);
  base.usuarios = [{
    id: crypto.randomUUID(), nome: 'Administrador', email: ADMIN_EMAIL, papel: 'admin',
    ativo: true, sal, hash, precisaTrocarSenha: true, criadoEm: new Date().toISOString()
  }];
  gravarBase(base);
  try {
    fs.writeFileSync(ARQ_PRIMEIRO_ACESSO,
      `Primeiro acesso ao Sistema de Recrutamento\n\n` +
      `  usuário: ${ADMIN_EMAIL}\n  senha:   ${ADMIN_SENHA_PADRAO}\n\n` +
      `O sistema pede a troca dessa senha no primeiro login. Depois de trocar,\n` +
      `pode apagar este arquivo.\n`, 'utf8');
  } catch (e) { /* opcional */ }
  return { email: ADMIN_EMAIL, senha: ADMIN_SENHA_PADRAO };
}

/* ------------------------------ sessões ------------------------------ */

const sessoes = new Map();   // token -> { usuarioId, expira }
const tentativas = new Map(); // ip -> { contagem, desde }

function novaSessao(usuarioId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessoes.set(token, { usuarioId, expira: Date.now() + HORAS_SESSAO * 3600e3 });
  return token;
}

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || '';
  const achado = bruto.split(';').map((p) => p.trim()).find((p) => p.startsWith(nome + '='));
  return achado ? decodeURIComponent(achado.slice(nome.length + 1)) : null;
}

function usuarioDaRequisicao(req) {
  const token = lerCookie(req, 'sessao');
  if (!token) return null;
  const sessao = sessoes.get(token);
  if (!sessao) return null;
  if (sessao.expira < Date.now()) { sessoes.delete(token); return null; }
  sessao.expira = Date.now() + HORAS_SESSAO * 3600e3;
  const usuario = lerBase().usuarios.find((u) => u.id === sessao.usuarioId);
  if (!usuario || usuario.ativo === false) return null;
  return usuario;
}

function ipDe(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || 'desconhecido';
}

function excedeuTentativas(ip) {
  const reg = tentativas.get(ip);
  if (!reg) return false;
  if (Date.now() - reg.desde > JANELA_TENTATIVAS) { tentativas.delete(ip); return false; }
  return reg.contagem >= MAX_TENTATIVAS;
}

function registrarTentativa(ip, acertou) {
  if (acertou) { tentativas.delete(ip); return; }
  const reg = tentativas.get(ip);
  if (!reg || Date.now() - reg.desde > JANELA_TENTATIVAS) tentativas.set(ip, { contagem: 1, desde: Date.now() });
  else reg.contagem++;
}

/* ------------------------------ http ------------------------------ */

function json(res, status, corpo, cabecalhos) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, cabecalhos || {}));
  res.end(JSON.stringify(corpo));
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

function registrar(base, tipo, texto, extra) {
  base.atividades = base.atividades || [];
  base.atividades.unshift(Object.assign({
    id: crypto.randomUUID(), data: new Date().toISOString(), tipo, texto
  }, extra || {}));
  base.atividades = base.atividades.slice(0, 500);
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
    /* ---------------- portal do candidato (público, por token) ---------------- */
    const mPortalApi = rota.match(/^\/api\/portal\/([A-Za-z0-9_-]{8,})$/);
    if (mPortalApi) return portalCandidato(req, res, mPortalApi[1]);

    /* ---------------- autenticação ---------------- */
    if (rota === '/api/login' && req.method === 'POST') {
      const ip = ipDe(req);
      if (excedeuTentativas(ip)) {
        return json(res, 429, { erro: 'Muitas tentativas. Espere alguns minutos e tente de novo.' });
      }
      const corpo = await lerCorpo(req);
      const base = lerBase();
      const email = String(corpo.email || '').trim().toLowerCase();
      const usuario = base.usuarios.find((u) => (u.email || '').toLowerCase() === email);
      const ok = usuario && usuario.ativo !== false && senhaConfere(corpo.senha, usuario);
      registrarTentativa(ip, ok);
      if (!ok) return json(res, 401, { erro: 'Usuário ou senha não conferem.' });

      usuario.ultimoAcesso = new Date().toISOString();
      gravarBase(base);   // acesso não muda a versão dos dados
      const token = novaSessao(usuario.id);
      return json(res, 200, { usuario: usuarioPublico(usuario) }, {
        'Set-Cookie': `sessao=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${HORAS_SESSAO * 3600}`
      });
    }

    if (rota === '/api/logout' && req.method === 'POST') {
      const token = lerCookie(req, 'sessao');
      if (token) sessoes.delete(token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }

    if (rota === '/api/eu' && req.method === 'GET') {
      const usuario = usuarioDaRequisicao(req);
      if (!usuario) return json(res, 401, { erro: 'sem sessão' });
      return json(res, 200, { usuario: usuarioPublico(usuario) });
    }

    /* ---------------- daqui para baixo, só logado ---------------- */
    const eu = usuarioDaRequisicao(req);
    if (rota.startsWith('/api/')) {
      if (!eu) return json(res, 401, { erro: 'Faça login para continuar.' });
    }

    if (rota === '/api/senha' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const base = lerBase();
      const usuario = base.usuarios.find((u) => u.id === eu.id);
      if (!senhaConfere(corpo.senhaAtual, usuario)) return json(res, 400, { erro: 'A senha atual não confere.' });
      const problema = forcaDaSenha(corpo.novaSenha);
      if (problema) return json(res, 400, { erro: problema });
      Object.assign(usuario, criarHash(corpo.novaSenha), { precisaTrocarSenha: false });
      registrar(base, 'acesso', `${usuario.nome} trocou a própria senha`);
      gravarBase(base);
      return json(res, 200, { ok: true });
    }

    if (rota === '/api/usuarios') {
      if (eu.papel !== 'admin') return json(res, 403, { erro: 'Só o administrador gerencia usuários.' });
      const base = lerBase();

      if (req.method === 'GET') return json(res, 200, { usuarios: base.usuarios.map(usuarioPublico) });

      if (req.method === 'POST') {
        const corpo = await lerCorpo(req);
        const email = String(corpo.email || '').trim().toLowerCase();
        const nome = String(corpo.nome || '').trim();
        if (!nome || !email) return json(res, 400, { erro: 'Informe nome e e-mail.' });
        if (base.usuarios.some((u) => (u.email || '').toLowerCase() === email)) {
          return json(res, 400, { erro: 'Já existe usuário com esse e-mail.' });
        }
        const problema = forcaDaSenha(corpo.senha);
        if (problema) return json(res, 400, { erro: problema });
        const novo = Object.assign({
          id: crypto.randomUUID(), nome, email,
          papel: ['admin', 'consultor', 'leitura'].includes(corpo.papel) ? corpo.papel : 'consultor',
          ativo: true, precisaTrocarSenha: true, criadoEm: new Date().toISOString()
        }, criarHash(corpo.senha));
        base.usuarios.push(novo);
        registrar(base, 'acesso', `${eu.nome} criou o usuário ${nome} (${novo.papel})`);
        gravarBase(base);
        return json(res, 200, { usuario: usuarioPublico(novo) });
      }
    }

    const mUsuario = rota.match(/^\/api\/usuarios\/([\w-]+)$/);
    if (mUsuario) {
      if (eu.papel !== 'admin') return json(res, 403, { erro: 'Só o administrador gerencia usuários.' });
      const base = lerBase();
      const alvo = base.usuarios.find((u) => u.id === mUsuario[1]);
      if (!alvo) return json(res, 404, { erro: 'Usuário não encontrado.' });
      const admins = base.usuarios.filter((u) => u.papel === 'admin' && u.ativo !== false);

      if (req.method === 'PATCH') {
        const corpo = await lerCorpo(req);
        if (corpo.nome != null) alvo.nome = String(corpo.nome).trim() || alvo.nome;
        if (corpo.papel && ['admin', 'consultor', 'leitura'].includes(corpo.papel)) {
          if (alvo.papel === 'admin' && corpo.papel !== 'admin' && admins.length < 2) {
            return json(res, 400, { erro: 'Precisa sobrar pelo menos um administrador.' });
          }
          alvo.papel = corpo.papel;
        }
        if (corpo.ativo != null) {
          if (!corpo.ativo && alvo.papel === 'admin' && admins.length < 2) {
            return json(res, 400, { erro: 'Precisa sobrar pelo menos um administrador ativo.' });
          }
          alvo.ativo = !!corpo.ativo;
          if (!alvo.ativo) {
            for (const [token, s] of sessoes) if (s.usuarioId === alvo.id) sessoes.delete(token);
          }
        }
        if (corpo.novaSenha) {
          const problema = forcaDaSenha(corpo.novaSenha);
          if (problema) return json(res, 400, { erro: problema });
          Object.assign(alvo, criarHash(corpo.novaSenha), { precisaTrocarSenha: true });
          registrar(base, 'acesso', `${eu.nome} redefiniu a senha de ${alvo.nome}`);
        }
        gravarBase(base);
        return json(res, 200, { usuario: usuarioPublico(alvo) });
      }

      if (req.method === 'DELETE') {
        if (alvo.id === eu.id) return json(res, 400, { erro: 'Não dá para excluir o próprio usuário.' });
        if (alvo.papel === 'admin' && admins.length < 2) {
          return json(res, 400, { erro: 'Precisa sobrar pelo menos um administrador.' });
        }
        base.usuarios = base.usuarios.filter((u) => u.id !== alvo.id);
        for (const [token, s] of sessoes) if (s.usuarioId === alvo.id) sessoes.delete(token);
        registrar(base, 'acesso', `${eu.nome} excluiu o usuário ${alvo.nome}`);
        gravarBase(base);
        return json(res, 200, { ok: true });
      }
    }

    if (rota === '/api/linkedin' && req.method === 'POST') {
      if (eu.papel === 'leitura') return json(res, 403, { erro: 'Seu acesso é somente leitura.' });
      const corpo = await lerCorpo(req);
      const resultado = await buscarPaginaLinkedIn(String(corpo.url || ''));
      return json(res, resultado.erro ? 502 : 200, resultado);
    }

    /* ---------------- base ---------------- */
    if (rota === '/api/base' && req.method === 'GET') {
      const base = lerBase();
      base.usuarios = base.usuarios.map(usuarioPublico); // nunca manda hash de senha
      return json(res, 200, base);
    }

    if (rota === '/api/base' && req.method === 'PUT') {
      if (eu.papel === 'leitura') return json(res, 403, { erro: 'Seu acesso é somente leitura.' });
      const corpo = await lerCorpo(req);
      const atual = lerBase();
      // Trava simples de concorrência: quem gravou com versão velha recarrega.
      if (typeof corpo.versao === 'number' && corpo.versao < atual.versao) {
        return json(res, 409, { erro: 'conflito', versaoAtual: atual.versao });
      }
      const nova = Object.assign(baseVazia(), corpo, {
        versao: atual.versao + 1,
        usuarios: atual.usuarios      // usuários só mudam pelos endpoints próprios
      });
      backupDiario(atual);
      gravarBase(nova);
      return json(res, 200, { ok: true, versao: nova.versao });
    }

    /* ---------------- estático ---------------- */
    const mPortal = rota.match(/^\/portal\/([A-Za-z0-9_-]{8,})$/);
    if (mPortal) return servirArquivo(res, path.join(PUBLICO, 'atualizar.html'));

    const arquivo = rota === '/' ? '/index.html' : rota;
    const destino = path.normalize(path.join(PUBLICO, arquivo));
    if (!destino.startsWith(PUBLICO)) { res.writeHead(403); res.end('Proibido'); return; }
    return servirArquivo(res, destino);
  } catch (e) {
    return json(res, 500, { erro: String(e && e.message ? e.message : e) });
  }
});

async function portalCandidato(req, res, token) {
  const base = lerBase();
  const cand = base.candidatos.find((c) => c.tokenPortal === token);
  if (!cand) return json(res, 404, { erro: 'link inválido ou expirado' });

  if (req.method === 'GET') {
    const publico = { id: cand.id, consentimento: cand.consentimento || null };
    CAMPOS_PORTAL.forEach((k) => { publico[k] = cand[k]; });
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
    registrar(base, 'portal', `${cand.nome} atualizou o próprio perfil pelo link`, { candidatoId: cand.id });
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
    registrar(base, 'lgpd', `Dados de ${cand.nome} eliminados a pedido do titular`);
    base.versao = (base.versao || 1) + 1;
    backupDiario(lerBase());
    gravarBase(base);
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { erro: 'método não suportado' });
}


/**
 * Tenta buscar a página pública de um perfil do LinkedIn.
 *
 * Na prática o LinkedIn quase sempre responde com muro de login ou 999 para
 * quem não está autenticado — é assim de propósito. Quando isso acontece,
 * devolvemos o motivo em português para a tela oferecer os caminhos que
 * funcionam (captura pelo bookmarklet ou colar o texto).
 */
function buscarPaginaLinkedIn(alvo) {
  return new Promise((resolve) => {
    let endereco;
    try { endereco = new URL(alvo); } catch (e) { return resolve({ erro: 'Esse link não parece válido.' }); }
    if (!/(^|\.)linkedin\.com$/i.test(endereco.hostname)) {
      return resolve({ erro: 'O link precisa ser de um perfil do LinkedIn.' });
    }

    const req = https.get({
      hostname: endereco.hostname,
      path: endereco.pathname + endereco.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SistemaRecrutamento/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      },
      timeout: 12000
    }, (resposta) => {
      const { statusCode, headers } = resposta;
      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && !/authwall|login/i.test(headers.location)) {
        resposta.resume();
        return resolve(buscarPaginaLinkedIn(new URL(headers.location, endereco).href));
      }
      if (statusCode !== 200) {
        resposta.resume();
        return resolve({ erro: `O LinkedIn respondeu ${statusCode} para quem não está logado.`, status: statusCode });
      }
      let corpo = '';
      resposta.setEncoding('utf8');
      resposta.on('data', (p) => {
        corpo += p;
        if (corpo.length > 4e6) { req.destroy(); }
      });
      resposta.on('end', () => {
        if (/authwall|Entre para ver|Join LinkedIn|sign in to see/i.test(corpo) && corpo.length < 200000) {
          return resolve({ erro: 'O LinkedIn mostrou o muro de login em vez do perfil.' });
        }
        resolve({ texto: htmlParaTexto(corpo) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ erro: 'O LinkedIn demorou demais para responder.' }); });
    req.on('error', (e) => resolve({ erro: 'Não consegui alcançar o LinkedIn: ' + e.message }));
  });
}

function htmlParaTexto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&middot;/g, '·')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

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
  const novoAdmin = garantirAdmin();
  console.log('');
  console.log('  🧭  Sistema de Recrutamento rodando!');
  console.log('');
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  console.log(`  Na mesma rede:     http://${ipLocal()}:${PORT}`);
  console.log('');
  if (novoAdmin) {
    console.log('  ─────────────────────────────────────────────');
    console.log('   PRIMEIRO ACESSO — entre com:');
    console.log(`     usuário: ${novoAdmin.email}`);
    console.log(`     senha:   ${novoAdmin.senha}`);
    console.log('   O sistema pede a troca da senha no primeiro login.');
    console.log('  ─────────────────────────────────────────────');
    console.log('');
  }
  console.log(`  Base de dados:     ${ARQ_BASE}`);
  console.log('  Para parar: Ctrl+C');
  console.log('');
});
