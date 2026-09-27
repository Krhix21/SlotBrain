create table barberos (
  id uuid default gen_random_uuid() primary key,
  telefono_bot text unique not null,
  correo text,
  refresh_token text not null,
  activo boolean default true,
  created_at timestamp default now()
);

-- Historial resumido (no guarda todo el chat, solo eventos importantes)
-- La tabla historial_chats ya existe en Supabase con:
--   id, user_id, role, content, timestamp
--
-- Roles que usa el bot:
--   cliente        → nombre y teléfono del cliente
--   cita_agendada  → servicio, fecha y hora
--   cita_cancelada → cita que se canceló
--   cita_modificada → cambio de horario
