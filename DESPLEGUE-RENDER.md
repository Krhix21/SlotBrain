# Despliegue en Render

El despliegue cambió bastante respecto a la versión 1: ya no hay Chromium, ni
Puppeteer, ni sesión que guardar en un disco. El servicio es un Node normal.

## Requisitos

- Cuenta en Render
- Repositorio en GitHub
- Supabase con la base ya migrada
- App de Meta con el webhook configurado
- Google Cloud con la API de Calendar

## 1. Base de datos

Si la base viene de la versión anterior, ejecuta en el SQL Editor de Supabase,
**en este orden**:

1. `supabase-migracion-v2.sql`
2. `supabase-migracion-v3.sql`

Si la base es nueva, `supabase-schema.sql` incluye todo.

## 2. Repositorio

```bash
git add .
git commit -m "Migracion a Meta Cloud API con N profesionales"
git push
```

El `.gitignore` ya excluye `node_modules`, `.env` y los logs. No hace falta
ignorar nada más: `conversaciones.json` ya no existe en el proyecto.

## 3. Web Service en Render

| Campo | Valor |
|---|---|
| Runtime | Node |
| Build command | *(vacío)* |
| Start command | `npm start` |
| Health check | `/health` |

No hay paso de build: ya no hay nada que compilar ni navegador que instalar.
El `Dockerfile` (Node 22 slim, sin Chromium) queda disponible si prefieres
desplegar como contenedor, pero para este proyecto el servicio nativo de
Render es más simple.

## 4. Variables de entorno

```
GROQ_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://tu-servicio.onrender.com/auth/google/callback
SECRETO_ENLACE=
SUPABASE_URL=
SUPABASE_KEY=
META_WHATSAPP_TOKEN=
META_PHONE_NUMBER_ID=
META_VERIFY_TOKEN=
META_APP_SECRET=
ADMIN_USER=
ADMIN_PASSWORD=
PORT=3000
```

Si atiendes varios números, `META_WHATSAPP_TOKEN` y `META_PHONE_NUMBER_ID`
pueden quedar vacíos y usar solo:

```
META_TOKENS_JSON={"111111111111111":"token-a","222222222222222":"token-b"}
```

El `META_TOKENS_JSON` es un objeto JSON en **una sola línea**, sin saltos de
línea, porque Render lo muestra en una sola línea en el panel.

**`ADMIN_USER` y `ADMIN_PASSWORD` son obligatorios.** Si faltan, el panel
devuelve 503 y queda cerrado. No hay credenciales por defecto.

**`SECRETO_ENLACE` es obligatorio para la vinculación de calendarios.** Genera
uno con:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Si lo dejas vacío se usa `GOOGLE_CLIENT_SECRET`, pero es recomendable darle
uno propio: si no hay ninguno de los dos, el panel no genera enlaces y avisa
del motivo.

## 5. Meta: apuntar el webhook

Con el servicio ya desplegado:

- Callback URL: `https://tu-servicio.onrender.com/webhook/whatsapp`
- Verify token: el mismo que pusiste en `META_VERIFY_TOKEN`
- Suscríbete al campo **messages**

Meta manda un GET para verificar y luego POST por cada mensaje.

## 6. Google Cloud: el redirect URI

Debe ser exactamente:

```
https://tu-servicio.onrender.com/auth/google/callback
```

Y debe estar en **Authorized redirect URIs** de la app de Google Cloud.

Mientras la app esté en modo **Testing**, Google solo deja autorizar a los
correos que estén en *Test users*, y los `refresh_token` caducan a los 7 días.
Para uso real hay que publicar la app o dejar el proyecto en producción.

## 7. Primer arranque

El log debe mostrar:

```
🚀 Servidor escuchando en el puerto 3000
📱 Bot de WhatsApp (Meta Cloud API) iniciado.
✅ 1 número(s) de respuesta activo(s):
   • 573001234567 → 123456789012345
```

Si sale `No hay ningún número activo en numeros_bot`, el bot está vivo pero
descartará los mensajes: registra el número en el panel.

## Sobre el plan gratuito

El plan free de Render duerme la instancia tras 15 minutos de inactividad y la
despierta con unos segundos de retraso. Dos consecuencias reales:

- **El webhook puede devolver timeout.** Meta espera una respuesta rápida y
  reintenta. El bot responde 200 de inmediato y procesa en segundo plano, así
  que el retraso del arranque es el problema real: si la instancia está
  dormida, Meta recibe un error y reintenta más tarde.
- **Los refrescos de token de Google** también retrasan el primer mensaje tras
  un rato sin uso.

Para un negocio que recibe mensajes durante el día conviene el plan **Starter**
(7 USD/mes). Para pruebas sporadicamente puede servir el free, teniendo en
cuenta que puede que el primer mensaje tarde en procesarse.

## Health check

`GET /health` consulta Supabase y responde `{"ok":true,"supabase":true}`.
Si Supabase no responde devuelve 503, que es lo que Render usa para decidir si
reinicia el servicio.

## Problemas frecuentes

**"El número X no está registrado en numeros_bot"**
El número llegó con un formato distinto al que guardaste. Compara: la tabla
guarda solo dígitos y sin `+`. Ej: `573001234567`.

**Los mensajes salen pero no agenda**
Casi siempre es que el profesional no tiene Google Calendar enlazado. El
log avisa: `⚠️ N profesional(es) sin Google Calendar`. Sin `refresh_token`, el
motor de disponibilidad no ofrece ninguna hora a propósito, antes que prometer
una que no se puede verificar.

**Error 131049 al enviar**
La ventana de 24 horas con ese cliente está cerrada. Solo puedes responder si
él te escribió primero hoy. Esto es normal en Meta y no es un bug.

**El token de Google dejó de funcionar**
Los `refresh_token` caducan a los 7 días si la app de Google está en modo
Testing. Desconecta y vuelve a enlazar el calendario desde el panel.
