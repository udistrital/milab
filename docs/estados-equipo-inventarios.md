# Estados de equipos e inventarios

Los estados del equipo técnico, la actividad del registro de inventario y el flujo de aprobación
son conceptos separados. No se deben interpretar como una sola lista de estados.

## Estado operativo del equipo

El campo `equipo.estado` admite estos valores:

| Estado | Significado |
| --- | --- |
| `disponible` | El equipo puede solicitarse en préstamo si también está activo y habilitado para préstamo en el inventario. |
| `prestado` | El equipo está actualmente fuera del laboratorio por un préstamo. No se puede dar de baja mientras permanezca en este estado. |
| `mantenimiento` | El equipo no está disponible para préstamo mientras se realizan tareas de mantenimiento. |
| `fuera_servicio` | El equipo no está disponible para préstamo porque está fuera de servicio o fue dado de baja del inventario. |

La restricción vigente está definida en
[`db_structure_prestamos.sql`](../sql-scripts/db_structure_prestamos.sql).

## Actividad del registro

`equipo.activo` e `inventario.activo` son indicadores booleanos independientes del estado
operativo. Un registro inactivo se conserva para trazabilidad, pero deja de estar disponible para
préstamos. Al dar de baja un equipo desde inventarios, los indicadores se desactivan y el estado
operativo se establece en `fuera_servicio`.

`inactivo` no es un valor de `equipo.estado`. Del mismo modo, `avería` no es un valor admitido:
si el equipo está siendo reparado se registra como `mantenimiento`; si no puede usarse y no está
en reparación activa, se registra como `fuera_servicio`. El detalle de la incidencia debe
conservarse en el registro de mantenimiento o incidencia correspondiente.

Para que un equipo aparezca como prestable deben cumplirse simultáneamente estas condiciones:

- El registro del inventario está aprobado y activo.
- `inventario.disponible_prestamo` es verdadero.
- El registro técnico asociado está activo y `equipo.estado = 'disponible'`.

## Aprobación de inventarios

Estos estados describen la revisión de inventarios; no reemplazan el estado operativo de un
equipo:

| Entidad | Estados |
| --- | --- |
| `inventario.estado_aprobacion` | `pendiente`, `aprobado`, `rechazado` |
| `inventario_carga.estado` | `previsualizada`, `pendiente_aprobacion`, `devuelta`, `aprobada`, `rechazada`, `cancelada` |
| `inventario_estado_laboratorio.estado` | `pendiente`, `pendiente_aprobacion`, `devuelta`, `aprobado`, `rechazado` |

Una carga sigue el flujo `previsualizada` → `pendiente_aprobacion` → `aprobada` o `rechazada`.
El coordinador también puede devolverla con un comentario; en ese caso, el laboratorista carga un
Excel corregido que reemplaza las filas de la versión devuelta. La auditoría conserva las decisiones
y comentarios previos antes de que la carga vuelva a enviarse.
