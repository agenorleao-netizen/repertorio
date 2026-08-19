# 🧭 Sistema de Recrutamento (executive search)

Sistema para instrumentalizar processos de recrutamento — na linha do que fazem
**File Finder, Cluen, Invenias e Greenhouse**, mas enxuto, rodando local, sem
mensalidade e sem dependência de nuvem.

Cobre os quatro pontos que a operação pediu:

| Necessidade | Onde está no sistema |
|---|---|
| 1. Puxar o perfil do LinkedIn e preencher automático | **Importar do LinkedIn** (cola o perfil → preenche os campos) + **link de atualização** enviado ao profissional |
| 2. Montar um assignment e gerir as etapas, candidato a candidato | **Assignments** com pipeline arrastável, etapas configuráveis por busca, parecer e histórico por candidato |
| 3. Puxar relatórios de progresso do assignment | **Relatórios → Progresso do assignment** (funil, conversão, tempo por etapa, movimentações) |
| 4. Puxar relatório do candidato | **Relatórios → Relatório do candidato** (perfil, trajetória nos processos, pareceres) |

---

## ✅ Jeito mais fácil (sem instalar nada): `recrutamento.html`

1. Baixe o arquivo **`recrutamento.html`** (é um arquivo só — o sistema inteiro
   está dentro dele)
2. Dê **dois cliques** — abre no navegador (use **Chrome** no Mac)
3. Pronto. Clique em **Backup → Carregar dados de exemplo** para ver funcionando

Não precisa de Node, nem Terminal, nem servidor. Os dados ficam salvos no
próprio navegador, naquele computador. Nesse modo o *link de atualização do
candidato* não funciona (ele depende do servidor para receber a resposta) —
para isso, use a versão com servidor abaixo.

> Exporte de vez em quando em **Backup → Exportar tudo (JSON)**: como os dados
> ficam no navegador, limpar o histórico/cache leva a base junto.

---

## Versão com servidor (recomendada para uso de verdade)

Vale a pena porque os dados ficam num arquivo seu (`dados/base.json`, com backup
diário), o time inteiro acessa pela rede Wi-Fi e o link de atualização do
candidato funciona.

Precisa apenas do **Node.js** (14 ou mais novo). No terminal, dentro da pasta do projeto:

```bash
node recrutamento/server.js
```

Aparece algo assim:

```
  🧭  Sistema de Recrutamento rodando!

  Neste computador:  http://localhost:8090
  Na mesma rede:     http://192.168.0.15:8090
```

Abra o endereço no navegador. Quem estiver na mesma rede Wi-Fi (o time, o
celular) usa o segundo endereço.

Para mudar a porta: `PORT=9000 node recrutamento/server.js`.

**Onde ficam os dados:** em `recrutamento/dados/base.json` — um arquivo JSON
comum, que dá para copiar, versionar ou abrir em qualquer editor. O servidor
guarda uma cópia por dia em `recrutamento/dados/backups/`. Nada sai do seu
computador.

---

## Acesso ao sistema

O sistema pede login. No primeiro start, o servidor cria o administrador e
mostra a senha no terminal (também grava em `dados/PRIMEIRO-ACESSO.txt`):

```
usuário: admin@recrutamento.local
senha:   Admin@2026
```

A troca dessa senha é pedida no primeiro login. Depois, em **Usuários**, o
administrador cria os demais acessos — os consultores da consultoria precisam
estar cadastrados aqui, porque é dessa lista que sai o "consultor responsável"
de cada assignment.

Três papéis:

| Papel | Pode |
|---|---|
| **Administrador** | tudo, inclusive usuários e configurações |
| **Consultor** | assignments, profissionais, clientes e relatórios |
| **Somente leitura** | consultar e imprimir relatórios, sem alterar nada |

As senhas ficam guardadas como hash (scrypt) e a sessão é um cookie HttpOnly
que vale 12 horas; dez tentativas erradas seguidas de um mesmo endereço
travam o login por 15 minutos.

> **Na versão sem servidor** (arquivo único e página online) o login existe e
> separa os papéis, mas a base mora no navegador de quem abre — ali ele é uma
> tranca de porta, não um cofre. Controle de acesso de verdade exige o servidor.
> A própria tela de acesso avisa isso.

---

## O dia a dia

