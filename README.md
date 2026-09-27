# Sistema de Citas Multiservicio - Setup

Bot de WhatsApp para gestión de citas con Google Calendar, ahora **multiservicio y multicuenta**.

## Características

- ✅ **Multiservicio**: Configura cualquier tipo de negocio (barberías, salones, clínicas, etc.)
- ✅ **Multicuenta**: Múltiples empresas pueden usar el mismo sistema
- ✅ **Servicios dinámicos**: Agrega/edita/elimina servicios desde el panel de administración
- ✅ **Mensajes personalizados**: Personaliza bienvenida y confirmación por empresa
- ✅ **Integración Google Calendar**: Cada barbero conecta su propio calendario
- ✅ **Historial de citas**: Registro completo en base de datos

## Arquitectura

- **Empresas**: Cada negocio tiene su configuración independiente
- **Servicios**: Cada empresa define sus propios servicios con precios y duraciones
- **Barberos**: Se relacionan con empresas y conectan sus Google Calendars
- **Citas**: Se registran en la base de datos y se sincronizan con Google Calendar

## 1. Instalar dependencias
```bash
npm install
```

## 2. Configurar Base de Datos (Supabase)

Ejecuta el contenido de `supabase-schema.sql` en el SQL Editor de tu proyecto Supabase.

Tablas creadas:
- `empresas` — configuración de cada negocio
- `servicios` — servicios de cada empresa (nombre, precio, duración)
- `barberos` — credenciales OAuth de Google Calendar (ahora con relación a empresas)
- `citas` — historial completo de citas

## 3. Configurar `.env`

Crea un archivo `.env` con las siguientes variables:

```env
GROQ_API_KEY=tu_api_key_de_groq
GOOGLE_CLIENT_ID=tu_client_id_de_google
GOOGLE_CLIENT_SECRET=tu_client_secret_de_google
GOOGLE_REDIRECT_URI=https://tu-dominio.com/auth/google/callback
SUPABASE_URL=tu_url_de_supabase
SUPABASE_KEY=tu_anon_key_de_supabase
PORT=3000
```

**Nota:** El número de teléfono ya NO se configura manualmente — se detecta automáticamente cuando el barbero escanea el QR.

## 4. Arrancar el servidor
```bash
npm start
```

Esto levanta:
- Servidor Express con rutas de administración
- Bot de WhatsApp
- Panel de administración web

## 5. Flujo de Configuración

### Paso 1: Conectar WhatsApp
Ve a `http://localhost:3000/vincular.html` y escanea el QR con tu WhatsApp.

### Paso 2: Conectar Google Calendar
Después de conectar WhatsApp, haz clic en "Conectar con Google" para autorizar el acceso a tu calendario.

### Paso 3: Configurar Empresa y Servicios
Ve a `http://localhost:3000/admin.html`:
1. Ingresa tu número de WhatsApp del bot (ej: 573001234567)
2. Crea tu empresa:
   - Nombre del negocio
   - Descripción
   - Teléfono y dirección
   - Zona horaria
   - Mensajes personalizados
3. Agrega tus servicios:
   - Nombre
   - Descripción
   - Precio
   - Duración en minutos

## 6. Probar el Bot

Envía un mensaje al WhatsApp del bot. Deberías recibir:
- Mensaje de bienvenida personalizado con el nombre de tu empresa
- Lista de tus servicios configurados
- Posibilidad de agendar citas con tus servicios

## 7. Despliegue en Producción

Para desplegar en Render.com (gratis), sigue la guía completa en `DESPLEGUE-RENDER.md`.

Resumen rápido:
1. Sube el código a GitHub
2. Crea un Web Service en Render
3. Configura las variables de entorno
4. Configura un disco persistente para la sesión de WhatsApp
5. Configura Google Cloud con tu dominio de Render

## 8. Google Cloud - Usuarios de Prueba

Mientras tu app esté en modo "Testing":
1. Ve a Google Cloud Console → APIs y servicios → Pantalla de consentimiento OAuth
2. En "Usuarios de prueba", agrega el correo de cada barbero
3. Sin esto, Google bloqueará el login

**Para producción:** Verifica la app con Google para que cualquier usuario pueda conectar su calendario sin necesidad de agregarlos manualmente.

## 9. API Endpoints

### Empresas
- `GET /api/admin/empresas/telefono/:telefono_bot` - Obtener empresa por teléfono
- `POST /api/admin/empresas` - Crear empresa
- `PUT /api/admin/empresas/:id` - Actualizar empresa
- `POST /api/admin/empresas/assign` - Asignar empresa a barbero

### Servicios
- `GET /api/admin/servicios/empresa/:empresa_id` - Obtener servicios de empresa
- `POST /api/admin/servicios` - Crear servicio
- `PUT /api/admin/servicios/:id` - Actualizar servicio
- `DELETE /api/admin/servicios/:id` - Eliminar servicio (soft delete)

### Citas
- `GET /api/admin/citas/empresa/:empresa_id` - Obtener citas de empresa
- `POST /api/admin/citas` - Crear cita
- `PUT /api/admin/citas/:id/estado` - Actualizar estado de cita

## 10. Notas Importantes

### Zonas Horarias
El sistema soporta múltiples zonas horarias. Cada empresa puede configurar su zona horaria en el panel de administración.

### Duración de Servicios
Cada servicio puede tener una duración diferente. El bot usa esta duración para verificar disponibilidad en Google Calendar.

### Persistencia de WhatsApp
En producción, configura un disco persistente para que la sesión de WhatsApp no se pierda al reiniciar el servidor.

### Escalabilidad
- **Actualmente:** 1 instancia = 1 WhatsApp = 1 barbero
- **Para múltiples barberos:** Cada uno necesita su propia instancia del bot
- **Alternativa:** Migrar a WhatsApp Business API (Meta) para soporte multi-número desde un solo backend

## Archivos Principales

- `bot.js` - Lógica del bot de WhatsApp
- `calendar.js` - Integración con Google Calendar
- `admin.js` - API endpoints para gestión de empresas y servicios
- `server.js` - Servidor Express
- `auth.js` - Autenticación OAuth con Google
- `public/admin.html` - Panel de administración web
- `public/vincular.html` - Página de conexión WhatsApp/Google

## Soporte

Para problemas de despliegue, consulta `DESPLEGUE-RENDER.md`.

Para problemas de configuración, verifica:
- Variables de entorno en `.env`
- Tablas de Supabase creadas correctamente
- Google Cloud OAuth configurado
- Usuarios de prueba agregados (modo testing)
