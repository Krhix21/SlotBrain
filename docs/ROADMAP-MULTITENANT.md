# PLAN â€” De SlotBrain a plataforma multitenant por nicho

> Destino: documento de roadmap del repo (ej. `docs/ROADMAP-MULTITENANT.md`)
> Fecha: 2026-11-08. Basado en el estado real del cÃ³digo (ver
> `docs/CODEBASE.md`).

## 0. DiagnÃ³stico: lo que ya es multitenant y lo que no

**Ya lo es (capa de datos y runtime):**
- `empresas` es el nivel tenant; todo cuelga de `empresa_id` (servicios,
  nÃºmeros, trabajadores, citas). Un despliegue ya atiende N empresas.
- Ruteo mensajeâ†’empresa por nÃºmero receptor (`numeros_bot`), con cachÃ©.
- Cada profesional su Calendar OAuth; cada empresa su zona horaria, horario,
  servicios, textos (`mensaje_bienvenida`, `mensaje_confirmacion`).

**NO lo es (bloqueos reales):**
1. **Panel**: un solo admin global vÃ­a `ADMIN_USER/ADMIN_PASSWORD` env.
   No hay login por empresa ni scoping de la API del panel.
2. **Tokens de WhatsApp en env** (`META_TOKENS_JSON`): solo el operador puede
   registrar nÃºmeros. Un tenant nuevo exige tocar env + redeploy.
3. **Branding/nicho**: el bot es "asesor virtual" genÃ©rico de barberÃ­a
   (precios hardcodeados en COP, tono fijo, terminologÃ­a barberÃ­a).
4. **VerificaciÃ³n webhook Ãºnica**: `META_VERIFY_TOKEN` global.
5. **Sesiones del panel en memoria** (se caen en cada deploy).
6. Sin configuraciÃ³n de polÃ­ticas por tenant (cancelaciÃ³n, antelaciÃ³n) ni
   notificaciones.
7. **NÃºmero de WhatsApp = el de prueba de Meta**: funciona con hasta 5
   destinatarios verificados y SIN plantillas, asÃ­ que un bot que inicia
   mensajes (recordatorios) no escala por sÃ­ solo. Cada empresa necesita
   su propio nÃºmero registrado en WABA (ver Fase 3.3D).

## 1. Principio de diseÃ±o

**Tenant = `empresas.id`.** No agregar mÃ¡s niveles: el multitenant SaaS se
consigue con (a) autenticaciÃ³n por usuario ligado a `empresa_id` y (b)
scoping de TODA la API del panel por ese `empresa_id`. Super-admin = rol
especial, no tabla nueva de "espacios".

## 2. Fases del roadmap

### Fase 0 â€” Renombre y marca: SlotBrain â†’ SlotBrain (chore previo)

Ya hecho: el repo remoto es `https://github.com/Krhix21/SlotBrain` (verificado
con `git remote -v`). Pendiente, llevar el resto al mismo nombre:

1. Renombrar la carpeta local de trabajo:
   `C:\Users\USUARIO\Documents\SlotBrain` â†’
   `C:\Users\USUARIO\Documents\SlotBrain` (borrar tambiÃ©n la carpeta padre
   `SlotBrain` si queda vacÃ­a). Git no lo nota: el repo root ES la carpeta;
   no hay `git mv` de una carpeta raÃ­z y el historial no se toca.
2. `package.json` / `package-lock.json`: `name: "bot-citas-whatsapp"` â†’
   `"slotbrain"`, `description` igual a la nueva marca.
3. Texto de marca: `server.js` (ruta `/` â†’ "SlotBrain activo"), README.md,
   DESPLEGUE-RENDER.md, mensajes de `bot.iniciar()`.
4. Verificar referencias de ruta absoluta: ningÃºn script del repo usa rutas
   absolutas (comprobado: `path.join(__dirname, 'public')`); solo revisar
   que el terminal/IDE apunte a la carpeta nueva.
5. Volver a desplegar/validar en Render tras el cambio (el servicio ya se
   llama SlotBrain; no tocar env).

