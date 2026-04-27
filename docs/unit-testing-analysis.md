# Diagnóstico De Pruebas Unitarias

## Objetivo

Este documento propone una estrategia realista para introducir pruebas automatizadas en MiLab.

No busca únicamente responder "qué probar", sino también "qué tan testeable es hoy el código", "qué dependencias externas hay que aislar" y "en qué orden conviene invertir el esfuerzo".

## Resumen Ejecutivo

El proyecto hoy no tiene una suite formal de pruebas unitarias ni de integración. Tampoco tiene un framework de pruebas declarado en [package.json](package.json). Existe una validación manual o semiautomatizada en [scripts/validate-milab-flows.js](scripts/validate-milab-flows.js), pero no reemplaza una estrategia de pruebas mantenible.

La recomendación es introducir pruebas en tres niveles:

1. Pruebas unitarias puras para helpers y decisiones de negocio sin IO.
2. Pruebas de rutas pequeñas o de middleware con dependencias mockeadas.
3. Pruebas de integración selectivas para flujos críticos, sin intentar cubrir todo desde el primer sprint.

El primer objetivo no debe ser alcanzar alta cobertura, sino crear una red mínima de seguridad alrededor de invariantes críticos: autenticación, permisos, recuperación de contraseña, armado de URLs y envío de correo.

## Estado Actual De Testeabilidad

### Lo que sí favorece pruebas rápidas

Hay varios módulos con lógica relativamente pura o con límites claros:

- [src/libs/account-email.js](src/libs/account-email.js)
- [src/libs/app-url.js](src/libs/app-url.js)
- [src/libs/certificate-email.js](src/libs/certificate-email.js)
- [src/libs/faculty-scope.js](src/libs/faculty-scope.js)
- [src/libs/registration-token.js](src/libs/registration-token.js)
- [src/routes/middlewares/auth.js](src/routes/middlewares/auth.js)
- [src/routes/middlewares/security-logger.js](src/routes/middlewares/security-logger.js)

Esos archivos permiten empezar a generar valor sin necesidad de refactorizar toda la aplicación.

### Lo que hoy dificulta las pruebas

Hay varias rutas con mucha lógica acoplada a IO externo y a variables de entorno. Los casos más visibles son:

- [src/routes/api/login.js](src/routes/api/login.js)
- [src/routes/api/send_email.js](src/routes/api/send_email.js)
- [src/routes/api/register_labs.js](src/routes/api/register_labs.js)
- [src/routes/api/registro_coordinador.js](src/routes/api/registro_coordinador.js)
- [src/routes/api/get-data1.js](src/routes/api/get-data1.js)
- [src/routes/api/get-data2.js](src/routes/api/get-data2.js)
- [src/routes/api/get-data.js](src/routes/api/get-data.js)
- [src/routes/api/get-data-docente.js](src/routes/api/get-data-docente.js)

Los problemas más frecuentes son estos:

1. La misma función mezcla validación, acceso a base de datos, llamadas HTTP externas, armado de respuesta HTML y efectos secundarios.
2. Se usan dependencias globales importadas directamente, por ejemplo `pool`, `axios`, `fetch`, `transporter`, `jwt` o `process.env`.
3. [src/app.js](src/app.js) crea la app y llama `listen` en el mismo archivo, lo que dificulta pruebas de integración con `supertest`.
4. Hay repetición de lógica de reCAPTCHA, lookup de cuentas y composición de correo en distintas rutas.

## Dependencias Externas A Aislar En Pruebas

Para que las pruebas sean deterministas, estas dependencias deben simularse o encapsularse:

### Base de datos PostgreSQL

Uso extendido de [src/libs/db.js](src/libs/db.js) a través de `pool.query`.

Impacto:

- Afecta autenticación, recuperación, dashboards, sanciones, registro de usuarios, actualización de correos y administración operativa.

Recomendación:

- Para pruebas unitarias: mock de `pool.query` o de funciones de repositorio extraídas.
- Para integración: base efímera o contenedor dedicado solo en algunos flujos críticos.

### SMTP y transporte de correo

Uso de [src/libs/mail.js](src/libs/mail.js) y `transporter.sendMail` en:

- [src/routes/api/send_email.js](src/routes/api/send_email.js)
- [src/routes/api/register.js](src/routes/api/register.js)
- [src/routes/api/registro_coordinador.js](src/routes/api/registro_coordinador.js)
- [src/routes/api/register_labs.js](src/routes/api/register_labs.js)
- [src/libs/certificate-email.js](src/libs/certificate-email.js)