1. **Clientes** — a empresa, **quantos contatos quiser** (nome, cargo, e-mail,
   telefone) e, se fizer sentido, o **pacote típico daquela empresa**, que serve
   de ponto de partida nas buscas dela.
2. **Assignments** — a busca em quatro abas:
   - **Dados**: posição, cliente, **qual contato é o ponto focal**, consultor
     responsável (escolhido entre os usuários do sistema), prazo, status.
   - **Pacote**: fixo mensal e anual, bônus (% do salário, valor ou nº de
     salários) com a regra, benefícios marcados de uma lista padronizada e
     participação de longo prazo. Dá para puxar o pacote padrão do cliente e
     ajustar, ou salvar o desta posição como o novo padrão dele.
   - **Job spec**: missão, entregas esperadas, competências separadas entre
     **obrigatórias e desejáveis** (com anos de experiência), formação (curso,
     onde estudou, nível), idiomas com nível, títulos de cargo a procurar,
     praças, empresas-alvo e off-limits.
   - **Processo**: escolha um processo de seleção configurado (o padrão vem
     pronto) e ajuste as etapas só desta busca, ou salve as etapas ajustadas
     como um novo processo reutilizável. Os processos da consultoria ficam em
     **Configurações**.
3. **Candidatos** — importe do LinkedIn ou cadastre manualmente. O banco é
   reaproveitável: o mesmo profissional pode estar em vários processos.
4. **Pipeline** — dentro do assignment, arraste a ficha entre as etapas.
   Clicando na ficha você registra fit (1–5), parecer, situação
   (ativo, declinou, descartado, stand-by, contratado) e anotações datadas.
   O sistema guarda todo o histórico de movimentação e avisa quem está parado
   há 14 dias ou mais.
5. **Busca no LinkedIn** — dentro do assignment, o sistema monta a *string
   booleana* a partir do job spec (títulos e obrigatórias com `AND`, desejáveis
   como bloco `OR`, off-limits com `NOT`), com botão para copiar ou abrir direto
   na busca de pessoas do LinkedIn.
6. **Relatórios** — imprima em PDF, copie como texto (para colar no e-mail do
   cliente) ou exporte CSV para o Excel.

---

## Sobre puxar o LinkedIn (e o que dá e o que não dá)

Este é o ponto que costuma gerar frustração, então vale ser direto:

**Não existe forma legítima de sincronizar sozinho um perfil do LinkedIn.**
O LinkedIn não oferece API pública de perfis, proíbe raspagem automática nos
termos de uso e bloqueia tecnicamente quem tenta. Sistemas de ATS que "puxam do
LinkedIn" fazem uma destas três coisas:

1. **Extensão de navegador** operada pelo recrutador (o famoso "importar perfil"
   do Invenias/Cluen) — é o recrutador que está vendo o perfil e mandando salvar;
2. **Parceria oficial** — *LinkedIn Recruiter System Connect* / Talent Solutions,
   que exige contrato do LinkedIn Recruiter e certificação do ATS;
3. **Recebimento de currículo** — o candidato exporta ou envia o próprio perfil.

O que este sistema faz, sem depender de contrato nem de extensão — três
caminhos, do mais automático ao mais garantido:

- **Pelo link do perfil:** cole a URL e clique em *Carregar*. Com o servidor
  rodando, ele tenta ler a página pública do perfil. Funciona quando o LinkedIn
  entrega a página; quando ele responde com muro de login ou 403 — o que é o
  comportamento normal para quem não está logado — a tela diz isso e oferece os
  outros dois caminhos.
- **Bookmarklet "Capturar perfil":** arraste o botão da tela de importação para
  a barra de favoritos. Estando no perfil, um clique copia os dados já limpos
  para a área de transferência. É o mesmo princípio da extensão que Invenias e
  Cluen usam, sem instalar nada.
- **Importar do LinkedIn (assistido):** abra o perfil, selecione a página inteira
  (`Ctrl/Cmd + A`), copie e cole na tela de importação. O sistema separa nome,
  headline, localização, URL, experiências, formação, competências e idiomas, e
  mostra tudo para você **revisar antes de gravar**. Funciona igual com o texto
  do PDF que o próprio LinkedIn gera em *Mais → Salvar em PDF*, ou com um
  currículo colado.
