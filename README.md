# 🗓️ ChronoFlow — Plataforma de Agendamento Multi-tenant (Stack TypeScript / Bun)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.x-FBF0DF?logo=bun&logoColor=black)](https://bun.sh/)
[![ElysiaJS](https://img.shields.io/badge/ElysiaJS-End--to--End_Type_Safe-FF6B6B)](https://elysiajs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)

> **Plataforma SaaS B2B/B2C de agendamentos de alta disponibilidade**, projetada com foco em isolamento de dados (*Multi-tenancy*), prevenção rigorosa de condições de corrida (*Race Conditions*), manipulação determinística de fusos horários e processamento assíncrono em alta velocidade sobre o runtime **Bun**.

---

## 📋 Índice

- [1. Visão Geral e Problema Resolvido](#-1-visão-geral-e-problema-resolvido)
- [2. Arquitetura do Sistema](#-2-arquitetura-do-sistema)
- [3. Fluxo Crítico de Reserva (Concorrência e Idempotência)](#-3-fluxo-crítico-de-reserva-concorrência-e-idempotência)
- [4. Modelagem do Banco de Dados (DER)](#-4-modelagem-do-banco-de-dados-der)
- [5. Stack Tecnológica](#-5-stack-tecnológica)
- [6. Architecture Decision Records (ADRs)](#-6-architecture-decision-records-adrs)
- [7. Estrutura do Projeto (Monorepo Bun Workspaces)](#-7-estrutura-do-projeto-monorepo-bun-workspaces)
- [8. Setup Local e Execução](#-8-setup-local-e-execução)
- [9. Testes Automatizados e Engenharia](#-9-testes-automatizados-e-engenharia)

---

## 🎯 1. Visão Geral e Problema Resolvido

Sistemas de agendamento em produção enfrentam desafios críticos que vão muito além de operações CRUD tradicionais:
1. **Double Booking (Concorrência):** Dois clientes tentando reservar o último horário disponível no mesmo milissegundo.
2. **Armadilhas de Fuso Horário & Horário de Verão:** Profissionais e clientes operando em regiões diferentes com regras dinâmicas de DST (*Daylight Saving Time*).
3. **Vazamento de Dados entre Tenants:** Risco de uma clínica/empresa visualizar ou alterar agendas de outra organização.
4. **Resiliência em Notificações e Pagamentos:** Falhas de rede em provedores de e-mail, WhatsApp ou gateways de pagamento (webhooks duplicados).

---

## 🏗️ 2. Arquitetura do Sistema

A aplicação é organizada como um **Monorepo nativo via Bun Workspaces**, compartilhando contratos de tipagem *End-to-End* (via **Eden Treaty**) entre o frontend Next.js, a API ElysiaJS e os Workers assíncronos.

```mermaid
flowchart TB
    subgraph Client ["Camada de Apresentação"]
        Web["Frontend Web<br/>(Next.js 15 + Eden Treaty)"]
    end

    subgraph Edge ["Gateway & Segurança"]
        Nginx["Reverse Proxy / Rate Limiter"]
    end

    subgraph Backend ["Core Backend (Runtime Bun)"]
        API["API REST Type-Safe<br/>(Bun + ElysiaJS)"]
        Worker["Background Worker<br/>(Bun + BullMQ)"]
    end

    subgraph Storage ["Persistência & Mensageria"]
        PG[("PostgreSQL 16<br/>(Drizzle ORM + RLS)")]
        Redis[("Redis 7<br/>(Distributed Lock + Filas)")]
    end

    subgraph External ["Integrações Externas"]
        Stripe["Stripe Webhooks"]
        GCal["Google Calendar API"]
        Mailer["Resend / SMTP"]
    end

    Web -->|HTTPS / JSON| Nginx
    Stripe -->|Webhook Assinado| Nginx
    Nginx --> API

    API -->|Drizzle SQL + FOR UPDATE| PG
    API -->|Redlock + Enfileiramento| Redis
    Redis -->|Consome Jobs| Worker

    Worker -->|Atualiza Status| PG
    Worker -->|Sincroniza Evento| GCal
    Worker -->|Envia Lembretes| Mailer
```

---

## ⚡ 3. Fluxo Crítico de Reserva (Concorrência e Idempotência)

O diagrama abaixo ilustra como a API garante **zero double-booking** mesmo sob rajadas de requisições simultâneas para o mesmo slot:

```mermaid
sequenceDiagram
    autonumber
    actor Cliente
    participant API as ElysiaJS API (Bun)
    participant Redis as Redis (Lock & Idempotency)
    participant PG as PostgreSQL (Transaction)
    participant Queue as BullMQ (Fila)

    Cliente->>API: POST /v1/appointments (Header: Idempotency-Key)
    API->>Redis: Verifica Idempotency-Key
    alt Requisição já processada
        Redis-->>API: Retorna resposta em cache (HTTP 200/201)
        API-->>Cliente: Retorna Agendamento existente
    end

    API->>Redis: Adquire Lock Distribuído (slot:{prof_id}:{start_utc}, TTL 5s)
    alt Lock ocupado por outra requisição
        Redis-->>API: Falha ao adquirir lock
        API-->>Cliente: HTTP 409 Conflict (Horário em processamento)
    end

    API->>PG: BEGIN TRANSACTION
    API->>PG: SELECT ... FROM appointments WHERE prof_id = ? AND range && ? FOR UPDATE
    alt Conflito encontrado no banco
        PG-->>API: Registro conflitante existe
        API->>PG: ROLLBACK
        API->>Redis: Libera Lock
        API-->>Cliente: HTTP 409 Conflict (Horário indisponível)
    else Horário livre
        API->>PG: INSERT INTO appointments (status: 'CONFIRMED', start_utc, end_utc)
        API->>PG: COMMIT
        API->>Queue: Enfileira jobs (Lembrete 24h, Sync Google Calendar)
        API->>Redis: Salva resposta na Idempotency-Key & Libera Lock
        API-->>Cliente: HTTP 201 Created
    end
```

---

## 🗄️ 4. Modelagem do Banco de Dados (DER)

Todos os timestamps são persistidos exclusivamente em **UTC (`TIMESTAMPTZ`)**, enquanto a intenção original de calendário (ex: `America/Sao_Paulo`) é preservada no perfil do tenant/profissional.

```mermaid
erDiagram
    TENANTS ||--o{ USERS : "possui"
    TENANTS ||--o{ SERVICES : "oferece"
    TENANTS ||--o{ APPOINTMENTS : "isola"
    USERS ||--o{ AVAILABILITY_RULES : "define"
    USERS ||--o{ AVAILABILITY_OVERRIDES : "bloqueia"
    USERS ||--o{ APPOINTMENTS : "atende / agenda"
    SERVICES ||--o{ APPOINTMENTS : "compõe"

    TENANTS {
        uuid id PK
        string name
        string slug UK
        string default_timezone
        jsonb settings
        timestamptz created_at
    }

    USERS {
        uuid id PK
        uuid tenant_id FK
        string email
        string password_hash
        enum role "ADMIN | PROFESSIONAL | CLIENT"
        string timezone
        timestamptz created_at
    }

    SERVICES {
        uuid id PK
        uuid tenant_id FK
        string title
        int duration_minutes
        int buffer_minutes
        int price_cents
        boolean active
    }

    AVAILABILITY_RULES {
        uuid id PK
        uuid tenant_id FK
        uuid professional_id FK
        int day_of_week "0-6"
        time start_time
        time end_time
    }

    AVAILABILITY_OVERRIDES {
        uuid id PK
        uuid tenant_id FK
        uuid professional_id FK
        timestamptz start_utc
        timestamptz end_utc
        string reason
    }

    APPOINTMENTS {
        uuid id PK
        uuid tenant_id FK
        uuid professional_id FK
        uuid client_id FK
        uuid service_id FK
        timestamptz start_utc
        timestamptz end_utc
        enum status "PENDING | CONFIRMED | CANCELLED | COMPLETED"
        string idempotency_key UK
        timestamptz created_at
    }
```

---

## 🛠️ 5. Stack Tecnológica

| Camada | Tecnologia | Papel na Arquitetura |
| :--- | :--- | :--- |
| **Runtime & Package Manager** | **Bun 1.x** | Execução nativa de TypeScript sem transpilação prévia, `bun install` ultrarrápido e test runner nativo (`bun test`). |
| **Backend Framework** | **ElysiaJS** | Framework web ergonômico otimizado para Bun, com validação de schema em tempo de execução (TypeBox) e documentação OpenAPI/Swagger automática. |
| **End-to-End Type Safety** | **Eden Treaty** | Cliente RPC type-safe que permite ao frontend consumir rotas do ElysiaJS com autocomplete total sem geração de código. |
| **Banco de Dados & ORM** | **PostgreSQL 16 + Drizzle ORM** | Consultas SQL performáticas e type-safe, suporte nativo a `TSTZRANGE` e `EXCLUDE USING GIST` para integridade temporal. |
| **Filas & Cache** | **Redis 7 + BullMQ** | Processamento assíncrono com *retries* exponenciais, *Dead Letter Queues* (DLQ) e bloqueio distribuído. |
| **Autenticação** | **JWT (Jose) + Bun.password** | Hashing nativo de senhas via Argon2id (`Bun.password.hash`) e tokens de curta duração com Refresh Token rotativo. |
| **Frontend** | **Next.js 15 (App Router) + Tailwind CSS** | Interface responsiva com *Optimistic UI* e renderização híbrida. |
| **Observabilidade** | **Pino + OpenTelemetry** | Logs estruturados em JSON com `correlationId` por requisição e rastreamento distribuído. |

---

## 🧠 6. Architecture Decision Records (ADRs)

### ADR-001: Por que Bun + ElysiaJS em vez de Node.js + Express/NestJS?
* **Contexto:** Precisamos de baixa latência na validação de disponibilidade de slots (cálculo intensivo de intervalos de datas) e segurança estrita de tipos entre backend e frontend.
* **Decisão:** Adotar **Bun** como runtime e **ElysiaJS** como framework HTTP.
* **Consequências:** Redução significativa no tempo de cold-start e overhead de serialização JSON; uso de APIs nativas rápidas (`Bun.password`, `Bun.sql` / driver `postgres.js`) e inferência de tipos automática via Eden Treaty.

### ADR-002: Defesa em Profundidade contra Double-Booking
* **Contexto:** Apenas validar `if (slotIsFree)` na aplicação falha sob alta concorrência.
* **Decisão:** Aplicar três camadas de proteção:
  1. **Redis Distributed Lock:** Rejeita imediatamente requisições concorrentes para o mesmo profissional/horário antes de tocar no banco.
  2. **Pessimistic Locking (`FOR UPDATE`):** Serializa transações concorrentes no PostgreSQL.
  3. **Constraint `EXCLUDE USING GIST`:** Garante no nível do motor do banco de dados que dois agendamentos ativos (`status != 'CANCELLED'`) nunca possuam interseção de intervalo (`tstzrange(start_utc, end_utc)`) para o mesmo `professional_id`.

### ADR-003: Isolamento Multi-tenant via Contexto de Requisição + RLS
* **Contexto:** Dados de múltiplos clientes coexistem no mesmo banco PostgreSQL.
* **Decisão:** Toda requisição autenticada injeta `tenantId` via plugin de escopo do ElysiaJS e configura `SET LOCAL app.current_tenant_id = '...'` na transação do PostgreSQL, ativando políticas de **Row-Level Security (RLS)** como rede de segurança contra esquecimento de cláusulas `WHERE tenant_id = ?`.

---

## 📂 7. Estrutura do Projeto (Monorepo Bun Workspaces)

```text
chronoflow/
├── apps/
│   ├── api/                        # Servidor HTTP ElysiaJS (Bun)
│   │   ├── src/
│   │   │   ├── modules/            # Domínios (auth, tenants, availability, appointments)
│   │   │   ├── shared/             # Plugins Elysia (RLS, AuthGuard, ErrorHandler, Logger)
│   │   │   ├── index.ts            # Entrypoint da API
│   │   │   └── app.ts              # Instância exportada para testes de integração
│   │   └── tests/                  # Testes unitários e de concorrência (bun test)
│   ├── worker/                     # Consumidor BullMQ rodando em Bun
│   │   └── src/
│   │       ├── processors/         # EmailReminder, GoogleCalendarSync, StripeWebhook
│   │       └── index.ts
│   └── web/                        # Frontend Next.js 15
├── packages/
│   ├── db/                         # Drizzle ORM schemas, migrations e seeds
│   └── shared-types/               # Tipos e constantes compartilhadas
├── docker-compose.yml              # PostgreSQL 16, Redis 7, Mailpit e Adminer
├── package.json                    # Configuração de Bun Workspaces
└── bunfig.toml                     # Configurações do runtime e test runner Bun
```

---

## 🚀 8. Setup Local e Execução

### Pré-requisitos
* [Bun](https://bun.sh/) `>= 1.1.0`
* [Docker](https://www.docker.com/) e Docker Compose

### Passo a Passo

```bash
# 1. Clone o repositório
git clone https://github.com/seu-usuario/chronoflow.git
cd chronoflow

# 2. Instale as dependências de todo o monorepo com Bun
bun install

# 3. Configure as variáveis de ambiente
cp .env.example .env

# 4. Suba a infraestrutura (PostgreSQL 16, Redis 7 e Mailpit para captura de e-mails)
docker compose up -d

# 5. Execute as migrations e popule o banco com dados iniciais (tenants, profissionais e serviços)
bun run db:migrate
bun run db:seed

# 6. Inicie a API, o Worker e o Frontend simultaneamente em modo watch
bun run dev
```

* **API Swagger / Scalar Docs:** `http://localhost:3000/swagger`
* **Frontend Web:** `http://localhost:3001`
* **Mailpit (Caixa de entrada local):** `http://localhost:8025`

---

## 🧪 9. Testes Automatizados e Engenharia

O projeto utiliza o test runner nativo do Bun (`bun test`) combinado com **Testcontainers** para validar regras críticas contra instâncias reais de PostgreSQL e Redis:

```bash
# Rodar todos os testes unitários
bun test

# Rodar suite de testes de integração e estresse de concorrência
bun test:integration
```

### Cenários Obrigatórios Cobertos na Suite:
- [x] **Teste de Concorrência (Race Condition):** Disparo paralelo (`Promise.allSettled`) de **50 requisições simultâneas** para o mesmo horário e profissional — garantindo exatamente `1` status `201 Created` e `49` status `409 Conflict`.
- [x] **Teste de Transição de Horário de Verão (DST):** Criação de agendamentos recorrentes na semana de mudança de fuso em `America/New_York` e `Europe/London`.
- [x] **Teste de Vazamento Multi-tenant:** Tentativa de leitura/cancelamento de agendamento do `Tenant A` utilizando token JWT válido do `Tenant B` (deve retornar `404 Not Found`).
- [x] **Teste de Idempotência:** Reenvio de webhook do Stripe com o mesmo `event.id` garantindo que o processamento ocorra apenas uma vez.
