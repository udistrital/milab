# Diagnóstico De Pruebas Unitarias

## Objetivo

Este documento resume el estado actual de la estrategia de pruebas automatizadas de MILab, qué cobertura ya existe y qué frentes siguen siendo prioritarios.

## Resumen Ejecutivo

MILab ya cuenta con una suite formal de pruebas unitarias ejecutada con `node:test` y visible desde `package.json` mediante:

- `npm test`
- `npm run test:unit`

La suite actual cubre helpers, middlewares y algunas rutas con dependencias simuladas. Todavía no existe una capa amplia de pruebas de integración end-to-end, pero ya hay una red útil de seguridad sobre invariantes críticos:

1. correos institucionales y conflictos de email,
2. construcción de URLs,
3. envío de correos y overrides,
4. alcance por facultad,
5. tokens de registro,
6. autenticación y autorización de middlewares,
7. verificación reCAPTCHA,
8. reintentos del cliente OATI,
9. parseo de formularios en rutas sensibles.

Conclusión: el proyecto ya no está en etapa “sin suite”. La siguiente inversión útil no es montar testing desde cero, sino ampliar cobertura de rutas críticas y separar mejor dependencias externas.

## Estado Actual De La Suite

La estructura actual incluye al menos:

- `tests/unit/libs/*.test.js`
- `tests/unit/middlewares/*.test.js`
- `tests/unit/routes/*.test.js`

La ejecución actual validada localmente pasa con éxito sobre la suite unitaria.

## Superficie Ya Cubierta

### Helpers y librerías

Hay cobertura efectiva en módulos como:

- [src/libs/account-email.js](src/libs/account-email.js)
- [src/libs/app-url.js](src/libs/app-url.js)
- [src/libs/certificate-email.js](src/libs/certificate-email.js)
- [src/libs/faculty-scope.js](src/libs/faculty-scope.js)
- [src/libs/mail.js](src/libs/mail.js)
- [src/libs/oati-client.js](src/libs/oati-client.js)
- [src/libs/recaptcha.js](src/libs/recaptcha.js)
- [src/libs/registration-token.js](src/libs/registration-token.js)

Cobertura relevante ya observada:

1. normalización y validación de correos institucionales,
2. detección de errores únicos de PostgreSQL,
3. generación de URLs con `APP_BASE_URL`, desarrollo y producción,
4. comportamiento del correo con recipient override,
5. derivación de facultades y alcance de coordinadores,
6. obtención del secreto de registro,
7. verificación reCAPTCHA,
8. política de reintentos OATI.

### Middlewares

Hay cobertura útil sobre:

- [src/routes/middlewares/auth.js](src/routes/middlewares/auth.js)
- manejo de errores de aplicación,
- validación de respuestas JSON para autorización.

### Rutas con pruebas dirigidas

Ya existen pruebas sobre varias rutas y flujos puntuales, por ejemplo:

- [src/routes/api/consulta-invit.js](src/routes/api/consulta-invit.js)
- [src/routes/api/download-pdf.js](src/routes/api/download-pdf.js)
- [src/routes/api/facultad.js](src/routes/api/facultad.js)
- [src/routes/api/generate_cert_estudiante_lab.js](src/routes/api/generate_cert_estudiante_lab.js)
- [src/routes/api/get-data2.js](src/routes/api/get-data2.js)
- [src/routes/api/login.js](src/routes/api/login.js)
- [src/routes/api/registro_coordinador.js](src/routes/api/registro_coordinador.js)
- [src/routes/api/verificar_docente.js](src/routes/api/verificar_docente.js)
- [src/routes/api/verificar_estudiante.js](src/routes/api/verificar_estudiante.js)

Estas pruebas ya validan comportamientos importantes como:

1. rechazo de reCAPTCHA faltante o inválido,
2. parseo correcto de formularios `application/x-www-form-urlencoded`,
3. respuestas controladas ante datos faltantes,
4. flujo básico de generación y descarga de certificados,
5. acceso al login institucional.

## Cambio Relevante Ya Cubierto: Reintentos OATI

El cliente de OATI en [src/libs/oati-client.js](src/libs/oati-client.js) ahora implementa reintentos con backoff:

- `500 ms`
- `1500 ms`
- `3000 ms`

La suite ya cubre:

1. reintento exitoso ante errores transitorios como `ECONNREFUSED`,
2. no reintentar respuestas no recuperables como `404`.