Recomendación:

- No probar contra SMTP real.
- Mockear `sendMail` y validar `subject`, `to`, flags de override y enlaces generados.

### reCAPTCHA y servicios HTTP externos

Hay verificación remota vía Google en:

- [src/routes/api/login.js](src/routes/api/login.js)
- [src/routes/api/get-data1.js](src/routes/api/get-data1.js)
- [src/routes/api/get-data2.js](src/routes/api/get-data2.js)
- [src/routes/api/consulta-invit.js](src/routes/api/consulta-invit.js)

Además, varias rutas consultan servicios académicos externos vía `axios.get`.

Recomendación:

- Extraer un helper común de verificación reCAPTCHA.
- Mockear `fetch` o `axios` en pruebas unitarias.
- No depender de respuestas reales de red.

### JWT y secretos de entorno

Uso en:

- [src/routes/api/send_email.js](src/routes/api/send_email.js)
- [src/routes/api/register_labs.js](src/routes/api/register_labs.js)
- [src/routes/api/registro_coordinador.js](src/routes/api/registro_coordinador.js)
- [src/libs/registration-token.js](src/libs/registration-token.js)

Recomendación:

- Probar expiración, rechazo y fallback de secreto con secretos controlados en entorno de prueba.

### Sistema de archivos

Uso visible en:

- [src/libs/certificate-email.js](src/libs/certificate-email.js)
- [src/routes/middlewares/security-logger.js](src/routes/middlewares/security-logger.js)
- [src/libs/logger.js](src/libs/logger.js)

Recomendación:

- Mockear `fs.existsSync`, `fs.appendFile`, `fs.readFileSync` y evitar tocar disco real salvo pruebas específicas del logger.

## Qué Tipo De Suite Conviene Montar

## Opción recomendada

Usar el runner nativo `node:test` y sumar `supertest` para pruebas HTTP de rutas.

Razones:

1. El proyecto ya corre en Node 20.
2. Reduce dependencia inicial y complejidad de configuración.
3. Permite empezar con pruebas unitarias puras y luego crecer a pruebas de integración.
4. Es suficiente para la etapa inicial de deuda técnica.

## Dependencias sugeridas

- `supertest` para probar endpoints Express sin levantar un servidor real.
- Eventualmente `c8` o equivalente para cobertura, pero no es imprescindible en la primera fase.

## Estructura sugerida

Una estructura razonable sería:

- `tests/unit/libs/*.test.js`
- `tests/unit/middlewares/*.test.js`
- `tests/unit/routes/*.test.js`
- `tests/integration/*.test.js`

## Superficie De Prueba Prioritaria

## Prioridad 1: invariantes puros y helpers críticos

Estas pruebas deberían implementarse primero porque tienen alto valor y bajo costo.

### [src/libs/account-email.js](src/libs/account-email.js)

Casos sugeridos:

1. `normalizeInstitutionalEmail` normaliza espacios y mayúsculas.
2. `isInstitutionalEmail` acepta solo correos `@udistrital.edu.co`.
3. `isUniqueViolation` detecta error `23505`.
4. `normalizeLogDocument` devuelve `null` para identificadores alfanuméricos y preserva documentos numéricos válidos.

Valor:

- Protege reglas de correo institucional y auditoría, ya afectadas por bugs reales.

### [src/libs/app-url.js](src/libs/app-url.js)

Casos sugeridos:

1. Construcción de URL con `APP_BASE_URL` explícito.
2. Fallback correcto entre desarrollo y producción.
3. Eliminación de slash final duplicado.
4. Normalización de rutas con y sin slash inicial.

Valor:

- Ya hubo incidentes con links de recuperación y registro.

### [src/libs/registration-token.js](src/libs/registration-token.js)

Casos sugeridos:

1. Devuelve el secreto configurado.
2. Comportamiento con secreto ausente.

Valor:

- Es pequeño, fácil de testear y reduce riesgo en rutas de token.

### [src/libs/certificate-email.js](src/libs/certificate-email.js)

Casos sugeridos:

1. `resolveCertificateRecipient` aplica override cuando existe variable de entorno.
2. `sendCertificateEmail` devuelve `missing-recipient` cuando no hay correo.
3. `sendCertificateEmail` falla si el PDF no existe.
4. `buildCertificateEmailFeedback` construye mensajes correctos para envío normal, override y omisión.
5. `buildCertificateEmailFailureFeedback` devuelve warning consistente.

