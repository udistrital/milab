# Diagnóstico De Pruebas Unitarias

## Objetivo

Este documento resume el estado actual de la estrategia de pruebas automatizadas de MILab, qué cobertura ya existe y qué frentes siguen siendo prioritarios.

## Resumen Ejecutivo

MILab ya cuenta con una suite formal de pruebas unitarias ejecutada con `node:test` y visible desde `package.json` mediante:

- `npm test`
- `npm run test:unit`

Además, la suite HTTP de integración ya quedó incorporada a la ejecución principal de pruebas:

- `npm run test:integration`

Para análisis estático local adicional fuera de `node:test`, el repositorio también dispone de `sonar-project.properties` y del comando:

- `npm run sonar:local`

Hoy `npm test` ejecuta primero unit y luego integración, que es también la ruta usada por CI.

Actualización operativa de hoy:

1. Se estabilizó la suite eliminando una cancelación intermitente en `coordinadores_registrados` causada por una ruta que no cerraba respuesta en todos los caminos.
2. Se corrigieron bloqueos de calidad que impedían el pipeline completo (`format:check`, `lint` y un test unit cancelado).
3. Se dejó validado el recorrido completo de CI local (`ci:check`, unit e integración) en verde.
4. Se confirmó análisis Sonar local en cero para `code_smells`, `bugs`, `vulnerabilities` y `security_hotspots` tras los ajustes.

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

La ejecución actual validada localmente pasa con éxito sobre la suite unitaria y de integración.

Última corrida de referencia:

1. Unit: 242 pruebas `pass`, 0 `fail`, 0 `cancelled`.
2. Integración: 20 pruebas `pass`, 0 `fail`, 0 `cancelled`.

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

- [src/routes/api/register_labs.js](src/routes/api/register_labs.js)
- [src/routes/api/aprobacion_multa.js](src/routes/api/aprobacion_multa.js)
- [src/routes/api/submit.js](src/routes/api/submit.js)
- [src/routes/api/submit_docente.js](src/routes/api/submit_docente.js)
- [src/routes/api/get_list_multas.js](src/routes/api/get_list_multas.js)
- [src/routes/api/dashboard.js](src/routes/api/dashboard.js)
- [src/routes/api/prestamos.js](src/routes/api/prestamos.js) (solicitudes, entrega/devolucion, incidencias y practicas)

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

Adicional para operación CI:

1. Mantener la ejecución por puertas (`ci:check` -> `npm test` -> despliegue) como baseline de regresión.
2. Para cambios de despliegue o semillas SQL, validar también el flujo de recreación de ambiente en `.github/workflows/ci.yml`.

## Conclusión

MILab ya tiene una base real de pruebas unitarias útil y ejecutable en CI. La inversión correcta ahora es reforzar regresiones en rutas operativas de Préstamos y en el comportamiento por rol, no reconstruir desde cero la estrategia de testing.
