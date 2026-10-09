# MILab

## Descripción General

MILab es la aplicación web para la gestión de paz y salvos en laboratorios de la Universidad Distrital. Permite automatizar consultas, registros, aprobaciones y generación de certificados para estudiantes, docentes, laboratoristas y coordinadores. El sistema integra autenticación, control de acceso, generación de PDFs, notificaciones por correo y seguridad avanzada.

**Versión en curso:** `2.7.0`

## Release Notes

- Índice general: [RELEASE_NOTES.md](RELEASE_NOTES.md)
- Préstamos 2.0: [docs/release-notes-prestamos-2.0.md](docs/release-notes-prestamos-2.0.md)

## Cambios recientes (2.7.0)

- **Edición de correos en dashboard:** el formulario libera el bloqueo de envío al terminar cada intento, incluidos los errores de validación o del servicio. Permite editar varias cuentas consecutivamente sin recargar la página y conserva la confirmación obligatoria y la protección contra envíos simultáneos.
- **Sesión expirada:** se destruye la sesión completa y se limpia su cookie. La navegación y los formularios HTML vuelven al inicio público `/milab/`; las llamadas AJAX/fetch reciben `401 SESSION_EXPIRED` y el cliente compartido vuelve al mismo inicio, sin dejar errores de autenticación dentro de los modales.
- **Estado de servicios académicos:** `/api/check-services` volvió a ser una ruta pública de solo lectura, sin exigir rol `admin`, para permitir monitoreo externo del estado de los servicios OATI.
- **Dashboard de monitoreo:** se separaron las tablas de "Certificados emitidos" de las nuevas tablas de "Estudiantes" y "Docentes registrados", incluyendo estado de cuenta, código y programa académico.
- **Base para el módulo de Capacitación y Certificación:** en la rama `modulo_capacitacion_certificacion` se agregaron los scripts [sql-scripts/db_structure_certificacion.sql](sql-scripts/db_structure_certificacion.sql) y [sql-scripts/db_seed_certificacion.sql](sql-scripts/db_seed_certificacion.sql) (tablas `cursos`, `curso_laboratorio` y `equipo_especializado`). El despliegue del entorno de pruebas en CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) ahora se ejecuta exclusivamente desde la rama `preprod`.

## Política de sesiones

- **Inactividad:** 30 minutos por defecto. Las peticiones de trabajo renuevan el plazo y la cookie (`rolling: true`). El cliente registra interacción real (teclado, escritura, puntero y desplazamiento) y notifica actividad al servidor como máximo una vez por minuto, para no cerrar la sesión mientras se llenan formularios.
- **Duración absoluta:** 8 horas desde la autenticación, incluso con actividad. Este límite exige iniciar sesión nuevamente; no se reinicia al entrar o salir de una impersonación.
- **Sin actividad:** no se envían notificaciones de actividad. Las consultas de estado, el monitoreo `check-services` y los recursos estáticos no renuevan el reloj de inactividad. El servidor valida ambos límites antes de ejecutar acciones; las comprobaciones del navegador no sustituyen esa validación.
- **Expiración:** se destruye todo el estado, incluido CSRF, perfil Microsoft pendiente e impersonación. Las respuestas HTML usan `303 /milab/`; AJAX recibe `401`, `code: SESSION_EXPIRED`, `redirect: /milab/` y `X-Session-Expired: 1`. El cliente compartido intercepta fetch/XHR y navega al inicio. Un `403` de permisos no cierra la sesión.
- **Varias pestañas:** al vencer el temporizador del cliente se consulta el estado real, sin renovarlo, para respetar actividad realizada desde otra pestaña. Al volver a una pestaña visible también se comprueba el estado.
- **Configuración fija:** los tiempos de 30 minutos de inactividad y 8 horas totales se definen en [src/libs/session-policy.js](src/libs/session-policy.js). No se leen del `.env`; `SESSION_IDLE_TIMEOUT_MS`, `SESSION_ABSOLUTE_TIMEOUT_MS` y el antiguo `SESSION_MAX_AGE_MS` no tienen efecto. Cambiar estos tiempos requiere modificar ese archivo y desplegar la aplicación.
- **Limitación operativa pendiente:** se mantiene `MemoryStore`. Un reinicio o cambio de proceso puede perder una sesión activa; varias instancias requieren almacenamiento compartido o afinidad de sesiones. Esta corrección no añade persistencia. Mantener un `SESSION_SECRET` estable y revisar `TRUST_PROXY`/cookies HTTPS también es necesario.

