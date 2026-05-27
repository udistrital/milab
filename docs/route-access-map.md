# Mapa De Acceso A Rutas

Este documento resume el control de acceso actual de MILab para las rutas principales y el comportamiento del menú según rol.

## Flujo Base

1. El login institucional resuelve identidad y roles desde `usuario` + `usuario_rol`.
2. La sesión autenticada se guarda en `req.session.user`.
3. `src/app.js` expone la sesión en `res.locals`.
4. El menú preferente se resuelve desde `menu_item` + `rol_permiso`.
5. Si el menú persistido no está disponible, `src/routes/middlewares/navigation.js` construye un menú estático de respaldo.
6. La seguridad efectiva depende siempre del backend de cada ruta y de `requireUser(...)` / `requireRoles(...)`.

## Rutas Web Públicas

Base: `/milab/`

| Ruta | Acceso actual | Archivo |
| --- | --- | --- |
| `/` | Pública; si hay sesión redirige al home del rol | `src/routes/web/home.js` |
| `/auth/login` | Pública; redirige a Microsoft si no hay sesión | `src/routes/web/home.js` |
| `/consulta-invit` | Pública | `src/routes/web/home.js` |
| `/register` | Pública | `src/routes/web/home.js` |
| `/forgot_password` | Pública | `src/routes/web/home.js` |
| `/cambiar-password` | Pública a nivel de vista; el flujo real depende de estado temporal en API | `src/routes/web/home.js` |

## Rutas Principales Del Sistema

Base API: `/milab/api/`

| Ruta | Métodos | Roles permitidos | Alcance actual | Archivo |
| --- | --- | --- | --- | --- |
| `/dashboard` | `GET` | `admin`, `coordinador`, `laboratorista` | `admin`: global; `coordinador`: facultades asignadas; `laboratorista`: UAL asignadas | `src/routes/api/dashboard.js` |
| `/aprobacion_multa` | `GET` | `coordinador` | Facultades del coordinador | `src/routes/api/aprobacion_multa.js` |
| `/aprobacion_multa/activar` | `POST` | `coordinador` | Facultades del coordinador | `src/routes/api/aprobacion_multa.js` |
| `/aprobacion_multa/saldar` | `POST` | `coordinador` | Facultades del coordinador | `src/routes/api/aprobacion_multa.js` |
| `/registro_coordinador/load_info` | `GET` | `admin` | Global | `src/routes/api/registro_coordinador.js` |
| `/registro_coordinador` | `POST` | `admin` | Global | `src/routes/api/registro_coordinador.js` |
| `/register_labs/load_info` | `GET` | `admin`, `coordinador` | `admin`: global; `coordinador`: su alcance | `src/routes/api/register_labs.js` |
| `/register_labs` | `POST` | `admin`, `coordinador` | `admin`: global; `coordinador`: su alcance | `src/routes/api/register_labs.js` |
| `/register_labs/token` | `GET` | `coordinador` | Facultades del coordinador | `src/routes/api/register_labs.js` |
| `/get_list_multas` | `GET` | `admin`, `coordinador`, `laboratorista` | Global o restringido por rol | `src/routes/api/get_list_multas.js` |
| `/get_list_estudiantes` | `GET` | `admin` | Global | `src/routes/api/get_list_estudiantes.js` |
| `/get_list_estudiantes/get_consulta` | `GET` | `admin`, `coordinador`, `laboratorista` | Global o restringido por rol | `src/routes/api/get_list_estudiantes.js` |
| `/get_list_estudiantes/consulta_masiva` | `POST` | `admin`, `coordinador`, `laboratorista` | Global o restringido por rol | `src/routes/api/get_list_estudiantes.js` |
| `/coordinadores_registrados` | `GET` | `admin` | Global | `src/routes/api/coordinadores_registrados.js` |
| `/laboratoristas_registrados` | `GET` | `admin`, `coordinador` | Global o facultades asignadas | `src/routes/api/laboratoristas_registrados.js` |
| `/estudiantes_registrados` | `GET` | `admin`, `coordinador` | Global o facultades asignadas | `src/routes/api/estudiantes_registrados.js` |
| `/facultad` | `GET`, `POST` | `admin` | Global | `src/routes/api/facultad.js` |
| `/logs` | `GET` | `admin` | Global | `src/routes/api/logs.js` |
| `/admins/load_info` | `GET` | `admin` | Global | `src/routes/api/admins.js` |
| `/admins` | `POST` | `admin` | Global | `src/routes/api/admins.js` |
| `/get-info-multa/get` | `GET` | `laboratorista` | UAL asignadas por operación | `src/routes/api/get-info-multa.js` |
| `/get-info-multa` | `POST` | `laboratorista` | UAL asignadas por operación | `src/routes/api/get-info-multa.js` |
| `/get-info-erase-multa` | `POST` | `laboratorista` | UAL asignadas por operación | `src/routes/api/get-info-erase-multa.js` |
| `/submit` | `POST` | `laboratorista` | UAL asignadas por operación | `src/routes/api/submit.js` |
| `/get-info-multa-docente/get` | `GET` | `admin`, `laboratorista` | Global o UAL asignadas | `src/routes/api/get-info-multa-docente.js` |
| `/get-info-multa-docente` | `POST` | `admin`, `laboratorista` | Global o UAL asignadas | `src/routes/api/get-info-multa-docente.js` |
| `/get-info-erase-multa-docente` | `POST` | `laboratorista` | UAL asignadas por operación | `src/routes/api/get-info-erase-multa-docente.js` |
| `/submit_docente` | `POST` | `laboratorista` | UAL asignadas por operación | `src/routes/api/submit_docente.js` |
| `/verificar_estudiante` | `GET`, `POST` | `admin`, `laboratorista`, `coordinador` | Global o restringido por rol | `src/routes/api/verificar_estudiante.js` |
| `/verificar_docente` | `GET`, `POST` | `admin`, `laboratorista`, `coordinador` | Global o restringido por rol | `src/routes/api/verificar_docente.js` |
| `/get-data1/verificacion` | `GET` | `admin`, `estudiante` | Propio para estudiante; global para admin | `src/routes/api/get-data1.js` |
| `/get-data1` | `POST` | `admin`, `estudiante` | Propio para estudiante; global para admin | `src/routes/api/get-data1.js` |
| `/verifica_multa_docente/verificacion` | `GET` | `admin`, `docente`, `coordinador` | Propio para docente; operativo para coordinador/admin | `src/routes/api/verifica_multa_docente.js` |
| `/verifica_multa_docente` | `POST` | `admin`, `docente`, `coordinador` | Propio para docente; operativo para coordinador/admin | `src/routes/api/verifica_multa_docente.js` |

