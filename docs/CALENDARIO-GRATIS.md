# Calendario de Google para cada profesional, SIN pagar nada

> Destino final en el repo: `docs/CALENDARIO-GRATIS.md`
> Contexto: hoy tienes TU cuenta de Google Cloud, un solo OAuth client y
> profesionales que enlazan su calendario vÃ­a el enlace firmado del panel
> (auth.js). Este doc explica por quÃ© eso ya es gratis y cÃ³mo dejarlo sano.

## 1. La API de Calendar ES gratis â€” el mito del pago

Confirmado contra la documentaciÃ³n oficial de Google (2026):

- **Costo del uso normal: $0.** "All standard use of the Google Calendar API
  is available at no additional cost."
- LÃ­mites: 10.000 requests/minuto por proyecto, 600/minuto por usuario, y un
  umbral diario de **1.000.000 requests/dÃ­a por proyecto**.
- Cobro solo se estÃ¡ preparando para EXCEDED el umbral de 1M/dÃ­a, con aviso
  de 90 dÃ­as. Un barbero/taller/consultorio con decenas de citas diarias
  nunca llega (cada cita â‰ˆ 3â€“5 llamadas: freebusy + insert + margen).
- No requiere tarjeta ni cuenta de Google Workspace.

De dÃ³nde sale el mito:
1. La gente confunde Calendar API con **Google Workspace** (suscripciÃ³n por
   usuario, irrelevante aquÃ­).
2. La gente confunde con **Gmail/Drive (scopes RESTRINGIDOS)**, que sÃ­ exigen
   un assessment de seguridad (CASA, $500â€“$4.500/aÃ±o) para verificarse.
   **Calendar es scope "sensible", NO restringido** â†’ verificar es gratis,
   solo es cola de revisiÃ³n.

## 2. El costo real que sÃ­ existe: el modo de publicaciÃ³n del OAuth app

Esto no es dinero sino fricciÃ³n segÃºn el estado del consent screen
(ya configurado en Google Cloud Console â†’ APIs & Services â†’ OAuth consent
screen, hoy "Auth/Audience" en la consola nueva):

| Estado | QuiÃ©n puede enlazar | Â¿Tokens expiran? | Aviso al usuario | LÃ­mite |
|---|---|---|---|---|
| **Testing** (default) | solo los 100 "test users" agregados manualmente | **SÃ: cada 7 dÃ­as** âš ï¸ | pantalla de prueba | 100 usuarios |
| **Production sin verificar** (publish app) | **cualquier** usuario de Google | **NO** | aviso "app no verificada" (clic en Avanzado) | 100 usuarios lifetime |
| **Production verificada** | cualquier usuario | NO | ninguno | sin lÃ­mite |

El modo Testing con tokens que mueren a los 7 dÃ­as es lo que rompe la
experiencia: el profesional tendrÃ­a que re-enlazar cada semana. NUNCA dejar
la app en Testing en producciÃ³n.

## 3. QuÃ© hacer HOY con tu cuenta (pasos concretos, gratis)

1. **Cloud Console** â†’ habilitar "Google Calendar API" en tu proyecto (ya
   debe estar). Crear OAuth client Web si no existe, con redirect URI
   `https://<tu-dominio>/auth/google/callback` (HTTPS exacto, sin wildcard).
2. **OAuth consent screen â†’ User type: External.**
3. **Publicar en Production SIN verificaciÃ³n** (botÃ³n "Publish app"). Eso es
   lo que hace que el `refresh_token` de cada profesional NO caduque a los 7
   dÃ­as. Cuota y API siguen siendo $0.
4. Aceptar el **aviso de app no verificada**: al enlazar, el profesional ve
   "Google hasn't verified this app â†’ Advanced â†’ Go to {app} (unsafe)". Es
   normal para apps internas pequeÃ±as. MitigaciÃ³n: el app name/logo y las
   instrucciones en la pÃ¡gina de vinculaciÃ³n (`public/vincular.html`).
5. Cap de 100 usuarios que autorizan: cuenta lifetime por proyecto. Cada
   profesional que enlaza â‰ˆ 1 usuario. Con 1â€“5 empresas hoy sobra. Cuando
   te acerques al lÃ­mite â†’ punto 4.1 siguiente (verificaciÃ³n, gratis).

### 4.1 Cuando pases de ~100 profesionales: verificaciÃ³n de scopes sensibles

- Es **gratis** (no CASA, porque Calendar es scope sensible, no restringido):
  formulario + video demo + URL de privacy policy (~10 dÃ­as de revisiÃ³n).
- IMPORTANTE: hoy `googleAuth.js` pide el scope COMPLETO
  `https://www.googleapis.com/auth/calendar` (ver/editar/**borrar
  permanentemente** todo). Antes de verificar, cÃ¡mbialo a los scopes
  mÃ­nimos que el flujo necesita:
  - `https://www.googleapis.com/auth/calendar.events.owned` â†’ crear/editar/
    borrar eventos solo en SUS calendarios (lo que calendario.js usa hoy)
  - `https://www.googleapis.com/auth/calendar.freebusy` â†’ disponibilidad
  Revisores empujan contra el scope completo; con `calendar.events.owned`
  la pantalla de consentimiento tambiÃ©n queda mÃ¡s amable. Cambiar de scope =
  pedir a todos re-enlazar una vez (aviso en changelog).
- Privacidad policy y tÃ©rminos: requeridos por brand verification; puedes
  alojarlos gratis en la propia web del bot.
- Aprovechamiento mÃºltiple de tenants: la verificaciÃ³n es POR PROYECTO de
  Google Cloud. Un solo proyecto = una verificaciÃ³n para todas las empresas
  del despliegue (asÃ­ funciona hoy con GOOGLE_CLIENT_ID/SECRET en env).

## 4.2 Resumen de costos finales

| Concepto | Costo |
|---|---|
| Calls a Calendar API | $0 (cuotas generosas, cobro solo >1M/dÃ­a) |
| OAuth client + consent screen | $0 |
| Publicar en Production sin verificar | $0 (cap 100 usuarios) |
| VerificaciÃ³n de scopes sensibles | $0 (trÃ¡mite, ~10 dÃ­as) |
| CASA / security assessment | **NO aplica a Calendar** (solo Gmail/Drive) |

## 5. Alternativas SIN Google API (por si algÃºn cliente se niega)

Validadas contra el cÃ³digo actual; todas gratis:

1. **Link de eventos prellenado** (funciona HOY, sin cambiar una lÃ­nea del
   bot): tras confirmar la cita, el bot ademÃ¡s envÃ­a a WhatsApp del
   profesional un link tipo
   `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=YYYYMMDDTHHmmss/YYYYMMDDTHHmmss&details=...`
   El profesional lo abre y guarda el evento en SU calendario con un tap.
   LimitaciÃ³n: cancelar/reagendar despuÃ©s NO actualiza (no es sync).
2. **Archivo .ics**: el bot genera el .ics y lo manda como documento de
   WhatsApp. Misma limitaciÃ³n.
3. **iCal privado**: si un dÃ­a se quiere disponibilidad sin OAuth, el
   profesional comparte su "direcciÃ³n iCal secreta" una vez; el bot la
   descarga y la parsea. Complemento para freebusy sin API, pero mÃ¡s trabajo.

> Dado que la API es gratis y ya estÃ¡ integrada (write + freebusy + sync de
> cancelaciones/reagendados), la alternativa solo vale si expulsa un nicho
> especÃ­fico. La opciÃ³n 1 (link TEMPLATE) es la mÃ¡s barata de implementar y
> complementa â€”no reemplazaâ€” la integraciÃ³n actual.