Esto es importante porque el comportamiento del cliente cambió y ya quedó protegido por pruebas.

## Dependencias Externas Que Siguen Requiriendo Aislamiento

Para mantener pruebas deterministas, estas dependencias siguen siendo las más sensibles:

### Base de datos PostgreSQL

Uso extendido de [src/libs/db.js](src/libs/db.js) vía `pool.query`.

Impacta:

- autenticación,
- recuperación de contraseña,
- dashboard,
- sanciones,
- registro de usuarios,
- administración operativa.

Recomendación:

- unit tests con mocks de `pool.query`,
- integración selectiva con base efímera solo en flujos de alto valor.

### SMTP y correo

Uso de [src/libs/mail.js](src/libs/mail.js) y [src/libs/certificate-email.js](src/libs/certificate-email.js).

Recomendación:

- no usar SMTP real en pruebas,
- verificar destinatario, subject, override y feedback generado.

### reCAPTCHA y servicios HTTP externos

Se usan llamadas remotas a Google y a servicios académicos externos en rutas como:

- [src/routes/api/login.js](src/routes/api/login.js)
- [src/routes/api/get-data1.js](src/routes/api/get-data1.js)
- [src/routes/api/get-data2.js](src/routes/api/get-data2.js)
- [src/routes/api/consulta-invit.js](src/routes/api/consulta-invit.js)

Recomendación:

- seguir mockeando `fetch` y `axios`,
- evitar depender de red real incluso en CI.

### JWT y secretos de entorno

Uso en:

- [src/routes/api/register_labs.js](src/routes/api/register_labs.js)
- [src/routes/api/registro_coordinador.js](src/routes/api/registro_coordinador.js)
- [src/libs/registration-token.js](src/libs/registration-token.js)

Recomendación:

- mantener secretos controlados por entorno de prueba,
- validar expiración, fallback y rechazo explícito.

### Sistema de archivos

Uso visible en:

- [src/libs/certificate-email.js](src/libs/certificate-email.js)
- [src/libs/logger.js](src/libs/logger.js)

Recomendación:

- mockear acceso a disco salvo en pruebas muy puntuales.

## Qué Sigue Faltando

### 1. Más cobertura de rutas críticas

Siguen siendo prioritarias estas superficies:

- [src/routes/api/send_email.js](src/routes/api/send_email.js)
- [src/routes/api/register_labs.js](src/routes/api/register_labs.js)
- [src/routes/api/aprobacion_multa.js](src/routes/api/aprobacion_multa.js)
- [src/routes/api/submit.js](src/routes/api/submit.js)
- [src/routes/api/submit_docente.js](src/routes/api/submit_docente.js)
- [src/routes/api/get_list_multas.js](src/routes/api/get_list_multas.js)
- [src/routes/api/dashboard.js](src/routes/api/dashboard.js)

Especialmente útiles serían pruebas para:

1. bloqueo de registro de laboratorista si el usuario ya es coordinador,
2. activación y saldado de sanciones con `req.body` parseado,
3. rechazo de fechas futuras en sanciones,
4. alcance del dashboard por rol,
5. respuestas de error controladas cuando coordinador o laboratorista no tienen alcance asignado.

### 2. Integración HTTP más amplia

El proyecto ya tiene `supertest`, pero todavía conviene crecer en:

- pruebas de rutas agrupadas por módulo,
- validación de redirecciones y sesiones,
- cobertura de flujos con menú y permisos.

### 3. Separación adicional de responsabilidades

Varias rutas todavía mezclan:

1. validación,
2. acceso a DB,
3. llamadas HTTP externas,
4. renderizado,
5. efectos secundarios.

Mientras no se siga desacoplando esa lógica, las pruebas existirán, pero con mayor fricción de mantenimiento.

## Recomendación Actualizada

La estrategia recomendada ya no es “introducir testing”, sino “ampliar la red existente en el orden correcto”.

Orden sugerido:

1. rutas de sanciones y registro con regresiones recientes,
2. dashboard por rol y alcance,
3. recuperación de contraseña y correo,
4. integración HTTP de flujos autenticados clave.

## Conclusión

MILab ya tiene una base real de pruebas unitarias útil y ejecutable en CI. La inversión correcta ahora es reforzar regresiones en rutas operativas y en el comportamiento por rol, no reconstruir desde cero la estrategia de testing.

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

1. La normalización va a tocar `usuario`/`usuario_rol`, flujos de correo, sanciones, asignaciones por facultad y auditoría.
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
