# Agenda Barbearia

MVP simples de agenda online para barbearias com **Next.js App Router**,
**TypeScript**, **Tailwind CSS 4**, **Supabase Auth**, **Supabase Database** e
deploy na **Vercel**.

Esta versao remove Manus OAuth, Express, tRPC, Drizzle, MySQL/TiDB e variaveis
`VITE_*`/`BUILT_IN_FORGE_*`.

## Funcionalidades

- Login/cadastro com Supabase Auth
- Dashboard administrativo em `/dashboard`
- Agenda por data, status e link de confirmacao via WhatsApp
- CRUD enxuto de servicos
- Horarios de funcionamento por dia da semana
- Cadastro simples de clientes
- Link publico `/agendar/[slug]`
- Bloqueio visual de horarios ocupados
- Cliente agenda sem login e sem criar conta
- Confirmacao por link `wa.me`

## Rodar localmente

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
RESEND_API_KEY=re_your_api_key
NOTIFICATION_EMAIL=owner@example.com
```

Acesse `http://localhost:3000`.

## Banco Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor.
3. Execute o arquivo `supabase/schema.sql`.
4. Em Authentication, habilite login por e-mail/senha.
5. Crie uma conta pelo app e configure o perfil no dashboard.

O schema inclui tabelas:

- `barbershops`
- `services`
- `business_hours`
- `clients`
- `appointments`
- `booked_slots`

Tambem inclui RLS basico:

- Admin autenticado gerencia registros onde `owner_id = auth.uid()`
- Pagina publica pode ler barbearias, servicos ativos, horarios e slots ocupados
- Pagina publica agenda via RPC `create_public_appointment`, que cria cliente e
  agendamento no Supabase

## Deploy na Vercel

1. Envie o projeto para o GitHub.
2. Importe na Vercel.
3. Adicione as variaveis:

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
RESEND_API_KEY
NOTIFICATION_EMAIL
```

4. Rode o deploy.

## Scripts

```bash
npm run dev
npm run lint
npm run build
```

## Estrutura

```text
app/
  agendar/[slug]/page.tsx
  dashboard/page.tsx
  _components/
  lib/
supabase/schema.sql
```

## Observacoes do MVP

O bloqueio de horario usa o indice unico parcial
`(barbershop_id, appointment_date, appointment_time)` para agendamentos nao
cancelados. A UI remove os horarios ja ocupados e a RPC tambem protege contra
duplicidade no momento de salvar.
