# BET300 PWA + Web Push — Setup

## 1. Supabase: tabla push_subscriptions

Ejecutar en el SQL Editor de Supabase:

```sql
create table if not exists push_subscriptions (
  id           bigserial primary key,
  usuario      text not null,
  pc_codigo    text not null default 'P1',
  subscription jsonb not null,
  endpoint     text not null unique,
  activa       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Índice para buscar por usuario
create index if not exists idx_push_sub_usuario on push_subscriptions(usuario);
create index if not exists idx_push_sub_activa  on push_subscriptions(activa);

-- RLS: solo service_role puede leer/borrar; inserts y updates son públicos
alter table push_subscriptions enable row level security;

create policy "insert_any" on push_subscriptions
  for insert with check (true);

create policy "update_own_endpoint" on push_subscriptions
  for update using (true);

create policy "service_role_all" on push_subscriptions
  for all using (auth.role() = 'service_role');
```

## 2. Vercel: variables de entorno

En vercel.com → proyecto → Settings → Environment Variables, agregar:

| Variable                  | Valor                                                                 |
|--------------------------|-----------------------------------------------------------------------|
| VAPID_PUBLIC_KEY         | BDoEjtGj3HtlGxnDXMbDgCQzbKj8_Yx9qyRfNDdfoxSQQOdmDKIAe0prTxn4E-QqyK_yqf0cECfUG0kfnWQ16XY |
| VAPID_PRIVATE_KEY        | FR2qtQ0-cy6KC9Ev4bNdx5KYZ3aa0cD7X93QAbjtXD8  ← ¡NO compartir!     |
| VAPID_EMAIL              | mailto:admin@bet300.pw                                                |
| SUPABASE_URL             | https://pjvvyvfcwjoocjqvdror.supabase.co                             |
| SUPABASE_SERVICE_ROLE_KEY | (la service_role key de Supabase Settings → API)                    |
| PUSH_SECRET              | (una contraseña larga aleatoria, ej: openssl rand -hex 32)           |

## 3. Archivos a pushear al repo de Vercel

```
sw.js
manifest.json
vercel.json
icons/icon-192.png
icons/icon-512.png
icons/badge-72.png
api/send-push.js
api/save-subscription.js
api/package.json
portal.html  (ya modificado)
```

## 4. Supabase DB Webhook (push automático cuando aprueban carga)

En Supabase → Database → Webhooks → Create new webhook:

- Nombre: `push_carga_aprobada`
- Table: `solicitudes` (o la tabla donde se guarda el estado)
- Events: UPDATE
- URL: `https://TU-PROYECTO.vercel.app/api/send-push`
- Headers: `{ "x-push-secret": "EL_VALOR_DE_PUSH_SECRET" }`
- HTTP Body filter: solo cuando `estado` cambie a `ACREDITADA` o `PAGADA`

Payload que enviará el webhook (configurar en Supabase):
```json
{
  "usuario": "{{record.usuario}}",
  "title": "BET300 · ¡Carga acreditada!",
  "body": "¡Tus fichas ya están disponibles! Revisá tu saldo.",
  "url": "/",
  "tag": "bet300-acreditada"
}
```

## 5. Envío manual desde NODO panel (opcional, futuro)

```javascript
// Desde el panel, enviar push a un usuario específico:
fetch("https://TU-PROYECTO.vercel.app/api/send-push", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-push-secret": "PUSH_SECRET" },
  body: JSON.stringify({
    usuario: "nombredeusuario",
    title: "BET300 · Tienes un mensaje",
    body: "Un operador te respondió. Entrá al cajero.",
    url: "/"
  })
});
```

## Flujo completo

1. Usuario abre portal → SW se registra
2. Usuario envía carga/retiro → portal pide permiso de notificaciones
3. Si acepta → suscripción guardada en Supabase via `/api/save-subscription`
4. Operador aprueba carga → Supabase webhook llama a `/api/send-push` → push llega al celular
5. Operador escribe mensaje → si el widget está cerrado → notificación local en pantalla