- **Link de atualização do profissional:** no perfil do candidato, clique em
  *Link de atualização*. Sai um link (e uma mensagem pronta para WhatsApp) em que
  o próprio profissional revisa os dados, informa pretensão e disponibilidade,
  **dá o consentimento** e, se quiser, pede a exclusão. O que ele enviar entra
  direto no sistema. É o substituto honesto da "sincronização automática": em vez
  de vigiar o perfil dele, você o convida a manter os dados certos — e ganha o
  registro de consentimento junto.
- **Reimportar quando quiser:** *Atualizar pelo LinkedIn* refaz a leitura por cima
  do cadastro existente, preservando notas, pareceres e histórico.

> A leitura do texto colado é heurística: o LinkedIn muda o layout com
> frequência. Por isso a tela de revisão existe — trate o resultado como um
> rascunho adiantado, não como verdade absoluta.

---

## LGPD

Recrutamento é tratamento de dados pessoais, então o sistema registra o mínimo
necessário para você sustentar a operação:

- **Fonte do dado** em cada perfil ("perfil público do LinkedIn", "indicação",
  "atualizado pelo próprio profissional"…).
- **Consentimento**: status, data, base legal (consentimento, legítimo interesse
  ou procedimentos preliminares de contrato) e como foi obtido. A lista de
  candidatos mostra quem ainda está pendente.
- **Portal do titular**: pelo link de atualização o profissional acessa, corrige
  e pode **pedir a exclusão** — que apaga o cadastro e o tira dos pipelines.
- **Eliminação pelo consultor**: botão *Excluir dados* no perfil.
- **Registro de atividades**: quem entrou, quem mudou de etapa, quem foi
  eliminado, com data.

Isso é instrumentação, não parecer jurídico. Se a consultoria for tratar volume
relevante, vale um DPO ou advogado revisar a política de retenção (por quanto
tempo manter perfis não contratados) e o texto de consentimento do portal, que
está em `public/atualizar.html`.

---

## Estrutura

```
recrutamento/
├── recrutamento.html      # o sistema inteiro num arquivo só (dois cliques)
├── recrutamento-online.html # mesma coisa, para publicar como página hospedada
├── gerar-arquivo-unico.js # regera os dois arquivos acima a partir de public/
├── server.js              # servidor local, sem dependências
├── dados/
│   ├── base.json          # toda a base (candidatos, clientes, assignments)
│   └── backups/           # cópia diária automática
└── public/
    ├── index.html         # o sistema
    ├── app.js             # telas, pipeline, importador, relatórios
    ├── atualizar.html     # portal do candidato (link de atualização)
    └── style.css
```

Sem banco de dados, sem `npm install`, sem build. Para levar tudo para outro
computador, copie a pasta — ou use *Backup → Exportar tudo (JSON)*.

Mexeu em algo dentro de `public/`? Rode `node recrutamento/gerar-arquivo-unico.js`
para atualizar o `recrutamento.html` e o `recrutamento-online.html`.

---

## Configurações (administrador)

- **Processos de seleção**: quantos quiser, cada um com suas etapas. Um deles é
  o padrão que aparece pré-selecionado ao abrir uma busca. Mudar um processo não
  mexe nos assignments que já estão rodando.
- **Benefícios**: a lista que vira as caixinhas do pacote, no cliente e no
  assignment — é o que mantém a remuneração padronizada entre as buscas.
- **Moeda** usada nos pacotes.

---

## Próximos passos possíveis

Coisas que fazem sentido quando a operação crescer, em ordem de retorno:

1. **Vários usuários ao mesmo tempo** — a base inteira é gravada de uma vez;
   quando duas pessoas salvam junto, a segunda grava por cima e o sistema avisa.
   Com 3+ consultores trabalhando simultaneamente, vale trocar o arquivo JSON
   por SQLite e gravar por registro.
2. **Sessões que sobrevivem ao restart** — hoje elas moram na memória do
   servidor, então reiniciar pede login de novo.
3. **Envio de e-mail/WhatsApp direto do sistema** (hoje ele gera a mensagem
   pronta para copiar).
4. **Portal do cliente** — o contratante acompanha o funil da própria busca, sem
   você precisar mandar relatório.
5. **Agenda de entrevistas** integrada ao calendário.