## Monitoreo Por Rol

La ruta `/milab/api/dashboard` ya no es admin-only.

| Rol | Vista | Indicadores disponibles |
| --- | --- | --- |
| `admin` | Global | `estudiantes`, `docentes`, `sanciones`, `sancionesActivas`, `sancionesSaldadas`, `laboratoristas`, `coordinadores`, `usuariosRegistrados` |
| `coordinador` | Facultades asignadas | `estudiantes`, `sanciones`, `sancionesActivas`, `sancionesSaldadas`, `laboratoristas`, `coordinadores`, `usuariosRegistrados` |
| `laboratorista` | UAL asignadas | `sanciones`, `sancionesActivas`, `sancionesSaldadas`, `laboratoristas` |

El alcance operativo se resuelve con:

- `resolveCoordinatorScope(...)` para coordinadores.
- `laboratorista` + `laboratorista_ual` para laboratoristas.

## Menú Persistido En BD

El seed canónico actual en `sql-scripts/db_seed_system.sql` deja esta estructura principal:

- `primary`
  - `Inicio` para todos los roles autenticados.
  - `Monitoreo` para `admin`, `coordinador` y `laboratorista`.
  - `Autorizaciones` para `coordinador`.
  - `Solicitar certificado estudiante` para `estudiante`.
  - `Solicitar certificado docente` para `docente`.
- `secondary`
  - `Registro`
  - `Consulta y control`
  - `Paz y Salvos`
  - `Sanciones`
  - `Administración`
  - `Configuración`

Nota: el menú estático de respaldo en `src/routes/middlewares/navigation.js` todavía conserva algunos labels legacy para laboratorista (`Consultas`, `Administración`). La seguridad de rutas no depende de esos labels sino de los middlewares de backend.

## Rutas Públicas O Sensibles

| Ruta | Observación |
| --- | --- |
| `/milab/api/consulta-invit` | Pública por diseño; protegida con reCAPTCHA |
| `/milab/api/get-estado-multa/:codigo` | Pública por diseño; con rate limit y validación numérica |
| `/milab/api/validateqr/:codigo` | Pública por diseño; con rate limit y validación del identificador |
| `/milab/api/validateqr-docente/:codigo` | Pública por diseño; con rate limit y validación del identificador |
| `/milab/api/generate` | Requiere sesión (`requireUser(...)`) |
| `/milab/api/generatepdf` | Requiere sesión (`requireUser(...)`) |
| `/milab/api/download-pdf` | Exige roles y valida ownership para `estudiante` |
| `/milab/api/download-pdf-docente` | Exige roles y valida ownership para `docente` |

## Middleware Centralizado

El control de acceso reutilizable vive en `src/routes/middlewares/auth.js`:

- `requireUser(...)`
- `requireRoles(...)`

El control de navegación por menú persistido vive en:

- `src/routes/middlewares/menu-permissions.js`
- `src/routes/middlewares/navigation.js`
