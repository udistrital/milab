# MILab

## Descripción General

MILab es la aplicación web para la gestión de paz y salvos en laboratorios de la Universidad Distrital. Permite automatizar consultas, registros, aprobaciones y generación de certificados para estudiantes, docentes, laboratoristas y coordinadores. El sistema integra autenticación, control de acceso, generación de PDFs, notificaciones por correo y seguridad avanzada.

## Release Notes

- Índice general: [RELEASE_NOTES.md](RELEASE_NOTES.md)
- Préstamos 2.0: [docs/release-notes-prestamos-2.0.md](docs/release-notes-prestamos-2.0.md)

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
- `APP_VERSION`: versión visible de la aplicación. Para este release de Préstamos usar `2.0.0`.
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

## Flujos del sistema

Resumen operativo de procesos y responsabilidades por rol:

- [docs/README-flujos-procesos.md](docs/README-flujos-procesos.md)

## SQL de base

La inicialización de base para recreación completa del entorno de pruebas usa cuatro scripts en secuencia:

1. [sql-scripts/db_structure.sql](sql-scripts/db_structure.sql)
2. [sql-scripts/db_seed_system.sql](sql-scripts/db_seed_system.sql) (o `db_seed.sql` si existe en el ambiente)
3. [sql-scripts/db_structure_prestamos.sql](sql-scripts/db_structure_prestamos.sql)
4. [sql-scripts/db_seed_prestamos.sql](sql-scripts/db_seed_prestamos.sql)

La recreación en CI y en reset manual de pruebas aplica los cuatro scripts de forma explícita con `ON_ERROR_STOP=1` para fallar temprano ante cualquier inconsistencia.

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