AceptaciÃ³n: `npm start` en la carpeta renombrada arranca igual y el remoto
sigue siendo Krhix21/SlotBrain.


### Fase 1 â€” AutenticaciÃ³n y scoping multi-tenant (base de todo)

1. MigraciÃ³n SQL:
   - Tabla `usuarios_admin`:
     `id, empresa_id (NULL = superadmin), email UNIQUE, password_hash
     (bcrypt o argon2, nunca texto plano), rol ('propietario'|'staff'|
     'superadmin'), activo, creado_en`.
   - Migrar el `ADMIN_USER` actual al primer usuario superadmin.
2. `admin.js`:
   - `login` valida contra DB (sustituye las credenciales de env), con rate
     limit simple.
   - Sesiones â†’ tabla `sesiones_admin` (token, usuario_id, expira). Evita la
     pÃ©rdida por deploy.
   - `requireAuth` resuelve `req.usuario = {id, empresa_id, rol}`; helper
     `soloSuEmpresa(req, empresaId)` con bypass para superadmin.
   - Todas las rutas existentes filtran `where empresa_id =
     req.usuario.empresa_id` (los flujos de superadmin pasan `empresa_id`
     por query previo check de rol).
3. `public/admin.html`: pantalla de login multi-usuario; UI limitada a la
   empresa del usuario.

AceptaciÃ³n: dos usuarios de empresas distintas NO ven datos del otro; el
superadmin ve todo.

### Fase 2 â€” Identidad de marca y ajuste por nicho (lo visible)

1. Columnas nuevas en `empresas`:
   - `logo_url TEXT` (mejor en Supabase Storage; MVP: URL directa)
   - `color_primario TEXT`
   - `moneda TEXT DEFAULT 'COP'` + `moneda_formato` (fix del "$ COP" fijo en
     `bot.js textoServicios`)
   - `terminologia JSONB`: `{"servicio_singular":"cita","servicio_plural":
     "servicios","profesional_singular":"barbero","profesional_plural":
     "barberos","articulo_profesional":"el","encuentro":"cita"}`
   - `prompt_base TEXT` (editable; default segÃºn nicho)
   - `politicas JSONB` (cancelaciÃ³n anticipada, max por cliente/semana, etc.)
2. `bot.js construirPrompt`: interpolar `terminologia` + `prompt_base` +
   lista de servicios; quitar todo lenguaje barberÃ­a del template.
3. Footer/HTML del panel con logo y color de la empresa del usuario.
4. Saludo/bienvenida ya usan `empresa.nombre`; verificar que no quede ningÃºn
   texto "barberÃ­a" hardcodeado en respuestas (`bot.js`, mensajes fijos de
   cancelaciÃ³n/movimiento).

AceptaciÃ³n: dado un nicho (dental, spa, taller), el prompt queda correcto
solo llenando empresa + servicios + terminologÃ­a.

### Fase 3 â€” Onboarding self-service y nÃºmeros WhatsApp por tenant

Problema central: el token de WhatsApp de cada nÃºmero vive en env. Opciones:

- **3A (recomendada MVP): token por tenant en DB cifrada.**
  - Columna `numeros_bot.meta_token_cifrado` (AES-256-GCM con
    `APP_ENCRYPTION_KEY` en env; nunca devolverla por la API â€” los GET la
    devuelven vacÃ­a).
  - `whatsappCloud.credenciales(phoneNumberId)` consulta el mapa env Y la DB
    (con cachÃ© en memoria, invalidada por `numeros.limpiarCache`).
  - El propietario pega en el panel el token de acceso permanente y el
    phone_number_id.
  - Los tokens permanentes de Meta requieren Business verification; dejar
    documentado el paso a paso (token permanente vs. los de 60 dÃ­as).
- **3B: cada empresa con su propia app Meta**: cada owner registra su app y
  su webhook â†’ complica la verificaciÃ³n de webhooks. Evitar por ahora.
- **3C: una sola app Meta con todos los nÃºmeros**: necesita permisos de
  Business y cuotas compartidas; fase futura.

**3D (nuevo, lo que pidiÃ³ el negocio): botÃ³n "conectar mi nÃºmero" â€” cada
empresa conecta el SUYO, no quedar dependiendo del nÃºmero de prueba.**