Valor:

- Cubre una de las funcionalidades que pediste explícitamente: envío de correo.

### [src/libs/faculty-scope.js](src/libs/faculty-scope.js)

Casos sugeridos:

1. `normalizeAcademicText` elimina tildes y normaliza espacios.
2. `canonicalizeFacultyName` mapea aliases a nombres oficiales.
3. `resolveAcademicFacultyName` resuelve carreras conocidas.
4. `resolveCoordinatorScope` devuelve facultades únicas y usa fallback si no hay filas en `coordinador_facultad`.

Valor:

- Protege reglas de negocio y permisos por facultad.

### [src/routes/middlewares/auth.js](src/routes/middlewares/auth.js)

Casos sugeridos:

1. `requireUser` bloquea sesión ausente.
2. `requireRoles` permite y deniega roles correctamente.
3. `requireJsonRoles` devuelve `401` o `403` según corresponda.

Valor:

- Muy alta relación valor/esfuerzo.

## Prioridad 2: middlewares y utilidades con IO controlado

### [src/routes/middlewares/security-logger.js](src/routes/middlewares/security-logger.js)

Casos sugeridos:

1. Detecta correo no institucional.
2. Detecta contraseña débil.
3. Registra eventos cuando una vista renderiza mensajes sensibles.
4. `getSecurityLogs` maneja ausencia de archivo y entradas inválidas.

Valor:

- Es lógica de seguridad transversal y fácil de romper en cambios futuros.

### [src/libs/mail.js](src/libs/mail.js)

Casos sugeridos:

1. `applyRecipientOverride` reescribe `to`, limpia `cc` y `bcc`, y preserva destinatarios originales en header.
2. `buildTransportConfig` usa `EMAIL_SERVICE` si existe.
3. `buildTransportConfig` usa `host`, `port` y `secure` cuando no hay servicio.

Valor:

- Alta utilidad para asegurar el comportamiento de override en ambientes de prueba.

### [src/libs/logger.js](src/libs/logger.js)

Casos sugeridos:

1. `parseBoolean` y `parseNumber`.
2. `sanitizeValue` oculta claves sensibles.
3. `maskIdentifier` enmascara correctamente.

Valor:

- Es transversal y relativamente puro.

## Prioridad 3: primeras pruebas de rutas

Estas ya no son unitarias puras, pero sí deberían entrar en la primera ola porque cubren los flujos básicos que pediste.

### Login

Archivo: [src/routes/api/login.js](src/routes/api/login.js)

Casos sugeridos:

1. Rechaza datos inválidos.
2. Rechaza reCAPTCHA fallido.
3. Rechaza credenciales inválidas.
4. Redirige a cambio de contraseña cuando `password_cambiado === false` para roles operativos.
5. Crea sesión y redirige a `/milab/inicio` con credenciales válidas.

Necesidad de refactor:

- Extraer verificación de reCAPTCHA a helper reutilizable.
- Separar la consulta `login(documento)` a un módulo de servicio o repositorio exportable.

### Recuperación de contraseña

Archivo: [src/routes/api/send_email.js](src/routes/api/send_email.js)

Casos sugeridos:

1. Rechaza payload inválido.
2. Muestra error cuando no encuentra cuenta.
3. Bloquea cuentas sin correo de recuperación.
4. Genera token y llama a `sendMail` cuando la cuenta es válida.
5. Devuelve mensaje de error cuando falla el correo.
6. `verify_email` resuelve correctamente `auth`, `usuario`, `laboratorista` y `coordinador_laboratorio`.

Necesidad de refactor:

- Extraer `generateRandomSecret` y `verify_email` a módulo reutilizable.
- Aislar construcción de `mailOptions`.

### Validación de permisos JSON

Archivos candidatos:

- [src/routes/api/estudiantes_registrados.js](src/routes/api/estudiantes_registrados.js)
- [src/routes/api/coordinadores_registrados.js](src/routes/api/coordinadores_registrados.js)
- [src/routes/api/laboratoristas_registrados.js](src/routes/api/laboratoristas_registrados.js)

Casos sugeridos:

1. Un admin puede actualizar correo cuando no hay conflicto.
2. Un rol sin permisos recibe `403`.
3. Un correo no institucional recibe `400`.
4. Un conflicto de correo devuelve `409`.

Valor:

- Cubren reglas críticas de operación con bajo costo comparado con flujos de certificados.

## Prioridad 4: integración selectiva de flujos completos