Referencias: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) propone habitualmente 15–30 minutos de inactividad para aplicaciones de menor riesgo y 4–8 horas totales para jornadas de oficina. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b/aal/#aal2reauth) recomienda en AAL2 no superar una hora de inactividad y 24 horas totales; no es un máximo universal ni una certificación AAL2 de MiLab. La política de 30 minutos/8 horas es la seleccionada para esta aplicación.

Implementación: [política](src/libs/session-policy.js), [control del servidor](src/routes/middlewares/session-expiration.js), [endpoints de estado/actividad](src/routes/api/session.js) y [cliente global](src/public/js/session-control.js).

## Consulta de multas SGA

- El servicio de deudores por ambiente se define en [src/config/sga-services.js](src/config/sga-services.js) (`SGA_DEBTORS_SERVICE_NAMES`) y no se lee del `.env` (`OATI_DEBT_SERVICE_NAME` no tiene efecto). Las consultas usan el gateway https de OATI con token OAuth, no el puerto 8282.
- `NODE_ENV=production` (o cualquier ambiente no listado como no productivo, incluido vacío) usa `servicios_academicos_produccion`; `dev`, `development`, `local`, `test`, `testing`, `staging` y `preprod` usan `academica_pruebas`.
- Solo se consulta: la actualización e inserción de deudas y la consulta de `periodo_academico` no están implementadas.
- Se consideran deudas activas las de `DEU_ESTADO = 1` o `2` (se aceptan valores numéricos o texto), excepto las de biblioteca: si el detalle reportado (`DEU_MATERIAL`) contiene "biblioteca" (sin distinguir mayúsculas ni tildes), la deuda se omite en todas las pantallas y no bloquea. El estado `3` (saldada) y los demás estados no se incluyen.
- Los datos de `academica_pruebas` y `servicios_academicos_produccion` son independientes: una deuda registrada en producción puede no existir en pruebas. Para diagnosticar faltantes, verificar tanto el servicio seleccionado por ambiente como el estado devuelto; una respuesta válida sin registros no es un error de conexión.
- La generación del paz y salvo de estudiante revisa las multas de MILab y SGA; si SGA no responde, el certificado no se genera.

## Correos de registro y sanciones

- Los correos de verificación de registro, bienvenida de laboratoristas y coordinadores, habilitación de cuentas desde el dashboard y activación de sanciones muestran el remitente **MILab — No responder** y una advertencia de uso exclusivo para notificaciones.
- Se conserva la dirección de envío actual; no se modifica la autenticación SMTP ni se configura una dirección `Reply-To`. El nombre visible y la advertencia no bloquean las respuestas: para impedir que lleguen al buzón se necesita una dirección institucional no-reply autorizada y reglas de recepción en el servidor de correo.
- Las notificaciones de activación de sanciones remiten al estudiante al laboratorio que reportó la sanción para aclarar su situación.

## Grillas de facultades y UAL

Las tablas de administración de facultades y UAL mantienen el desplazamiento horizontal dentro de la tabla, sin desplazar los filtros, el contador de registros ni la paginación. Los controles se distribuyen en varias filas en pantallas pequeñas y los paneles conservan el ancho disponible incluso con columnas extensas.

## Reporte de sanciones

El listado de sanciones aprovecha un ancho de hasta 1800 px y muestra código y documento en una misma columna, nombre de la persona, laboratorio, fecha y estado destacado. Las pestañas de estudiantes y docentes conservan sus acciones y muestran el número de sanciones del resultado actual. El identificador de sanción se muestra debajo del laboratorio; los nombres ausentes se indican explícitamente, sin consultar servicios externos al cargar el listado. El detalle y la exportación Excel conservan su información y permisos.

El filtro de sanciones permite acotar por ubicación según el rol: admin y coordinador general filtran por facultad, dependencia y UAL (coordinador general en solo lectura); el coordinador filtra por las dependencias y UAL a su cargo; el laboratorista, por las UAL asignadas. Los selectores se encadenan (facultad → dependencia → UAL) y el servidor rechaza valores fuera del alcance del usuario. La exportación Excel aplica los mismos filtros.

## Monitoreo de paz y salvo