Hoy el despliegue usa el **nÃºmero de prueba de Meta** del operador (lÃ­mite:
hasta 5 destinatarios verificados y sin plantillas). El objetivo: cada
empresa registra/conecta su propio nÃºmero vÃ­a el panel. Dos caminos:

- **Camino manual (primer MVP de la Fase 3):**
  1. La empresa crea su Portfolio de Meta Business y verifica la empresa
     (documentos que Meta exija). Sin esto no hay nÃºmero propio ni token
     permanente.
  2. Crea su WABA (WhatsApp Business Account), agrega el nÃºmero propio y
     elige el nombre para mostrar (display name) â†’ Meta lo aprueba.
  3. El nÃºmero no puede estar ya registrado en la app de WhatsApp del
     telÃ©fono (migrarlo/borrar registro si lo estÃ¡).
  4. Genera un token permanente (usuario de sistema de su Business) con
     permisos `whatsapp_business_messaging` +
     `whatsapp_business_management` sobre su WABA.
  5. Pega token + phone_number_id en el panel (flujo 3A) y cualquier
     envÃ­o/respuesta ya usa ese nÃºmero.
  6. Nota de webhook: los entrantes de la WABA de la empresa solo llegan si
     la app del operador estÃ¡ suscrita a esa WABA (permission
     `subscribe_apps` que concede el owner de la WABA). En el camino
     manual, la empresa comparte su WABA con el portfolio del operador, o
     suscribe manualmente desde su panel de Meta.
- **Camino embebido (self-service real, "Embedded Signup"):**
  - Meta ofrece el flujo **Embedded Signup** (SDK JS) para que la empresa
    haga TODAS sus validaciones dentro de una ventana embebida del panel:
    crear portfolio, verificar empresa, crear WABA, agregar/portar nÃºmero,
    y el operador termina recibiendo el token de esa WABA en el callback
    del flujo (`finish` con `event: FINISH/POST_MESSAGE`).
  - Requiere: app del operador con los permisos `whatsapp_business_
    management`, `whatsapp_business_messaging` y `business_management`
    aprobados por revisiÃ³n de Meta, mÃ¡s configuraciÃ³n de `config_id`.
  - Con esto el botÃ³n del panel es literalmente "Conectar WhatsApp":
    embebido â†’ la empresa termina sus validaciones â†’ el nÃºmero aparece en
    `numeros_bot` con su token cifrado automÃ¡ticamente.
- **ConsideraciÃ³n de costos (auto-margen de la SaaS):** cada plantilla de
  recordatorio iniciada por el bot genera cobro de Meta a la WABA de la
  empresa (categorÃ­a UTILITY, la mÃ¡s barata y con tarifa por paÃ­s; las
  utilitarias dentro de la ventana de servicio de 24 h no se cobran). EstÃ¡
  a favor: quien envÃ­a recordatorios paga su tarifa, no el operador.

AdemÃ¡s:
- `META_VERIFY_TOKEN`: el challenge de verificaciÃ³n del webhook es global
  por URL; mantener 1 token global es aceptable (documentarlo).
- Wizard de onboarding en el panel (5 pasos: empresa â†’ servicios â†’
  profesionales â†’ WhatsApp â†’ calendario) con checklist de estado.
- Registro pÃºblico: pÃ¡gina `/registro` crea empresa + usuario propietario,
  con rate-limit y captcha simple si aparece SPAM.

### Fase 4 â€” Notificaciones programadas (nueva feature transversal)

