# Diagnóstico De Normalización De Base De Datos

## Objetivo

Este documento resume el estado actual del modelo de datos de MILab, identifica la deuda de normalización que sigue vigente y separa los problemas ya resueltos de los que todavía requieren trabajo.

La referencia principal es el esquema canónico en `sql-scripts/db_structure.sql`.

## Resumen Ejecutivo

El modelo canónico mejoró de forma importante frente al estado histórico del proyecto.

Hoy, las mejoras más relevantes ya consolidadas son estas:

1. La identidad autenticable se resuelve con `usuario` + `usuario_rol`.
2. `multa` ya no depende de texto libre para todas sus relaciones críticas: ahora usa claves foráneas hacia `laboratorista`, `usuario` y `ual`.
3. Las asignaciones múltiples de alcance ya existen de forma explícita en `coordinador_facultad` y `laboratorista_ual`.
4. El modelo de certificados ya se expresa con `certificado_estudiante` y `certificado_docente`, vinculados a `usuario`.

La deuda de normalización que sigue abierta ya no es principalmente de integridad referencial básica. Tras la remoción de relaciones duplicadas en `coordinador` y `laboratorista`, la deuda activa se concentra en legado de identidad y auditoría:

1. Persisten identificadores operativos legacy (`nombre_u`, `n_usuario`) que mezclan identidad de persona con identidad de cuenta.
2. `log.documento` sigue modelado como numérico, aunque la aplicación ya maneja identificadores alfanuméricos.
3. Existen rutas y consultas que todavía cargan supuestos heredados del modelo antiguo, sobre todo alrededor de estudiantes, docentes y sanciones.

## Estado Actual Del Modelo

### Núcleo de identidad y acceso

- `usuario`
- `rol`
- `usuario_rol`
- `perfil_estudiante`
- `perfil_docente`

Este núcleo ya refleja una dirección más limpia: la persona autenticable vive en `usuario` y los privilegios se asignan en `usuario_rol`.

### Catálogos y alcance operativo

- `facultad`
- `ual`
- `coordinador`
- `laboratorista`
- `coordinador_facultad`
- `laboratorista_ual`

El sistema ya soporta alcance múltiple para coordinadores y laboratoristas mediante tablas de unión.

### Operación transaccional

- `certificado_estudiante`
- `certificado_docente`
- `multa`
- `log`

## Relaciones Que Ya Quedaron Bien Encaminadas

### 1. Sanciones (`multa`)

La tabla `multa` dejó atrás el modelo más frágil del sistema.

Hoy las relaciones principales son:

1. `multa.laboratorista_documento_id -> laboratorista.documento`
2. `multa.usuario_sancionado_id -> usuario.id`
3. `multa.ual_id -> ual.ual_id`

Esto resuelve una parte crítica de la deuda histórica:

- La UAL ya no se representa como texto libre.
- La persona sancionada ya no depende de un documento o código suelto dentro de la tabla.
- El laboratorista que registra la sanción ya no se referencia solo por username o nombre textual.

Conclusión: `multa` ya no es la tabla más desnormalizada del sistema. La deuda restante en sanciones es más bien semántica y de compatibilidad con consultas heredadas.

### 2. Certificados

El modelo canónico usa:

- `certificado_estudiante(usuario_id)`
- `certificado_docente(usuario_id)`

Esto fija una relación explícita entre certificados y la identidad canónica del usuario.

### 3. Alcance múltiple

Las relaciones:

- `coordinador_facultad`
- `laboratorista_ual`

ya expresan correctamente que el alcance operativo puede ser múltiple, algo clave para monitoreo, autorizaciones y consultas.

## Deuda Que Sigue Vigente

### 1. Identificadores legacy de cuenta

Persisten dos columnas con semántica híbrida:

- `laboratorista.n_usuario`
- `coordinador.nombre_u`

Estas columnas todavía obligan a lógica condicional en varios flujos y mantienen viva una mezcla indeseable entre:

- documento o identidad humana
- username o identificador operativo

Estado recomendado:

- `usuario` debe seguir siendo la identidad canónica.
- `n_usuario` y `nombre_u` deben considerarse legado operativo, no la base del modelo de identidad.