El dashboard de monitoreo se organiza en dos pestañas: **Toda la plataforma** (fichas de indicadores al inicio, evolución del indicador seleccionado y gráficas de nuevos registros de los últimos 12 meses, usuarios por tipo, estado de cuentas académicas, estudiantes por programa y laboratoristas activos, todas limitadas al alcance del rol, con su detalle) y **Paz y salvos**, la única pestaña con indicadores de sanciones, reclamaciones y paz y salvos. En **Toda la plataforma**, el administrador y el coordinador general ven además la **cobertura operativa** (UAL activas con y sin laboratorista por facultad, laboratoristas y coordinadores por facultad, facultades sin coordinador y monitores que vencen en 30 días). Solo el administrador ve la **actividad en la plataforma**, calculada sobre la tabla `log`: acciones por mes, acciones más frecuentes, acciones por tipo de usuario, actividad por día de la semana y usuarios más activos. Si alguno de estos cálculos falla, el dashboard se muestra sin ese bloque. La pestaña activa se conserva en la URL (`#paz-y-salvos`). En el detalle de usuarios, el administrador gestiona cada cuenta con iconos de acción (editar usuario, editar correo, activar/inactivar e impersonar) en una columna fija a la derecha.

La pestaña **Paz y salvos** se calcula sobre el estado actual y el alcance de cada rol, sin cambios de base de datos:

- **Todos los roles:** personas bloqueadas (sanciones `ACTIVA`, `Pendiente` o `POR SALDAR`), sanciones pendientes de autorización (por crear y por saldar), sanciones abiertas con más de 90 días, antigüedad de las sanciones abiertas, bloqueos originados en incidencias de préstamo y dónde se concentran (UAL; facultades para admin y coordinador general; dependencias para coordinador).
- **Reclamaciones:** recibidas, sin respuesta, procede/no procede y tiempo promedio de respuesta. El laboratorista ve las que debe responder.
- **Admin, coordinador general y coordinador:** paz y salvos expedidos (vigentes, vencidos, emitidos en el mes, autogestión frente a personal y motivos más frecuentes).
- Antigüedad, concentración de bloqueos, reclamaciones y paz y salvos expedidos se muestran como gráficas (Chart.js), que se dibujan al abrir la pestaña y se adaptan al tema claro u oscuro.
- Las tarjetas enlazan al flujo de cada rol: listado de sanciones, aprobación de sanciones (coordinador) o bandeja de reclamaciones (admin y laboratorista).

El coordinador general accede al dashboard con vista global de solo consulta. Los totales y series ya no se truncan; las tablas de detalle envían los 500 registros más recientes e indican el total. El coordinador ve los certificados de su facultad según el programa codificado en el código estudiantil; cuando no hay código de 11 dígitos se usa el nombre del programa.

## Acciones en las grillas

Las acciones de las tablas se presentan como iconos uniformes, sin texto visible ni botones rectangulares y sin saltos de línea dentro de la celda de acciones. Conservan botones y enlaces semánticos, etiquetas accesibles, descripciones al pasar el cursor, navegación con teclado, formularios, permisos y confirmaciones. El componente compartido [grid-actions.js](src/public/js/grid-actions.js) también actualiza filas dinámicas y paginadas, sin sustituir los controles ni sus eventos. No afecta filtros, botones fuera de tablas ni controles para expandir texto. Las columnas de detalle y operaciones se identifican como **Acciones**; los controles de envío bloqueados muestran un indicador de procesamiento.

## Arquitectura y Estructura del Proyecto

- **Backend:** Node.js + Express
- **Frontend:** EJS (plantillas), CSS, JS estático
- **Base de datos:** PostgreSQL (modelos definidos en sql-scripts/db.sql)
- **Despliegue:** Docker y Docker Compose
- **Seguridad:** Helmet, rate limiting, validaciones, sesiones
- **Autenticación:** Passport (Google, Microsoft), JWT, reCAPTCHA
- **Notificaciones:** Nodemailer
- **Generación de documentos:** PDFKit, QRCode
- **Rutas:** Separadas en módulos para API y web
- **Middlewares:** Seguridad, limitador, logger
- **Configuración:** Variables de entorno en src/config/config.js

## Componentes Principales

