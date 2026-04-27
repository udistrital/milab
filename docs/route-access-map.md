# Mapa De Acceso A Rutas

Este documento resume como se controla hoy el acceso a las rutas principales del sistema.

## Flujo Base

1. El login toma el rol desde `auth.tipo`.
2. El usuario autenticado se guarda en `req.session.user`.
3. `src/app.js` copia esa sesión a `res.locals`.
4. El header compartido arma el menú según `locals.tipo`.
5. La seguridad real depende de los chequeos de backend por ruta.

## Rutas Web Publicas

Base: `/milab/`

| Ruta                | Acceso actual                                                        | Archivo                  |
| ------------------- | -------------------------------------------------------------------- | ------------------------ |
| `/`                 | Público; si hay sesión redirige al home del rol                      | `src/routes/web/home.js` |
| `/auth/login`       | Público; si hay sesión redirige                                      | `src/routes/web/home.js` |
| `/consulta-invit`   | Público                                                              | `src/routes/web/home.js` |
| `/register`         | Público                                                              | `src/routes/web/home.js` |
| `/forgot_password`  | Público                                                              | `src/routes/web/home.js` |
| `/cambiar-password` | Público a nivel de vista; el flujo real depende de `tempUser` en API | `src/routes/web/home.js` |

## Rutas Del Menu Por Rol

Base API: `/milab/api/`

| Ruta                                       | Métodos                 | Roles permitidos hoy                    | Archivo                                        |
| ------------------------------------------ | ----------------------- | --------------------------------------- | ---------------------------------------------- |
| `/dashboard`                               | `GET`                   | `admin`                                 | `src/routes/api/dashboard.js`                  |
| `/logs`                                    | `GET`                   | `admin`                                 | `src/routes/api/logs.js`                       |
| `/facultad`                                | `GET`, `POST`           | `admin`                                 | `src/routes/api/facultad.js`                   |
| `/coordinadores_registrados`               | `GET`                   | `admin`                                 | `src/routes/api/coordinadores_registrados.js`  |
| `/coordinadores_registrados/eliminar`      | `POST`                  | `admin`, `laboratorista`                | `src/routes/api/coordinadores_registrados.js`  |
| `/coordinadores_registrados/toggle-estado` | `POST`                  | `admin`, `laboratorista`                | `src/routes/api/coordinadores_registrados.js`  |
| `/estudiantes_registrados`                 | `GET`                   | `admin`, `coordinador`                  | `src/routes/api/estudiantes_registrados.js`    |
| `/laboratoristas_registrados`              | `GET`, `POST /eliminar` | `admin`, `coordinador`                  | `src/routes/api/laboratoristas_registrados.js` |
| `/registro_coordinador/load_info`          | `GET`                   | `admin`                                 | `src/routes/api/registro_coordinador.js`       |
| `/registro_coordinador`                    | `POST`                  | `admin`                                 | `src/routes/api/registro_coordinador.js`       |
| `/registro_coordinador/token`              | `GET`                   | `admin`                                 | `src/routes/api/registro_coordinador.js`       |
| `/register_labs/load_info`                 | `GET`                   | `admin`, `coordinador`                  | `src/routes/api/register_labs.js`              |
| `/register_labs/token`                     | `GET`                   | `coordinador`                           | `src/routes/api/register_labs.js`              |
| `/get_list_multas`                         | `GET`                   | `admin`, `laboratorista`, `coordinador` | `src/routes/api/get_list_multas.js`            |
| `/get_list_estudiantes`                    | `GET`                   | `admin`                                 | `src/routes/api/get_list_estudiantes.js`       |
| `/get_list_estudiantes/get_consulta`       | `GET`                   | `admin`, `laboratorista`, `coordinador` | `src/routes/api/get_list_estudiantes.js`       |
| `/get_list_estudiantes/consulta_masiva`    | `POST`                  | `admin`, `laboratorista`, `coordinador` | `src/routes/api/get_list_estudiantes.js`       |
| `/get_list_estudiantes/generate_pdf`       | `GET`                   | `admin`, `laboratorista`, `coordinador` | `src/routes/api/get_list_estudiantes.js`       |
| `/aprobacion_multa`                        | `GET`                   | `coordinador`                           | `src/routes/api/aprobacion_multa.js`           |
| `/aprobacion_multa/activar`                | `POST`                  | `coordinador`                           | `src/routes/api/aprobacion_multa.js`           |
| `/aprobacion_multa/saldar`                 | `POST`                  | `coordinador`                           | `src/routes/api/aprobacion_multa.js`           |
| `/verificar_estudiante`                    | `GET`, `POST`           | `admin`, `laboratorista`, `coordinador` | `src/routes/api/verificar_estudiante.js`       |
| `/verificar_docente`                       | `GET`, `POST`           | `admin`, `laboratorista`, `coordinador` | `src/routes/api/verificar_docente.js`          |
| `/get-data1/verificacion`                  | `GET`                   | `admin`, `estudiante`                   | `src/routes/api/get-data1.js`                  |
| `/get-data1`                               | `POST`                  | `admin`, `estudiante`                   | `src/routes/api/get-data1.js`                  |
| `/verifica_multa_docente/verificacion`     | `GET`                   | `admin`, `docente`                      | `src/routes/api/verifica_multa_docente.js`     |
| `/verifica_multa_docente`                  | `POST`                  | `admin`, `docente`                      | `src/routes/api/verifica_multa_docente.js`     |

## Rutas Publicas O Sensibles A Revisar

| Ruta                                    | Observación                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/milab/api/consulta-invit`             | Pública por diseño; protegida con reCAPTCHA                                                            |
| `/milab/api/get-estado-multa/:codigo`   | Pública por diseño; ahora con rate limit y validación numérica                                         |
| `/milab/api/validateqr/:codigo`         | Pública por diseño; ahora con rate limit y validación del identificador                                |
| `/milab/api/validateqr-docente/:codigo` | Pública por diseño; ahora con rate limit y validación del identificador                                |
| `/milab/api/generate`                   | Ya no debe quedar pública; exige sesión con `requireUser(...)`                                         |
| `/milab/api/generatepdf`                | Ya no debe quedar pública; exige sesión con `requireUser(...)`                                         |
| `/milab/api/download-pdf`               | Exige roles `admin`, `estudiante`, `laboratorista`, `coordinador` y valida ownership para `estudiante` |
| `/milab/api/download-pdf-docente`       | Exige roles `admin`, `docente`, `laboratorista`, `coordinador` y valida ownership para `docente`       |

## Middleware Centralizado

Se agregó `src/routes/middlewares/auth.js` con dos utilidades:

- `requireUser(...)`
- `requireRoles(...)`

Estas funciones permiten mover el control de acceso fuera del cuerpo de cada handler y reducir el riesgo de olvidar chequeos al crear nuevas rutas.

## Validación Local Reciente

- `GET /milab/` respondió `200`.
- `GET /pazysalvos/` respondió `301` hacia `/milab/`.
- `GET /milab/api/consulta-invit` respondió `200` y cargó la vista pública.
- `GET /milab/api/get-estado-multa/abc` respondió `400` con validación de entrada.
- `GET /milab/api/get-estado-multa/123456` respondió `200` con JSON válido.
- `GET /milab/api/validateqr/invalid` respondió `400` con vista de error, sin caída del servidor.
- `POST /milab/api/download-pdf` sin sesión respondió la vista de bloqueo esperada.