### 2. Auditoría con tipo insuficiente

`log.documento` sigue siendo `NUMERIC(16,0)`.

Ese tipo ya no representa bien el sistema real, porque hoy existen identificadores y actores que pueden no ser puramente numéricos.

Estado recomendado:

- cambiar `log.documento` a `VARCHAR(50)`, o
- separar `actor_documento` y `actor_identifier` si se quiere más precisión semántica.

## Diagnóstico Por Tabla

### `usuario`

Estado actual:

- Es la identidad principal del sistema.
- Se relaciona con roles, perfiles, certificados y sanciones.

Diagnóstico:

- Buen punto de consolidación.
- Debe seguir siendo la referencia principal para operaciones autenticadas.

### `usuario_rol`

Estado actual:

- Resuelve asignación múltiple de roles por usuario.

Diagnóstico:

- Está bien normalizada.
- Es la base correcta para RBAC persistido.

### `perfil_estudiante` y `perfil_docente`

Estado actual:

- Permiten separar atributos específicos del perfil sin romper la identidad base.

Diagnóstico:

- Son consistentes con la dirección actual del modelo.
- Deben mantenerse alineadas con `usuario` para evitar duplicaciones innecesarias.

### `coordinador` y `coordinador_facultad`

Estado actual:

- El sistema puede resolver coordinadores por documento y por usuario vinculado.
- El alcance real ya se proyecta mejor desde `coordinador_facultad`.

Diagnóstico:

- El alcance se define en `coordinador_facultad`.
- Se eliminó la duplicidad estructural de facultad en el esquema canónico.

### `laboratorista` y `laboratorista_ual`

Estado actual:

- El sistema soporta laboratoristas con una o varias UAL.
- El alcance operativo del dashboard y de varias consultas depende de esa relación.

Diagnóstico:

- La tabla de unión es la pieza autoritativa.
- Se eliminó la duplicidad estructural de UAL/facultad en el esquema canónico.

### `multa`

Estado actual:

- Ya está anclada por FKs a actor, sujeto sancionado y UAL.
- Sigue siendo una tabla transaccional central.

Diagnóstico:

- La deuda estructural principal ya fue reducida.
- La prioridad ahora es mantener todas las consultas de aplicación alineadas con estas FKs y evitar volver a introducir joins por texto libre.

### `log`

Estado actual:

- Sigue desacoplada por diseño del resto del dominio.

Diagnóstico:

- Ese desacoplamiento es aceptable para auditoría.
- El problema no es la ausencia de FKs, sino el tipo de dato de `documento`.

## Dirección Objetivo Recomendada

La dirección arquitectónica recomendada hoy es esta:

1. `usuario` como identidad canónica.
2. `usuario_rol` como asignación explícita de capacidades.
3. `coordinador_facultad` como fuente de verdad para facultades de coordinador.
4. `laboratorista_ual` como fuente de verdad para UAL de laboratorista.
5. `multa` siempre referenciada por claves foráneas reales, no por textos descriptivos.

## Orden Recomendado De Trabajo

### Fase 1. Cerrar deuda de tipos y legado

1. Cambiar `log.documento` a un tipo textual.
2. Reducir dependencias funcionales de `n_usuario` y `nombre_u`.

### Fase 2. Alinear aplicación y esquema

1. Revisar rutas y consultas para asegurar que usen `multa.usuario_sancionado_id`, `multa.laboratorista_documento_id` y `multa.ual_id`.
2. Seguir retirando supuestos heredados donde el documento o el código se trataban como sustituto de una FK.

## Conclusión

El diagnóstico actualizado ya no es “la base está masivamente desnormalizada”.

La situación real es más precisa:

- la integridad relacional central mejoró bastante,
- el modelo de identidad ya tiene una base canónica,
- y la deuda más importante ahora está en columnas legacy, relaciones duplicadas y compatibilidad entre esquema nuevo y consultas heredadas.

La prioridad técnica debe enfocarse en consolidar las fuentes de verdad que ya existen, no en rediseñar desde cero un modelo que ya avanzó en la dirección correcta.
