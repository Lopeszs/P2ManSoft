# FinanSee

Sistema de gerenciamento financeiro pessoal desenvolvido com Node.js, Express e SQLite. A interface permite acompanhar o resumo financeiro, consultar transações e gerenciar metas.

## Requisitos

- Node.js e npm instalados.

## Instalação

Na raiz do projeto, instale as dependências:

```bash
npm install
```

## Executar a aplicação

Inicie o servidor com:

```bash
npm start
```

O servidor inicializa o banco SQLite e fica disponível em:

```text
http://localhost:3000
```

Para encerrar a aplicação, pressione `Ctrl+C` no terminal.

## Executar os testes automatizados

Rode a suíte de testes com Jest:

```bash
npm test
```

Para executar os testes em modo serial, por exemplo para facilitar a leitura da saída:

```bash
npm test -- --runInBand
```

## Executar os testes de mutação

O projeto usa Stryker Mutator para avaliar a capacidade dos testes de detectar alterações no código. Execute:

```bash
npx stryker run
```

O Stryker lê a configuração em `stryker.config.json`. Os relatórios são gerados na pasta `reports/`.

## Estrutura principal

- `server.js`: API, regras de negócio, autenticação e inicialização do banco.
- `script.js`: lógica da interface no navegador.
- `index.html` e `style.css`: estrutura e estilos da interface.
- `server.test.js` e `server.mutation.test.js`: testes relacionados ao servidor.
- `script.test.js`: testes relacionados à interface.
- `stryker.config.json`: configuração da análise de mutação.

## Observações

- O comando `npm start` executa a inicialização do banco e inicia o servidor.
- O banco padrão é criado como `finansee.sqlite` na pasta do projeto. Para usar outro local, configure a variável de ambiente `DATABASE_PATH` antes de iniciar a aplicação.
- O segredo JWT pode ser configurado pela variável de ambiente `JWT_SECRET`; mantenha segredos reais fora do repositório.
