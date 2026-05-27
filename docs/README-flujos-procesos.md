# Flujos De Procesos Del Sistema MiLab

Este documento resume los procesos funcionales principales que maneja MiLab y los conecta con las rutas API/Web y componentes de arquitectura ya documentados.

## Alcance

- Login institucional y carga de sesion.
- Consulta de estado y generacion de certificado.
- Registro y aprobacion de sanciones.
- Monitoreo por rol.
- Recuperacion de contrasena.
- Consulta publica de estado y validacion de certificados.

## Referencias Base

- Arquitectura de secuencias: docs/architecture/sequences.md
- Mapa de acceso por rol: docs/route-access-map.md
- Matriz de accesos: docs/matriz-accesos.md
- Seguridad y RBAC: docs/architecture/security-rbac.md
- Modelo de datos: docs/architecture/erd.md

## Flujo 1. Login Institucional (Microsoft Entra)

Actores:
- Usuario autenticado (estudiante, docente, laboratorista, coordinador, admin).

Entradas:
- Solicitud de inicio de sesion en /milab/auth/login.

Proceso:
1. El usuario inicia login en la app.
2. MiLab redirige al proveedor Microsoft Entra (OAuth2).
3. En callback, el backend resuelve identidad por correo y roles en BD.
4. Se crea/regenera la sesion y se redirige al home del rol.

Salidas:
- Sesion activa en req.session.user.
- Navegacion y permisos segun rol.

## Flujo 2. Consulta Academica Y Generacion De Certificado

Actores:
- Estudiante, docente, admin (segun la ruta usada).

Entradas:
- Solicitud de consulta/generacion desde endpoints de paz y salvo.

Proceso:
1. MiLab consulta datos academicos en servicios institucionales (OATI/OAS).
2. MiLab valida en PostgreSQL si existen sanciones activas.
3. Si no hay sanciones activas, genera QR/PDF y registra trazabilidad.
4. Se habilita descarga y/o envio de correo transaccional.

Salidas:
- Certificado emitido o respuesta de bloqueo por sancion activa.

## Flujo 3. Registro De Sancion (Laboratorista)

Actores:
- Laboratorista.

Entradas:
- Formulario de sancion (estudiante o docente).

Proceso:
1. El backend valida datos, formato y alcance operativo.
2. Se registra la sancion en la tabla multa.
3. El estado inicial queda pendiente/operativo segun reglas del modulo.
4. El sistema responde confirmacion al usuario.

Salidas:
- Sancion registrada y disponible para consulta/aprobacion.

## Flujo 4. Aprobacion O Saldado De Sancion (Coordinador)

Actores:
- Coordinador.

Entradas:
- Acciones sobre endpoints de aprobacion (activar/saldar).

Proceso:
1. El sistema valida rol coordinador y facultades asignadas.
2. Se actualiza estado de la sancion en BD.
3. Se registran cambios y fecha de modificacion.

Salidas:
- Sancion activa o saldada segun accion ejecutada.

## Flujo 5. Monitoreo Y Dashboard Por Rol

Actores:
- Admin, coordinador, laboratorista.

Entradas:
- Solicitud a /milab/api/dashboard con filtros.

Proceso:
1. El backend detecta rol primario del usuario.
2. Aplica alcance de datos:
   - Admin: global.
   - Coordinador: facultades asignadas.
   - Laboratorista: UAL asignadas.
3. Ejecuta consultas agregadas permitidas por rol.

Salidas:
- Indicadores y series para el dashboard dentro del alcance autorizado.

## Flujo 6. Recuperacion De Contrasena

Actores:
- Usuario sin sesion.

Entradas:
- Documento y correo en flujo forgot password.

Proceso:
1. El backend valida coincidencia identidad-correo.
2. Genera token temporal de recuperacion.
3. Construye URL absoluta con APP_BASE_URL (si aplica).
4. Envia correo por SMTP Outlook/Office 365.

Salidas:
- Enlace de recuperacion valido temporalmente o mensaje de error controlado.

## Flujo 7. Consulta Publica Y Validacion De Certificados

Actores:
- Invitado (sin sesion).

Entradas:
- Codigo/documento en endpoints publicos.

Proceso:
1. Se aplica rate limit y validaciones de formato.
2. En consulta publica sensible se valida reCAPTCHA.
3. Se consulta estado en BD y se retorna resultado controlado.

Salidas:
- Estado visible para consulta publica sin exponer informacion sensible adicional.

## Matriz Rapida De Responsabilidad

- Estudiante/Docente: solicitan y descargan su certificado.
- Laboratorista: registra y gestiona sanciones operativas de su alcance.
- Coordinador: aprueba/salda y opera con alcance por facultad.
- Admin: administracion global, reportes y configuraciones.

## Trazabilidad Recomendada

Para cambios funcionales, actualizar en conjunto:

1. docs/README-flujos-procesos.md
2. docs/architecture/sequences.md
3. docs/route-access-map.md
4. docs/architecture/security-rbac.md