**Dependencia con 3D:** como las notificaciones las INICIA el bot (fuera de
la ventana de 24 h), Meta exige **plantillas aprobadas** por cada WABA:
- Plantilla UTILITY para el **profesional** ("Recordatorio: cita de
  {{cliente}} el {{fecha}} a las {{hora}}").
- Plantilla UTILITY para el **cliente** (recordatorio + "responda CONFIRMAR
  para confirmar"). La categorÃ­a utilitaria es la de menor fricciÃ³n de
  aprobaciÃ³n en Meta (es de las que aprobaciÃ³n automÃ¡tica).
- Regla del negocio: mientras la empresa siga en el nÃºmero de prueba (sin
  WABA propia), los recordatorios NO se envÃ­an como plantilla, solo caen
  dentro de la ventana de 24 h cuando las hubo â€” por eso conviene terminar
  3D antes de activar recordatorios en producciÃ³n. Con el nÃºmero propio
  conectado, las plantillas se crean y aprueban desde el panel (API
  `POST /{waba_id}/message_templates`, categorÃ­a UTILITY, con variables).

1. Scheduler: `node-cron` (o `setInterval` tolerado en single-instance de
   Render). Cada minuto: `select * from citas where estado in
   ('agendada','confirmada')` con `inicio_utc` dentro de las prÃ³ximas
   ventanas; idempotente con columna `notificaciones JSONB` en citas
   (track de {profesional_24h, cliente_2h...}).
2. Mensaje al **profesional** (su telÃ©fono propio
   `trabajadores.telefono`; si no tiene, usar el WhatsApp de la empresa):
   "Recuerda: cita de X con Y maÃ±ana 14:00".
3. Mensaje al **cliente**: recordatorio 2â€“3 h antes. (Opcional, fase 4.5:
   interpretar su respuesta para pasar la cita a estado `confirmada`.)
4. Publicar el evento en el calendario ya existe (el evento ES el canal del
   profesional). Complemento barato: mandar tambiÃ©n el link TEMPLATE al
   profesional (ver `docs/CALENDARIO-GRATIS.md` Â§5).

### Fase 5 â€” Super-panel, mÃ©tricas y facturaciÃ³n (despuÃ©s)

- Vista superadmin: lista de tenants, estado de nÃºmeros, calendarios
  vencidos, citas/semana.
- LÃ­mites por plan (cap profesionales, cap citas) en `empresas.plan`.
- FacturaciÃ³n externa (Stripe/Pay hooks) posterior; no bloquear Fases 1â€“4.

## 3. Riesgos y decisiones abiertas

- **R1**: el token de Meta cifrado en DB depende de `APP_ENCRYPTION_KEY`;
  si se pierde, los nÃºmeros dejan de enviar. Guardarla en secrets del hoster
  y tener plan de rotaciÃ³n.
- **R2**: RLS de Supabase: hoy el backend usa la `SUPABASE_KEY` (service
  role) con permisos amplios. Alternativa: claves `service_role` solo
  server-side + RLS para clientes futuros (API pÃºblica). No bloquea fases
  1â€“3 (el scoping se hace en cÃ³digo); apuntarlo como deuda tÃ©cnica.
- **R3**: modelo global: `MODELO` en `bot.js` y `GROQ_API_KEY` en env es un
  solo proveedor. Si algÃºn tenant demanda otro modelo o un prompt mÃ¡s
  grande, parametrizar `empresas.modelo` con default.
- **D1 (abierta)**: Â¿registro pÃºblico self-service ya en Fase 3, u
  onboarding a mano por ti mientras hay pocos clientes? RecomendaciÃ³n: a
  mano hasta tener Fase 2 lista; self-service en Fase 3.
- **D2 (abierta)**: dominio de la plataforma y subdominios por tenant (hoy
  un solo dominio; el panel distingue por login). Se puede postergar.

## 4. Orden sugerido de ejecuciÃ³n

```
Fase 0 (renombre SlotBrain, chore) â†’ Fase 1 (auth + scoping) â†’
Fase 2 (branding/nicho) â†’ Fase 3.3D manual (nÃºmeros propios) â†’
Fase 4 (notificaciones, independiente, puede ir en paralelo tras Fase 1,
pero su activaciÃ³n en producciÃ³n depende del 3D por las plantillas) â†’
Fase 3 embebido (Embedded Signup, mÃ¡s riesgo Meta) â†’ Fase 5.
```

Nota final: pediste "multitenant con panel propio del admin de la empresa +
logo + datos por nicho" â†’ eso es exactamente Fase 1 + Fase 2. La Fase 3 solo
entra cuando quieras que los dueÃ±os se den de alta solos.


