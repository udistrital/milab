# Aplazamiento de sanciones (estado APLAZADA)

## Objetivo
Definir y estandarizar el flujo de aplazamiento de sanciones para casos donde, por solicitud del estudiante o docente, se desbloquea el recibo de pago y la deuda queda diferida sin perder trazabilidad institucional.

## Estado nuevo
Se incorpora el estado de sancion `APLAZADA`.

### Reglas de transicion
1. `ACTIVA -> APLAZADA`
2. `APLAZADA -> ACTIVA`

No se permiten transiciones directas desde o hacia otros estados por este flujo.

## Criterio funcional de paz y salvo
Estados que bloquean paz y salvo:
1. `ACTIVA`
2. `Pendiente`
3. `POR SALDAR`

Estados que no bloquean paz y salvo:
1. `SALDADA`
2. `APLAZADA`

## Permisos operativos
### Coordinador
Puede aplazar y reactivar sanciones dentro de su alcance de facultad.

### Laboratorista
Puede aplazar y reactivar sanciones solo si su facultad tiene autorizada accion directa por coordinador.

Autorizacion valida para habilitar esta capacidad en laboratorista:
1. `permite_crear_multas_activas_directas = true`
2. o `permite_saldar_multas_directas = true`

Si ninguna esta habilitada, laboratorista no puede aplazar ni reactivar.

## Flujo de interfaz esperado
En listado masivo:
1. Si la sancion esta en `ACTIVA` y el usuario esta autorizado, mostrar accion `Aplazar`.
2. Si la sancion esta en `APLAZADA` y el usuario esta autorizado, mostrar accion `Reactivar`.
3. Mantener trazabilidad en modal y logs de cambios de estado.

## Endpoints involucrados
1. `POST /milab/api/aprobacion_multa/aplazar`
2. `POST /milab/api/aprobacion_multa/reactivar`

## Criterios de auditoria
Cada cambio de estado debe registrar en tabla de log:
1. Actor (rol y documento)
2. Accion ejecutada
3. Referencia del sancionado
4. Fecha/hora de operacion

## Casos de prueba funcional (UAT)
1. Coordinador aplaza una sancion ACTIVA de su facultad: estado final `APLAZADA`.
2. Coordinador reactiva una sancion APLAZADA de su facultad: estado final `ACTIVA`.
3. Laboratorista con autorizacion directa aplaza ACTIVA: permitido.
4. Laboratorista con autorizacion directa reactiva APLAZADA: permitido.
5. Laboratorista sin autorizacion directa intenta aplazar: bloqueado con mensaje de no autorizado.
6. Usuario con sancion solo en estado APLAZADA puede generar paz y salvo.

## Riesgos y controles
Riesgo: rutas legacy que marcan multado sin filtrar estado.
Control: normalizar consultas para bloquear solo por estados bloqueantes (`ACTIVA`, `Pendiente`, `POR SALDAR`).

Riesgo: inconsistencia entre modulos de certificados estudiante/docente.
Control: validar mismo criterio de bloqueo en ambos flujos.

## Notas de despliegue
1. Comunicar a coordinadores y laboratoristas el significado operativo de `APLAZADA`.
2. Actualizar manuales de mesa de ayuda con las transiciones permitidas.
3. Verificar reportes o exportes que agrupen por estado para incluir `APLAZADA`.
