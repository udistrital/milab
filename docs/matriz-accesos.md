# Matriz De Accesos (Rol, Modulo Y Acciones)

Esta matriz resume los permisos funcionales actuales por rol en MiLab, con base en rutas protegidas y alcance operativo.

## Convenciones

- `V`: ver/consultar.
- `C`: crear/registrar.
- `A`: aprobar o cambiar estado.
- `D`: descargar/generar certificado.
- `G`: gestion global.

## Matriz Principal

| Rol             | Modulo                          | Acciones      | Rutas clave                                                                                                                                                 | Alcance               |
| --------------- | ------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `admin`         | Inicio y perfil                 | `V`           | `/milab/inicio`, `/milab/api/profile`                                                                                                                       | Global                |
| `admin`         | Monitoreo                       | `V`           | `/milab/api/dashboard`                                                                                                                                      | Global                |
| `admin`         | Registro de coordinadores       | `V`, `C`      | `/milab/api/registro_coordinador/load_info`, `/milab/api/registro_coordinador`                                                                              | Global                |
| `admin`         | Registro de laboratoristas      | `V`, `C`      | `/milab/api/register_labs/load_info`, `/milab/api/register_labs`                                                                                            | Global                |
| `admin`         | Consulta y control              | `V`           | `/milab/api/get_list_estudiantes`, `/milab/api/get_list_estudiantes/get_consulta`, `/milab/api/get_list_multas`                                             | Global                |
| `admin`         | Gestion de usuarios operativos  | `V`, `C`, `G` | `/milab/api/coordinadores_registrados`, `/milab/api/laboratoristas_registrados`, `/milab/api/estudiantes_registrados`, `/milab/api/admins`                  | Global                |
| `admin`         | Configuracion academica         | `V`, `C`, `G` | `/milab/api/facultad`                                                                                                                                       | Global                |
| `admin`         | Logs y auditoria                | `V`           | `/milab/api/logs`                                                                                                                                           | Global                |
| `admin`         | Paz y salvo (estudiante)        | `V`, `C`, `D` | `/milab/api/get-data1/verificacion`, `/milab/api/get-data1`, `/milab/api/download-pdf`                                                                      | Global                |
| `admin`         | Paz y salvo (docente)           | `V`, `C`, `D` | `/milab/api/verifica_multa_docente/verificacion`, `/milab/api/verifica_multa_docente`, `/milab/api/download-pdf-docente`                                    | Global                |
| `coordinador`   | Inicio y perfil                 | `V`           | `/milab/inicio`, `/milab/api/profile`                                                                                                                       | Facultades asignadas  |
| `coordinador`   | Monitoreo                       | `V`           | `/milab/api/dashboard`                                                                                                                                      | Facultades asignadas  |
| `coordinador`   | Autorizaciones de sancion       | `V`, `A`      | `/milab/api/aprobacion_multa`, `/milab/api/aprobacion_multa/activar`, `/milab/api/aprobacion_multa/saldar`                                                  | Facultades asignadas  |
| `coordinador`   | Registro de laboratoristas      | `V`, `C`      | `/milab/api/register_labs/load_info`, `/milab/api/register_labs`, `/milab/api/register_labs/token`                                                          | Facultades asignadas  |
| `coordinador`   | Consulta y control              | `V`           | `/milab/api/get_list_estudiantes/get_consulta`, `/milab/api/estudiantes_registrados`, `/milab/api/laboratoristas_registrados`, `/milab/api/get_list_multas` | Facultades asignadas  |
| `coordinador`   | Paz y salvo operativo           | `V`           | `/milab/api/verificar_estudiante`, `/milab/api/verificar_docente`                                                                                           | Facultades asignadas  |
| `coordinador`   | Paz y salvo (docente)           | `V`, `C`      | `/milab/api/verifica_multa_docente/verificacion`, `/milab/api/verifica_multa_docente`                                                                       | Operativo por alcance |
| `laboratorista` | Inicio y perfil                 | `V`           | `/milab/inicio`, `/milab/api/profile`                                                                                                                       | UAL asignadas         |
| `laboratorista` | Monitoreo                       | `V`           | `/milab/api/dashboard`                                                                                                                                      | UAL asignadas         |
| `laboratorista` | Consulta y control de sanciones | `V`           | `/milab/api/get_list_multas`, `/milab/api/get_list_estudiantes/get_consulta`                                                                                | UAL asignadas         |
| `laboratorista` | Sanciones estudiante            | `V`, `C`      | `/milab/api/get-info-multa/get`, `/milab/api/get-info-multa`, `/milab/api/submit`, `/milab/api/get-info-erase-multa`                                        | UAL asignadas         |
| `laboratorista` | Sanciones docente               | `V`, `C`      | `/milab/api/get-info-multa-docente/get`, `/milab/api/get-info-multa-docente`, `/milab/api/submit_docente`, `/milab/api/get-info-erase-multa-docente`        | UAL asignadas         |
| `laboratorista` | Paz y salvo operativo           | `V`           | `/milab/api/verificar_estudiante`, `/milab/api/verificar_docente`                                                                                           | UAL asignadas         |
| `estudiante`    | Perfil                          | `V`           | `/milab/api/profile`                                                                                                                                        | Propio                |
| `estudiante`    | Solicitud de certificado        | `V`, `C`, `D` | `/milab/api/get-data1/verificacion`, `/milab/api/get-data1`, `/milab/api/download-pdf`                                                                      | Propio                |
| `docente`       | Perfil                          | `V`           | `/milab/api/profile`                                                                                                                                        | Propio                |
| `docente`       | Solicitud de certificado        | `V`, `C`, `D` | `/milab/api/verifica_multa_docente/verificacion`, `/milab/api/verifica_multa_docente`, `/milab/api/download-pdf-docente`                                    | Propio                |
| `invitado`      | Consulta publica                | `V`           | `/milab/api/consulta-invit`, `/milab/api/get-estado-multa/:codigo`                                                                                          | Publico con controles |
| `invitado`      | Validacion de certificados      | `V`           | `/milab/api/validateqr/:codigo`, `/milab/api/validateqr-docente/:codigo`                                                                                    | Publico con controles |

## Controles Transversales

| Control                 | Aplicacion                                               |
| ----------------------- | -------------------------------------------------------- |
| Autenticacion de sesion | `requireUser(...)`                                       |
| Autorizacion por rol    | `requireRoles(...)` y `requireJsonRoles(...)`            |
| Autorizacion por menu   | `menuPermissionMiddleware` (`menu_item` + `rol_permiso`) |
| Alcance de datos        | Coordinador por facultad, laboratorista por UAL          |
| Proteccion publica      | rate limit, validaciones de entrada y reCAPTCHA          |

## Fuente De Verificacion

- `docs/route-access-map.md`
- `docs/architecture/security-rbac.md`
- `src/routes/middlewares/auth.js`
- `src/routes/middlewares/menu-permissions.js`
