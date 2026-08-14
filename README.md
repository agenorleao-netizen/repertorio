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

## Como usar

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