- **src/app.js:** Configuración principal de Express, middlewares, sesiones, seguridad.
- **src/libs/db.js:** Conexión a PostgreSQL mediante Pool.
- **src/routes/api/**: Endpoints RESTful para operaciones de paz y salvo, generación de PDFs, consultas, registro, login, recuperación de contraseña, envío de emails, validación de QR, dashboard, logs, etc.
- **src/routes/web/**: Rutas web para vistas EJS.
- **views/**: Plantillas EJS para interfaz de usuario.
- **public/**: Archivos estáticos (CSS, JS, imágenes, fuentes).
- **sql-scripts/**: Scripts para creación y actualización de base de datos.

## Principales Clases y Métodos

- **Express Routers:** Modularización de endpoints (ver src/routes/api/index.js).
- **PDF Generation:** Métodos en generatepdf.js y generate_cert_estudiante_lab.js para crear certificados.
- **Autenticación:** Métodos en login.js, passport.js, y middlewares de seguridad.
- **Consultas:** Métodos para obtener datos de estudiantes, docentes, multas, logs, etc.
- **Registro:** Métodos para registrar usuarios, laboratoristas, coordinadores, y laboratorios.
- **Validación:** Express-validator, reCAPTCHA, y validaciones de entrada.

## Conexiones y Dependencias

- **PostgreSQL:** Conexión gestionada por src/libs/db.js y configurada en src/config/config.js.
- **Docker Compose:** Orquestación de servicios (app y base de datos) en docker-compose.yml.
- **Correo:** Nodemailer para notificaciones y recuperación de contraseña.
- **PDF y QR:** PDFKit y qrcode para generación de documentos y códigos.

## Lenguaje y Librerías

- **Node.js** (JavaScript)
- **Express**
- **EJS**
- **PostgreSQL**
- **Passport**
- **Helmet**
- **Nodemailer**
- **PDFKit**
- **QRCode**
- **dotenv**
- **express-rate-limit**
- **express-validator**

## Step by Step

Paso a Paso para el despliegue de la aplicación en Docker.

1. Una vez descargado, ubicarse en la raíz del proyecto por medio de la terminal.
2. Ejecutar el siguiente comando para la creación de la imagen de docker:
   `docker build -t milabud .`
3. Verificar que se haya creado correctamente la imagen (`docker image ls`).
4. Antes de desplegar los servicios del docker compose, verificar que el archivo docker-compose.yml esté correctamente configurado.
   NOTA: Verificar los parámetros correspondientes con traefik.
5. Ejecutar el siguiente comando:
   `docker compose up -d`
6. Verificar que la aplicación se esté ejecutando correctamente.

## Primeros pasos

Para facilitar el inicio con el proyecto, aquí tienes una lista de pasos recomendados.

¿Ya tienes experiencia? Simplemente edita este README.md y adáptalo a tus necesidades.

## Agrega tus archivos

## Integra con tus herramientas

## Colabora con tu equipo

## Prueba y despliega

Utiliza la integración continua incorporada en GitLab.

## Uso

Incluye ejemplos y muestra el resultado esperado si es posible. Es útil tener el ejemplo más pequeño posible de uso, y puedes proporcionar enlaces a ejemplos más sofisticados si son demasiado largos para incluirlos aquí.

## Soporte

Indica dónde pueden acudir las personas para obtener ayuda. Puede ser una combinación de un sistema de issues, sala de chat, correo electrónico, etc.

## Hoja de ruta

Si tienes ideas para futuras versiones, es buena idea listarlas aquí.

## Contribuciones

Indica si aceptas contribuciones y cuáles son los requisitos para aceptarlas.

Para quienes quieran hacer cambios en el proyecto, es útil tener documentación sobre cómo empezar. Quizás haya un script que deban ejecutar o variables de entorno que deban configurar. Haz estos pasos explícitos. Estas instrucciones también pueden ser útiles para tu yo del futuro.

También puedes documentar comandos para lint o pruebas. Estos pasos ayudan a asegurar la calidad del código y reducir la probabilidad de que los cambios rompan algo. Tener instrucciones para ejecutar pruebas es especialmente útil si requiere configuración externa, como iniciar un servidor Selenium para pruebas en navegador.

## Análisis local

El pipeline de calidad usa Node.js 25 y ejecuta formato, ESLint, auditoría de dependencias y la suite automatizada de pruebas.

Para ejecutar el mismo análisis localmente con Docker:

`npm run analyze:local`

Si ya tienes Node.js 25 instalado y un `package-lock.json` actualizado, también puedes usar:

`npm run ci:check`

Para ejecutar la misma puerta de pruebas que usa CI:

`npm test`

`npm test` ahora agrega:

- `npm run test:unit`
- `npm run test:integration`

## Análisis local con SonarQube

`preprod` ahora incluye `sonar-project.properties` en la raíz y un runner local basado en contenedores.

Para levantar SonarQube local, generar un token automáticamente y ejecutar el escaneo del proyecto:

`npm run sonar:local`

La interfaz queda disponible en:

`http://localhost:9000`

Credenciales locales por defecto del bootstrap:

- usuario: `admin`
- contraseña: `admin_milab_local`

Si necesitas cambiar la contraseña local del contenedor antes del bootstrap, puedes hacerlo así:

`SONARQUBE_LOCAL_PASSWORD='tu_clave_local' npm run sonar:local`

Para detener y eliminar el contenedor local de SonarQube:

`npm run sonar:stop`

Notas operativas:

- El script usa las imágenes `sonarqube:community` y `sonarsource/sonar-scanner-cli:5.0` por compatibilidad con SonarQube 9.9 LTS local.
- Mantiene volúmenes Docker con estado local para no reinicializar SonarQube en cada corrida.
- El análisis sirve para detectar bugs, code smells y hallazgos de seguridad o security hotspots reportados por SonarQube en esta edición.

## Variables de entorno relevantes

- `APP_BASE_URL`: URL base pública de la aplicación.
- `APP_VERSION`: versión visible de la aplicación. Para este release usar `2.7.0`.
- `RECAPTCHA_SITE_KEY`: llave pública de reCAPTCHA.
- `RECAPTCHA_SECRET_KEY`: llave privada de reCAPTCHA.
- `REGISTRATION_TOKEN_SECRET`: secreto usado para firmar enlaces de registro de coordinadores y laboratoristas. Debe definirse por ambiente y rotarse fuera de desarrollo local.
- `LOG_LEVEL`: nivel global del logger (`debug`, `info`, `warn`, `error`). Valor recomendado por defecto: `info`.
- `LOG_REQUESTS`: activa o desactiva el log transversal de requests HTTP. Por defecto: `true`.
- `LOG_REQUEST_SAMPLE_RATE`: muestreo para requests exitosos entre `0` y `1`. Errores y requests lentos siempre se registran.
- `LOG_SLOW_REQUEST_MS`: umbral en milisegundos para elevar un request lento a nivel `warn`. Por defecto: `1000`.
- `LOG_DESTINATION`: destino del logger principal. Valores soportados: `stdout` o `file`.
- `LOG_FILE_PATH`: ruta del archivo cuando `LOG_DESTINATION=file`.
- `LOG_BRIDGE_CONSOLE`: si está en `true`, los `console.log` existentes pasan por el logger central. `console.log` se trata como `debug`, `console.warn` como `warn` y `console.error` como `error`.
- `SECURITY_LOG_TO_FILE`: permite conservar el archivo `security.log` además del logger central. Por defecto: `true`.
- `SECURITY_LOG_FILE`: ruta del archivo de eventos de seguridad si se quiere persistencia separada.
- `COORDINATOR_PENDING_NOTIFICATIONS_ENABLED`: habilita o deshabilita el envio periodico de correos a coordinadores con pendientes por atender. Por defecto: `true`.
- `COORDINATOR_PENDING_NOTIFICATIONS_CRON`: expresion cron para la frecuencia del envio. Por defecto: `0 8 * * 3` (cada miercoles a las 08:00, hora local del servidor).

## Flujos del sistema

Resumen operativo de procesos y responsabilidades por rol:

- [docs/README-flujos-procesos.md](docs/README-flujos-procesos.md)

## SQL de base

La inicialización de base para recreación completa del entorno de pruebas usa estos scripts en secuencia:

1. [sql-scripts/db_structure.sql](sql-scripts/db_structure.sql)
2. [sql-scripts/db_seed_system.sql](sql-scripts/db_seed_system.sql)
3. [sql-scripts/db_structure_prestamos.sql](sql-scripts/db_structure_prestamos.sql)
4. [sql-scripts/db_seed_prestamos.sql](sql-scripts/db_seed_prestamos.sql)

La recreación en CI y en reset manual de pruebas aplica los cuatro scripts base de forma explícita con `ON_ERROR_STOP=1` para fallar temprano ante cualquier inconsistencia.

Adicionalmente, cuando la rama es `modulo_capacitacion_certificacion`, se aplican estos dos scripts opcionales (dependen de `facultad`, `ual` y `equipo` ya creados por los scripts anteriores):

5. [sql-scripts/db_structure_certificacion.sql](sql-scripts/db_structure_certificacion.sql)
6. [sql-scripts/db_seed_certificacion.sql](sql-scripts/db_seed_certificacion.sql)

El despliegue de pruebas en CI se ejecuta únicamente desde `preprod`.

## Reset completo en EC2 (pruebas)

El entorno de pruebas se despliega en el host remoto con Compose en [home/ubuntu/prod/docker-compose.yml](home/ubuntu/prod/docker-compose.yml) y código en [opt/milab](opt/milab).

Puntos operativos aplicados en el flujo actual:

1. El archivo de entorno operativo es [opt/.env](opt/.env) y se enlaza a [opt/milab/Docker/.env](opt/milab/Docker/.env).
2. Para recrear desde cero se eliminan `milabud`, `dbpostgres`, `dbseed` y el volumen `prod_milab_db_data`.
3. Se levanta `dbpostgres`, se espera `pg_isready`, se aplican los 4 scripts SQL en secuencia y luego se reconstruye `milabud`.
4. La validación mínima post-seed comprueba que exista el menú principal de préstamos.

Script de apoyo:

- [scripts/reset-ec2-test-stack.sh](scripts/reset-ec2-test-stack.sh)

Pipeline relacionado:

- [.github/workflows/ci.yml](.github/workflows/ci.yml)

## Logging

La aplicación ahora usa un logger estructurado centralizado con niveles y un middleware transversal para resumir cada request dinámico.

- Los requests HTTP se registran con `requestId`, estado y duración.
- Los errores HTTP y los requests lentos suben automáticamente a `warn` o `error`.
- Los `console.log` heredados no desaparecen, pero quedan gobernados por el nivel del logger para evitar ruido en producción.
- Los eventos de seguridad siguen pudiendo persistirse en archivo, pero también salen por el logger central.

### Dónde se configura

En el entorno local con Docker, la configuración activa está en `Docker/.env`.

Variables recomendadas hoy:

```env
LOG_LEVEL=info
LOG_REQUESTS=true
LOG_REQUEST_SAMPLE_RATE=0.2
LOG_SLOW_REQUEST_MS=1000
LOG_DESTINATION=stdout
LOG_BRIDGE_CONSOLE=true
SECURITY_LOG_TO_FILE=true
```

Si la aplicación se ejecuta fuera de Docker, primero intenta leer `.env` en la raíz del proyecto. Si ese archivo no existe, toma `Docker/.env` como respaldo.

### Qué hace cada nivel

- `debug`: muestra trazas de desarrollo y también los `console.log` heredados puenteados al logger.
- `info`: muestra eventos normales de negocio y arranque. Es el valor recomendado para desarrollo estable.
- `warn`: deja visibles degradaciones, requests lentos, `404`, validaciones problemáticas y eventos no fatales.
- `error`: muestra solo fallos relevantes.

### Cómo controlar el volumen

El sistema está pensado para no disparar una escritura inmanejable por cada detalle.

- Los requests exitosos se muestrean con `LOG_REQUEST_SAMPLE_RATE`.
- Los requests con error (`4xx` y `5xx`) sí se registran siempre.
- Los requests lentos también se registran siempre y suben a `warn` cuando superan `LOG_SLOW_REQUEST_MS`.
- Los assets estáticos no generan la misma traza transversal que una ruta dinámica, para evitar ruido innecesario.

Ejemplos útiles:

- Desarrollo con más detalle:

```env
LOG_LEVEL=debug
LOG_REQUEST_SAMPLE_RATE=1
```

- Operación diaria local con ruido controlado:

```env
LOG_LEVEL=info
LOG_REQUEST_SAMPLE_RATE=0.2
```

- Operación más silenciosa:

```env
LOG_LEVEL=warn
LOG_REQUEST_SAMPLE_RATE=0.05
```

### Qué información sale en un log HTTP

Cada request dinámico puede incluir campos como:

- `requestId`: identificador único por request.
- `method`: método HTTP.
- `path`: ruta solicitada.
- `statusCode`: código de respuesta.
- `durationMs`: duración total.
- `ip`: IP observada por Express.
- `sessionId`: sesión enmascarada cuando existe.

Ejemplo real de salida:

```json
{
  "level": 30,
  "time": "2026-04-09T21:07:41.166Z",
  "service": "milabud",
  "requestId": "1ea2d533-7921-410a-b9a2-9ac92b04a001",
  "component": "http",
  "event": "request_completed",
  "method": "HEAD",
  "path": "/milab/forgot_password/test-token",
  "statusCode": 404,
  "durationMs": 6.7,
  "msg": "HTTP request completed"
}
```

### Logging de seguridad

Los eventos de seguridad usan la misma base central de logging, pero además pueden mantenerse en archivo aparte.

- `SECURITY_LOG_TO_FILE=true`: conserva el archivo `security.log` además de la salida normal del contenedor.
- `SECURITY_LOG_FILE`: permite cambiar la ruta de ese archivo si se necesita persistencia separada.

### Logging heredado

El proyecto todavía tiene muchos `console.log`, `console.warn` y `console.error` en rutas antiguas. Para no romper el código existente, esos mensajes pasan por el logger central cuando `LOG_BRIDGE_CONSOLE=true`.

El comportamiento es este:

- `console.log` se trata como `debug`.
- `console.info` se trata como `info`.
- `console.warn` se trata como `warn`.
- `console.error` se trata como `error`.

Esto permite una migración gradual: el sistema ya es transversal hoy, y luego se pueden reemplazar los `console.*` más ruidosos por logs semánticos con más contexto.

### Recomendación operativa

Para este proyecto, una configuración razonable es:

- `LOG_LEVEL=info` para no perder eventos de negocio importantes.
- `LOG_REQUEST_SAMPLE_RATE=0.2` para no registrar cada request exitoso.
- `LOG_SLOW_REQUEST_MS=1000` para detectar cuellos de botella sin exceso de ruido.
- `SECURITY_LOG_TO_FILE=true` si quieres conservar auditoría separada de eventos sensibles.

Después de cambiar estas variables, reinicia la stack Docker para aplicar la nueva configuración.

## Autores y agradecimientos

Muestra tu agradecimiento a quienes han contribuido al proyecto.

## Licencia

Para proyectos de código abierto, indica cómo está licenciado.

## Estado del proyecto

Si te has quedado sin energía o tiempo para tu proyecto, pon una nota en la parte superior del README indicando que el desarrollo se ha ralentizado o se ha detenido por completo. Alguien puede optar por hacer un fork del proyecto o ofrecerse como mantenedor, permitiendo que el proyecto siga adelante. También puedes hacer una solicitud explícita de mantenedores.

## Catálogo administrativo de sanciones

El menú **Configuración → Catálogo de sanciones** (`/milab/api/admin/sanciones`)
está disponible exclusivamente para administradores. Permite agregar y editar
el nombre corto y la descripción de cada categoría, así como inactivarla o
reactivarla. Las acciones de la grilla usan los iconos compartidos.

Antes de desplegar esta versión, ejecuta el script único
[`sql/20261008_hotfix_sanciones_dependencias.sql`](sql/20261008_hotfix_sanciones_dependencias.sql)
en la base de datos de MILab, con permisos para el esquema `milab`. Incluye
el catálogo y las reclamaciones de sanciones y la jerarquía
`dependencia_facultad`. Por ejemplo:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/20261008_hotfix_sanciones_dependencias.sql
```

Hasta esta versión las categorías eran una lista fija en
`src/views/partials/multa-options.ejs`; la tabla `multa` solo guarda el texto
en `cat_multa`. El script crea y carga el catálogo con esas 13 categorías,
agrega la opción al menú y concede acceso al rol `admin`. Es transaccional y puede
ejecutarse nuevamente sin reactivar ni sobrescribir categorías modificadas.
Los scripts de estructura y semillas del sistema también incluyen el catálogo
y el menú para instalaciones nuevas. No es necesario volver a ejecutar toda
la semilla para actualizar una instalación existente.

Los formularios de registro de estudiantes y docentes y la edición del listado
consultan las categorías activas. El servidor rechaza categorías inexistentes
o inactivas para nuevos registros. Editar o inactivar una categoría no reescribe
las sanciones históricas: al editar una sanción asignada puede conservarse su
categoría original o elegirse una categoría activa. Los cambios administrativos
quedan registrados en `log` en la misma transacción que el cambio del catálogo.
Si falta la migración, se informa el error de carga; no se usa un catálogo
estático alternativo.

## Facultades y dependencias

La tabla `facultad` se renombró a `dependencia_facultad`. Su clave primaria es
`dependencia_facultad_id`. Las tablas hijas (`ual`, `coordinador_facultad`,
`config_facultad_multas`, etc.) conservan su columna `facultad_id`, que ahora
referencia `dependencia_facultad`. La columna `padre_id` define dos niveles:

- `padre_id` NULL: facultad.
- `padre_id` con el id de una facultad: dependencia de esa facultad.

Un trigger impide un tercer nivel: el padre debe ser una facultad, y una
facultad que tiene dependencias no puede tener padre. Tampoco se puede eliminar
una facultad con dependencias. La vista `coordinador_facultad_alcance` amplía
cada asignación de coordinador a las dependencias de esa facultad. La usan las
consultas de alcance, de modo que un coordinador de facultad gestiona también
las UAL de sus dependencias.

Al ejecutar el script único, todos los registros existentes quedan como
facultades. Desde **Facultades** (`/milab/api/facultad`) el administrador:

- abre las dependencias de cada facultad y luego sus UAL;
- usa **Editar** para asignar una dependencia existente a su facultad;
- agrega facultades, dependencias y UAL con el botón del encabezado de cada
  grilla.
- en las UAL de una dependencia ve cuántos laboratoristas tiene cada UAL y
  quiénes son, y los coordinadores de la dependencia, incluidos los heredados
  de su facultad.

Las UAL que siguen colgando directamente de una facultad se señalan para
moverlas a una dependencia. La configuración de multas y el acceso a préstamos
siguen siendo por registro; las dependencias no los heredan de su facultad.

## Reclamaciones de sanciones

El mismo script único
[`sql/20261008_hotfix_sanciones_dependencias.sql`](sql/20261008_hotfix_sanciones_dependencias.sql)
crea la tabla `reclamacion_sancion`, sus restricciones y los menús y permisos.
Para instalaciones nuevas, `sql-scripts/db_structure.sql` y
`sql-scripts/db_seed_system.sql` ya incluyen estos cambios.

- **Estudiantes:** Cuenta → Mis sanciones (`/milab/api/sanciones/mis-sanciones`),
  también accesible desde el perfil mediante **Mis sanciones y reclamaciones**.
  El historial muestra todas sus sanciones. Solo las activas sin reclamación
  permiten enviar un texto de 1 a 500 caracteres, con confirmación. No se permite
  editar, reabrir ni enviar una segunda reclamación para la misma sanción.
- **Laboratoristas:** Sanciones → Reclamaciones. El responsable registrado en
  la sanción recibe el caso, un aviso en MILab y un correo. Puede enviar una
  única respuesta de 1 a 500 caracteres, indicando `PROCEDE` o `NO_PROCEDE`.
  No se modifica automáticamente el estado de la sanción.
- **Seguimiento:** el estudiante recibe un aviso de respuesta y puede marcarla
  como leída. La reclamación y la respuesta siguen disponibles al saldar la
  sanción. «Ver detalle» del listado de sanciones también carga ese historial,
  sujeto al alcance existente de cada usuario (facultad o UAL).
- **Administración:** puede consultar todas las reclamaciones y reasignar las
  pendientes a un laboratorista activo, sin cambiar el creador de la sanción.
  Un responsable inactivo se señala explícitamente. Coordinación general tiene
  acceso de lectura; no puede responder ni reasignar.
- **Correos:** la activación de sanciones estudiantiles incluye el enlace a
  Mis sanciones. Los enlaces requieren autenticación y no conceden permisos.
  Usa `APP_BASE_URL` con la URL pública completa de MILab para los enlaces.
  Los avisos usan la infraestructura existente de `email_notification`.
  Un fallo de correo no revierte la reclamación/respuesta: se conserva en MILab
  y se muestra una advertencia. No hay reintentos automáticos de esos avisos.
- **Integridad:** una restricción única por sanción y operaciones condicionales
  impiden dobles envíos y respuestas simultáneas. Los cambios y su auditoría se
  guardan en una misma transacción. La impersonación no permite presentar,
  responder ni reasignar reclamaciones. Este canal no gestiona multas de SGA
  ni reclamaciones de docentes.
