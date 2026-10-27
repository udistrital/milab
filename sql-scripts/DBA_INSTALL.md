# Gua de instalacion BD (DBA)

Este documento describe como instalar el esquema y la precarga base de MILab en PostgreSQL.

## Requisitos

- PostgreSQL 13+ (se ha usado postgres:latest en Docker)
- Permisos para CREATE EXTENSION pgcrypto
- Un usuario con permisos de crear tablas, indices y claves foraneas

## Archivos

- db_structure.sql: estructura completa, ajustes idempotentes, constraints e indices.
- db_seed_system.sql: catalogos base y bootstrap del modelo RBAC.
- db_structure_prestamos.sql / db_seed_prestamos.sql: estructura y menus del modulo de prestamos.
- db_structure_certificacion.sql / db_seed_certificacion.sql: estructura y catalogos de certificacion.
- db_structure_inventarios.sql / db_seed_inventarios.sql: estructura y menus/permisos del modulo de inventarios.
- [sql/20261021_gestor_laboratorio.sql](../sql/20261021_gestor_laboratorio.sql): inicializa el rol, su acceso administrativo y la gestión global de encuentros en bases existentes.
- [sql/20261021_coordinador_ual_encargado.sql](../sql/20261021_coordinador_ual_encargado.sql): crea o recupera la relación entre coordinadores encargados y UAL en bases existentes.
- [sql/20261023_encuentros_app_permissions.sql](../sql/20261023_encuentros_app_permissions.sql): garantiza permisos de lectura y escritura para el usuario PostgreSQL `milab_app` en las tablas de Encuentros.
- db_seed_pruebas_ofuscado.sql: datos de prueba derivados del libro ofuscado; se ejecuta solo al reconstruir el ambiente de pruebas, nunca en producción.
- scripts/generate_ofuscado_seed.py: regenera el seed anterior desde el libro ofuscado y el catalogo del sistema.
- db_seed_pruebas_local.sql: precarga local de pruebas (NO usar en produccion).

## Orden de ejecucion

Ejecutar en este orden:

1. db_structure.sql
2. db_seed_system.sql
3. db_structure_prestamos.sql
4. db_seed_prestamos.sql
5. db_structure_inventarios.sql
6. db_structure_certificacion.sql
7. db_seed_certificacion.sql
8. db_seed_inventarios.sql
9. db_seed_pruebas_ofuscado.sql (solo al reconstruir el ambiente de pruebas)

## Comandos recomendados (psql)

Reemplazar variables de conexion segun el ambiente.

1. Estructura base y permisos:

psql -h <host> -p <port> -U <user> -d <db> -f db_structure.sql

2. Catalogos y RBAC:

psql -h <host> -p <port> -U <user> -d <db> -f db_seed_system.sql

3. Modulos:

psql -h <host> -p <port> -U <user> -d <db> -f db_structure_prestamos.sql
psql -h <host> -p <port> -U <user> -d <db> -f db_seed_prestamos.sql
psql -h <host> -p <port> -U <user> -d <db> -f db_structure_inventarios.sql
psql -h <host> -p <port> -U <user> -d <db> -f db_structure_certificacion.sql
psql -h <host> -p <port> -U <user> -d <db> -f db_seed_certificacion.sql
psql -h <host> -p <port> -U <user> -d <db> -f db_seed_inventarios.sql
psql -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d <db> -f db_seed_pruebas_ofuscado.sql
```

Para actualizar una base existente con el rol Gestor de laboratorio y habilitar su gestión
global de encuentros, aplicar antes del despliegue:

```sh
psql -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d <db> -f sql/20261021_gestor_laboratorio.sql
```

Después del despliegue, un administrador también puede abrir **Configuración → Roles** y usar
**Verificar y configurar**. La acción reutiliza el rol `gestor_laboratorio`, completa de forma
transaccional los permisos de menú faltantes y puede repetirse sin duplicar registros; no asigna
el rol a cuentas. Si el usuario de conexión de la aplicación no tiene permisos de escritura sobre
`rol`, `menu_item` y `rol_permiso`, debe aplicarse la migración con una cuenta DBA.

Si el monitoreo muestra `relation "coordinador_ual_encargado" does not exist`, detener la
aplicación y aplicar la migración idempotente que crea la tabla y recupera las asignaciones
desde las cargas aprobadas. La estructura de inventarios debe existir previamente:

```sh
psql -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d <db> -f sql/20261021_coordinador_ual_encargado.sql
```

Si el usuario de conexión de la aplicación no puede crear o actualizar eventos de Encuentros,
aplique esta migración como DBA o propietario de los objetos. Concede `SELECT`, `INSERT` y
`UPDATE` sobre sus tablas y `USAGE`/`SELECT` sobre las secuencias `id`; no concede `DELETE`
ni privilegios de propietario. El nombre `milab_app` debe coincidir con el usuario que muestra
el diagnóstico de producción:

```sh
psql -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d <db> -f sql/20261023_encuentros_app_permissions.sql
```

El seed ofuscado se aplica como último paso únicamente durante la reconstrucción completa
del ambiente de pruebas. El pipeline no lo ejecuta en despliegues que conservan la base
existente; no debe aplicarse en producción.

Para regenerar el seed a partir del Excel ofuscado:

```sh
python3 scripts/generate_ofuscado_seed.py
```

El seed de pruebas es aditivo e idempotente; no borra tablas ni registros. Ajusta las
facultades del catalogo a los IDs del libro, crea dependencias de prueba según los
conteos del libro y distribuye UALs existentes de forma deterministica entre esas
dependencias, dejando algunos UALs directamente en cada facultad para probar ambos
alcances. Distribuye coordinadores entre alcance de facultad, dependencia o UAL;
asigna laboratoristas según las sanciones cuando existe esa relacion y completa los
que no tienen relacion explicita de manera deterministica. Los nombres de UAL de
sanciones sin coincidencia exacta se asignan a UALs ya existentes del seed del sistema.
Estas asignaciones son datos sinteticos para cubrir casos de prueba, no representan
asignaciones oficiales. No crea UALs nuevos.

## Consideraciones

- db_seed_system.sql crea roles, menus, permisos y dos usuarios admin por defecto.
  Se recomienda cambiar las credenciales y correos en produccion.
- Respete el orden indicado: cada seed se ejecuta despues de su estructura y el seed
  de inventarios necesita los roles y menus base creados por db_seed_system.sql.
- db_structure_inventarios.sql migra los campos descriptivos antiguos de equipo a
  inventario y crea equipo_catalogo. Debe ejecutarse antes de db_seed_certificacion.sql.
- db_seed_inventarios.sql se ejecuta despues de db_seed_certificacion.sql porque
  crea relaciones de equipo especializado para los cursos de prueba.
- En una base existente, aplique `sql/20261021_gestor_laboratorio.sql` antes de
  desplegar la aplicacion. El script de instalacion completa ya crea el rol y su
  opcion administrativa desde `db_seed_system.sql`.
- equipo conserva su id y solo los datos operativos; consultas descriptivas deben usar
  la vista equipo_catalogo, que proyecta la informacion canonica de inventario.
- En una base existente, detenga la aplicacion antes de ejecutar db_structure_inventarios.sql;
  el script conserva los ids y migrará los equipos sin vínculo a registros tipo legado.
- Este mismo script crea coordinador_ual_encargado, requerido por inventarios, facultades,
  coordinadores registrados y dashboard. Recupera el encargado de la primera carga aprobada
  de cada UAL (fecha de resolucion e ID), conserva relaciones existentes y dirige las cargas
  pendientes al encargado. Debe ejecutarse antes de iniciar la nueva version de la aplicacion.
- En bases existentes donde esa tabla aún no exista, la migración
  `sql/20261021_coordinador_ual_encargado.sql` permite crearla sin volver a ejecutar toda
  la migración de inventarios.
- Los scripts son idempotentes en la mayoria de operaciones, pero no sustituyen una
  migracion formal si hay cambios mayores.
- Si no se permite CREATE EXTENSION pgcrypto, ejecutar la extension como superusuario
  o pedir al DBA que la habilite.

## Verificacion rapida

Consultas sugeridas despues de ejecutar los scripts:

- Tablas base:
  SELECT COUNT(_) FROM rol;
  SELECT COUNT(_) FROM menu_item;
  SELECT COUNT(\*) FROM rol_permiso;

- Usuarios admin:
  SELECT u.documento, u.correo, r.nombre AS rol
  FROM usuario u
  JOIN usuario_rol ur ON ur.usuario_id = u.id
  JOIN rol r ON r.id = ur.rol_id
  WHERE r.nombre = 'admin';

## Alcance

Este flujo instala la base limpia con catalogos y menus de los modulos descritos. No
incluye datos piloto ni precargas locales (db_seed_pruebas_local.sql).
