# Release Notes - Prestamos 2.0

Fecha de release: 2026-08-09
Version: 2.0.0
Alcance: modulo de prestamos y su operacion en CI/despliegue de pruebas.

## Resumen

Prestamos 2.0 consolida el modulo operativo de solicitudes, entrega/devolucion, incidencias, practicas, reportes y parametrizaciones con controles RBAC mas finos, mejoras de estabilidad y hardening del flujo de recreacion de base de datos en pruebas.

## Novedades Principales

1. Operacion integral del modulo de prestamos con menus por rol y permisos por capacidad.
2. Flujos de practicas (libres y docentes) con gestion operativa y seguimiento por estado.
3. Gestion de incidencias con aprobacion, conversion y trazabilidad.
4. Recordatorios por correo para prestamos y practicas cercanas a inicio.
5. Ajustes de acceso por facultad para coordinador, laboratorista y monitor.
6. Validaciones y endurecimiento de pipeline CI para ejecucion de SQL en orden estricto.

## Cambios Tecnicos Relevantes

1. Version de paquete actualizada a 2.0.0.
2. Version visible de aplicacion por defecto actualizada a 2.0.0 (via APP_VERSION configurable).
3. Flujo de recreacion de BD en pruebas estandarizado en 4 scripts:
   - db_structure.sql
   - db_seed.sql o db_seed_system.sql
   - db_structure_prestamos.sql
   - db_seed_prestamos.sql
4. Ejecucion de SQL con ON_ERROR_STOP=1 para fail-fast.
5. Integracion de pruebas unitarias e integracion como puerta previa al despliegue.

## Calidad y Estabilidad

1. Se resolvieron bloqueos de formato y lint del pipeline.
2. Se estabilizo una ruta que provocaba cancelacion de test unitario por respuesta pendiente.
3. Estado validado en la corrida de referencia:
   - Unit: 229 pass, 0 fail, 0 cancelled.
   - Integracion: 20 pass, 0 fail, 0 cancelled.
4. Sonar local en cero para code smells, bugs, vulnerabilities y security hotspots.

## Compatibilidad y Despliegue

1. Compatible con el despliegue actual en EC2 de pruebas.
2. Requiere mantener /opt/.env enlazado a /opt/milab/Docker/.env para compose en el host.
3. Para versionado visible, definir APP_VERSION=2.0.0 en el entorno de despliegue.

## Riesgos Conocidos y Recomendaciones

1. Si APP_VERSION no se define en entornos externos, se mostrara 2.0.0 por defecto.
2. Mantener sincronizados scripts SQL y workflow CI cuando cambie el modelo de datos.
3. Ejecutar siempre ci:check y npm test antes de promover cambios de prestamos.

## Checklist de Release

1. Version de package.json en 2.0.0.
2. Workflow CI con validacion de secuencia SQL en 4 pasos.
3. Pruebas unitarias e integracion en verde.
4. Documentacion operativa actualizada (README, deployment, testing).