No recomiendo empezar por aquí, pero sí planearlos.

### Flujos a cubrir después de la primera base

1. Login completo con sesión.
2. Forgot password con generación de token.
3. Registro de coordinador.
4. Registro de laboratorista.
5. Dashboard por rol.

Eso debería entrar después de estabilizar helpers y middlewares.

## Refactors Previos Recomendados

La suite puede arrancar sin una gran reescritura, pero estos cambios reducen mucho el costo futuro.

### 1. Separar creación de app y arranque del servidor

Hoy [src/app.js](src/app.js) llama `app.listen` directamente.

Recomendación:

- Crear un `createApp()` exportable.
- Dejar el `listen` en un archivo de arranque separado.

Beneficio:

- Permite usar `supertest` sin abrir puertos reales.

### 2. Extraer verificación de reCAPTCHA

Hoy la lógica está duplicada en varias rutas.

Recomendación:

- Crear un helper, por ejemplo en `src/libs/recaptcha.js`.

Beneficio:

- Reduce duplicación y vuelve testeable una funcionalidad que pediste explícitamente.

### 3. Extraer servicios de autenticación y recuperación

Recomendación:

- Sacar lookup de login, lookup de recuperación y construcción de correos a módulos pequeños.

Beneficio:

- Disminuye mocks por ruta y hace los tests más estables.

### 4. Encapsular acceso a base de datos en funciones de dominio

Hoy muchas rutas invocan `pool.query` varias veces con SQL inline.

Recomendación:

- No reescribir todo de una vez.
- Empezar por repositorios o servicios en los flujos prioritarios.

Beneficio:

- Permite pruebas unitarias sobre lógica y deja el SQL para pruebas de integración o contrato.

## Orden Recomendado De Implementación

### Fase 1. Fundaciones de testing

1. Agregar `node:test` como estándar de proyecto.
2. Agregar `supertest`.
3. Crear script `test` y quizá `test:unit` en [package.json](package.json).
4. Crear estructura `tests/`.

### Fase 2. Cobertura rápida de helpers

1. `account-email`
2. `app-url`
3. `registration-token`
4. `certificate-email`
5. `auth` middleware
6. `faculty-scope`

### Fase 3. Middlewares y seguridad

1. `security-logger`
2. `mail`
3. partes puras de `logger`

### Fase 4. Primeras rutas críticas

1. login
2. forgot password
3. actualización de correos

### Fase 5. Integración focalizada

1. login con sesión
2. forgot password con token
3. registro coordinador/laboratorista

## Qué No Recomiendo En La Primera Ola

1. No empezar por rutas gigantes de certificados que mezclan consultas académicas externas, PDF, QR y correo.
2. No perseguir cobertura global desde el primer sprint.
3. No meter una base de datos real para todas las pruebas unitarias.
4. No usar snapshots grandes de HTML como estrategia principal.

## Propuesta De Primer Lote De Casos

Si el objetivo es obtener valor rápido, el primer lote concreto debería incluir aproximadamente estos bloques:

1. `account-email.test.js`
2. `app-url.test.js`
3. `certificate-email.test.js`
4. `faculty-scope.test.js`
5. `auth.middleware.test.js`
6. `mail.test.js`
7. `login.route.test.js`
8. `forgot-password.route.test.js`

Ese lote ya protege:

- Validación de correos.
- Generación de URLs.
- Override de destinatarios.
- Envío de certificados.
- Reglas de acceso.
- Login.
- Recuperación de contraseña.

## Relación Con La Deuda De Normalización

Introducir esta base mínima de pruebas antes de normalizar la BD es la decisión correcta.

Razones:

1. La normalización va a tocar `auth`, flujos de correo, sanciones, asignaciones por facultad y auditoría.
2. Hoy esos flujos dependen de convenciones implícitas y de joins frágiles.
3. Sin pruebas, el riesgo de regresión es alto.

## Recomendación Final

La estrategia correcta no es intentar probar todo el sistema actual tal como está, sino construir una base de pruebas alrededor de los módulos con mejor relación valor-esfuerzo y usar esa base para habilitar refactors posteriores.

El orden sugerido es:

1. Fundaciones de testing.
2. Helpers y middlewares puros.
3. Login y recuperación de contraseña.
4. Rutas operativas de actualización de correo y permisos.
5. Flujos más pesados e integraciones.

Ese enfoque te da resultados visibles rápido y deja el proyecto en condiciones de atacar la normalización del modelo de datos con menos riesgo.
