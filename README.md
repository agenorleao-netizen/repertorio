# 🎸 Repertório

App **local** pra acessar suas cifras (`.txt`) e montar repertórios pra tocar
no **iPad**. Roda no seu notebook, sem depender de internet nem de nuvem — o
iPad acessa pelo Safari na mesma rede Wi‑Fi.

## Recursos

- 📄 Lê suas cifras `.txt` **direto da pasta onde já estão** (inclusive
  subpastas — sem mover nem renomear nada)
- 🔎 Busca por música, artista ou pasta; lista agrupada por subpasta
- 🎚️ **Transpor tom** (+/‑ semitons), com detecção automática dos acordes
- 📜 **Rolagem automática** com velocidade ajustável (tocar sem as mãos)
- 🔠 Ajuste de fonte e **modo escuro** (bom pro palco)
- 🎵 **Repertórios (setlists)**: agrupe e ordene as músicas do show e toque
  em sequência (Anterior / Próxima)
- 📲 Dá pra "Adicionar à Tela de Início" no iPad e abrir em tela cheia

## ✅ Jeito mais fácil (sem instalar nada): `repertorio.html`

Se você não quer mexer com Terminal, use o arquivo **`repertorio.html`**:

1. Baixe o arquivo `repertorio.html` para o seu computador
2. Dê **dois cliques** nele — abre no navegador (use **Chrome** no Mac)
3. Clique em **“📂 Escolher pasta das cifras”** e selecione a pasta onde suas
   cifras `.txt` estão (ex.: `Downloads/40 MIL CIFRAS + DICIONÁRIOS`)
4. Pronto! Monte repertórios, busque, transponha, toque

Não precisa de Node, nem Terminal, nem servidor. As cifras **não saem do seu
computador** — o app só as lê dentro do navegador. Seus repertórios ficam
salvos no próprio navegador.

> Ao escolher a pasta, o navegador pode mostrar um aviso perguntando se você
> quer “enviar/usar” os arquivos. Pode confirmar — é leitura local, nada é
> enviado pra internet.

---

## Versão com servidor (opcional, para usar também no iPad)

O restante abaixo é só se você quiser rodar como servidor local e acessar de
outro aparelho (iPad) na mesma rede. Para uso no próprio computador, o
`repertorio.html` acima já basta.

### 1. Pré-requisito
Ter o **Node.js** instalado no notebook (versão 14 ou mais nova).
Confira com: `node --version`.

### 2. Apontar para a pasta das suas cifras
Você **não precisa mover nem renomear nada**. É só dizer ao app onde suas
cifras já estão. Abra o arquivo **`repertorio.config.json`** e coloque o
caminho da sua pasta no campo `cifrasDir` (use barras `/` mesmo no Windows):

```json
{ "cifrasDir": "/Users/agenor/Documents/Cifras" }
```

O app varre **as subpastas também**, e usa o nome de cada subpasta como
categoria/artista na lista. Se um arquivo tiver o nome no formato
`Artista - Música.txt`, ele separa artista e título automaticamente.

> Alternativas ao arquivo de config: `node server.js "/caminho/das/cifras"`
> ou `CIFRAS_DIR="/caminho/das/cifras" node server.js`.

Se deixar o `cifrasDir` vazio, ele usa a pasta `cifras/` do projeto (onde
tem uma cifra de exemplo pra testar).

### 3. Iniciar o servidor
No terminal, dentro da pasta do projeto:

```bash
node server.js
```

Vai aparecer algo como:

```
  🎸  Repertório rodando!

  No notebook:   http://localhost:8080
  No iPad:       http://192.168.0.15:8080   (mesma rede Wi-Fi)
```

### 4. Abrir
- **No notebook:** acesse `http://localhost:8080`.
- **No iPad:** conecte na **mesma rede Wi‑Fi** do notebook e abra o endereço
  `http://SEU-IP:8080` que apareceu no terminal. No Safari, toque em
  **Compartilhar → Adicionar à Tela de Início** para usar em tela cheia.

> Dica: mantenha o notebook ligado e o servidor rodando enquanto usa no iPad.
> Se o Wi‑Fi tiver "isolamento de clientes" (comum em redes públicas), o iPad
> pode não enxergar o notebook — use sua rede de casa.

## Sem Node? Alternativa rápida

Se você só quer ler as cifras (sem transpor/repertório do jeito completo),
o app precisa do servidor pra listar os arquivos. O `server.js` não usa
nenhuma biblioteca externa — basta ter o Node. É o caminho mais simples.

## Estrutura

```
repertorio/
├── server.js          # servidor local (sem dependências)
├── cifras/            # <- suas cifras .txt entram aqui
├── data/              # repertórios salvos (setlists.json)
└── public/            # o app (HTML/CSS/JS)
```

Os acordes e a transposição são calculados no próprio app. Nada sai do seu
notebook.

---

## Também neste repositório: 🧭 Sistema de Recrutamento

A pasta [`recrutamento/`](recrutamento/) traz um sistema separado, para
processos de *executive search*: banco de profissionais, assignments com
pipeline por etapas, importação de perfil do LinkedIn e relatórios de progresso.
Roda do mesmo jeito: dois cliques em `recrutamento/recrutamento.html`, ou, para
usar em rede e com o link de atualização do candidato:

```bash
node recrutamento/server.js
```

Veja [`recrutamento/README.md`](recrutamento/README.md).
