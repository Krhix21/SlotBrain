# Guía de Despliegue en Render.com

Esta guía te ayudará a desplegar tu bot de citas multiservicio en Render.com de forma gratuita.

## Requisitos Previos

1. **Cuenta en Render.com** - [Regístrate aquí](https://render.com/)
2. **Cuenta en GitHub** - Tu código debe estar en un repositorio
3. **Cuenta en Supabase** - Base de datos ya configurada
4. **Proyecto en Google Cloud** - OAuth para Google Calendar configurado

## Paso 1: Preparar el Repositorio

### 1.1 Crear archivo `.gitignore`

Asegúrate de tener un archivo `.gitignore` en la raíz del proyecto:

```gitignore
node_modules/
.wwebjs_auth/
conversaciones.json
.env
*.log
.DS_Store
```

### 1.2 Subir código a GitHub

```bash
git init
git add .
git commit -m "Inicializar proyecto de bot de citas"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

## Paso 2: Configurar Supabase

### 2.1 Ejecutar el esquema SQL

1. Ve a tu panel de Supabase
2. Navega a **SQL Editor**
3. Crea una nueva query
4. Copia y pega el contenido de `supabase-schema.sql`
5. Ejecuta la query

### 2.2 Obtener credenciales

1. En Supabase, ve a **Settings → API**
2. Copia:
   - `Project URL` → `SUPABASE_URL`
   - `anon public key` → `SUPABASE_KEY`

## Paso 3: Configurar Google Cloud

### 3.1 Configurar OAuth Consent Screen

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Navega a **APIs & Services → OAuth consent screen**
3. Configura:
   - **Tipo de usuario**: Externo (para producción)
   - **Nombre de la aplicación**: Tu nombre del bot
   - **Correo de soporte**: Tu correo
   - **Dominios autorizados**: Agrega tu dominio de Render (ej: `tu-app.onrender.com`)

### 3.2 Crear credenciales OAuth

1. Ve a **APIs & Services → Credentials**
2. Crea **OAuth 2.0 Client ID**
3. Tipo de aplicación: **Aplicación web**
4. URIs de redirección autorizados:
   - `https://tu-app.onrender.com/auth/google/callback`
5. Copia:
   - **Client ID** → `GOOGLE_CLIENT_ID`
   - **Client Secret** → `GOOGLE_CLIENT_SECRET`

### 3.3 Habilitar Google Calendar API

1. Ve a **APIs & Services → Library**
2. Busca "Google Calendar API"
3. Haz clic en "Habilitar"

### 3.4 Configurar Usuarios de Prueba (Fase de pruebas)

1. En **OAuth consent screen**
2. Ve a la sección **Usuarios de prueba**
3. Agrega los correos de los trabajadores que probarán el sistema

## Paso 4: Crear Web Service en Render

### 4.1 Conectar Repositorio

1. Entra a [Render.com](https://dashboard.render.com/)
2. Haz clic en **"New +" → "Web Service"**
3. Conecta tu cuenta de GitHub
4. Selecciona tu repositorio

### 4.2 Configurar Build y Start

**Build Command:**
```bash
npm install && npm run build
```

**Start Command:**
```bash
npm start
```

**Runtime:**
- Node.js (selecciona la versión más reciente, ej: 18.x o 20.x)

### 4.3 Configurar Variables de Entorno

En la sección **Environment**, agrega las siguientes variables:

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `SUPABASE_URL` | Tu URL de Supabase | Del paso 2.2 |
| `SUPABASE_KEY` | Tu anon key de Supabase | Del paso 2.2 |
| `GOOGLE_CLIENT_ID` | Tu Client ID de Google | Del paso 3.2 |
| `GOOGLE_CLIENT_SECRET` | Tu Client Secret de Google | Del paso 3.2 |
| `GOOGLE_REDIRECT_URI` | `https://tu-app.onrender.com/auth/google/callback` | Reemplaza con tu URL de Render |
| `GROQ_API_KEY` | Tu API key de Groq | Obtenla de [console.groq.com](https://console.groq.com) |
| `PORT` | `3000` | Puerto del servidor |

### 4.4 Configurar Persistencia (Solo Plan de Pago)

⚠️ **Importante:** Los discos persistentes en Render están disponibles **solo en planes de pago** (Starter o superior). En el plan gratuito, la sesión de WhatsApp se perderá cada vez que el servicio se reinicie.

**Opciones para el plan gratuito:**

**Opción A: Aceptar que la sesión se pierda (más simple)**
- No configures ningún disco
- Cada vez que Render reinicie el servicio, tendrás que:
  1. Ir a `https://tu-app.onrender.com/vincular.html`
  2. Escanear el QR nuevamente
  3. Reconectar Google Calendar
- Esto es aceptable para pruebas, pero no para producción

**Opción B: Usar un Cron Job para mantener el servicio despierto**
- Crea un **Cron Job** en Render (gratis)
- Comando: `curl https://tu-app.onrender.com/`
- Frecuencia: Cada 10 minutos
- Esto reduce los reinicios, pero no guarda la sesión permanentemente

**Opción C: Plan de pago (recomendado para producción)**
- Actualiza al plan **Starter ($7/mes)**
- Habilita discos persistentes
- Configura:
  1. Ve a **"New +" → "Disk"**
  2. Nombre: `whatsapp-session`
  3. Tamaño: 1 GB
  4. Región: La misma que tu Web Service
  5. Crea el Disk
  6. Ve a tu Web Service → **Advanced → Disks**
  7. Selecciona el disco `whatsapp-session`
  8. Mount path: `/opt/render/project/.wwebjs_auth`
- La sesión de WhatsApp se mantendrá entre reinicios

## Paso 5: Desplegar

1. Haz clic en **"Create Web Service"**
2. Espera a que Render construya y despliegue la aplicación
3. Una vez desplegado, obtendrás una URL como: `https://tu-app.onrender.com`

## Paso 6: Configurar el Bot

### 6.1 Conectar WhatsApp

1. Ve a `https://tu-app.onrender.com/vincular.html`
2. Escanea el código QR con tu WhatsApp
3. Espera a que se conecte

### 6.2 Conectar Google Calendar

1. Después de conectar WhatsApp, verás el botón "Conectar con Google"
2. Haz clic y autoriza el acceso a tu calendario
3. Verifica que aparezca "¡Todo listo!"

### 6.3 Configurar Empresa y Servicios

1. Ve a `https://tu-app.onrender.com/admin.html`
2. Ingresa tu número de WhatsApp del bot (sin el +, ej: 573001234567)
3. Crea o edita tu empresa:
   - Nombre del negocio
   - Descripción
   - Teléfono
   - Dirección
   - Zona horaria
   - Mensajes personalizados
4. Agrega tus servicios:
   - Nombre
   - Descripción
   - Precio
   - Duración

## Paso 7: Probar el Bot

1. Envía un mensaje al WhatsApp del bot desde tu teléfono
2. Deberías recibir el mensaje de bienvenida personalizado
3. Prueba agendar una cita con uno de tus servicios configurados

## Limitaciones del Plan Gratuito de Render

- **750 horas/mes** de ejecución
- **512 MB RAM**
- **Sin SSL personalizado** (pero sí SSL gratuito de Render)
- **La app se duerme** después de 15 minutos de inactividad
- **Tarda ~30 segundos** en despertar cuando llega un mensaje
- **Sin discos persistentes** - La sesión de WhatsApp se pierde al reiniciar

**Nota:** Para un bot de WhatsApp que necesita estar siempre activo, considera:
- Usar **Render Cron Jobs** para mantener la despierta (gratis)
- Actualizar al plan **Starter ($7/mes)** para:
  - Evitar que la app se duerma
  - Habilitar discos persistentes (sesión de WhatsApp se mantiene)
  - Mejor rendimiento y estabilidad

## Solución de Problemas

### El bot no responde después de dormir

**Solución:** Agrega un cron job en Render:

1. Crea un **Cron Job** en Render
2. Comando: `curl https://tu-app.onrender.com/`
3. Frecuencia: Cada 10 minutos
4. Esto mantiene la app despierta

### Error de sesión de WhatsApp

**Solución:** En el plan gratuito, esto es normal. Cada vez que Render reinicie el servicio:
1. Ve a `https://tu-app.onrender.com/vincular.html`
2. Escanea el QR nuevamente
3. Reconecta Google Calendar

**Para evitar esto:** Actualiza al plan Starter ($7/mes) para habilitar discos persistentes (ver paso 4.4, Opción C).

### Error: "Could not find Chrome" (Puppeteer)

**Problema:** whatsapp-web.js usa Puppeteer que necesita Chrome, pero Render no lo tiene preinstalado.

**Solución:** El proyecto usa Puppeteer para instalar Chrome automáticamente:

1. **El `package.json` incluye:**
   - `puppeteer` como dependencia
   - Script `build` que instala Chrome: `npx puppeteer browsers install chrome`

2. **El Build Command en Render debe ser:**
   ```
   npm install && npm run build
   ```

3. **El `bot.js` está configurado** para usar el Chrome instalado por Puppeteer

**Si aún falla:**
- Verifica que el Build Command incluya `npm run build`
- Revisa los logs para ver si Chrome se instaló correctamente
- Chrome ocupa ~300MB, asegúrate de tener suficiente espacio en el build
- Si el build falla por tiempo, considera usar un plan de pago con más recursos

### Error de Google Calendar

**Solución:** Verifica que:
- El `GOOGLE_REDIRECT_URI` coincida exactamente con tu URL de Render
- El usuario esté en la lista de "Usuarios de prueba" (modo testing)
- La Google Calendar API esté habilitada

### La base de datos no se conecta

**Solución:** Verifica que las variables `SUPABASE_URL` y `SUPABASE_KEY` sean correctas.

## Actualizar el Bot

Para hacer cambios:

1. Haz los cambios en tu código local
2. Commit y push a GitHub:
   ```bash
   git add .
   git commit -m "Descripción del cambio"
   git push
   ```
3. Render detectará el cambio y redeployará automáticamente

## Monitoreo

- Ve al panel de Render para ver logs en tiempo real
- Los logs de WhatsApp aparecerán en la terminal
- Los errores de Google Calendar también se mostrarán allí

## Siguiente Paso: Producción

Cuando estés listo para producción:

1. **Verificar la app con Google** - Para que cualquier usuario pueda conectar su calendario
2. **Actualizar a plan de pago** - Para evitar que el bot se duerma
3. **Configurar dominio personal** - Para una URL más profesional
4. **Implementar autenticación** - Para proteger el panel de administración

## Soporte

Si tienes problemas:
- Revisa los logs en Render
- Verifica las variables de entorno
- Asegúrate de que todas las APIs estén habilitadas
- Consulta la [documentación de Render](https://render.com/docs)
