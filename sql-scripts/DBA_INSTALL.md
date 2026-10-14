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
- db_seed_pruebas_local.sql: precarga local de pruebas (NO usar en produccion).

## Orden de ejecucion

Ejecutar en este orden:

1. db_structure.sql
2. db_seed_system.sql
3. db_structure_prestamos.sql
4. db_seed_prestamos.sql
5. db_structure_inventarios.sql
6. db_seed_inventarios.sql
7. db_structure_certificacion.sql
8. db_seed_certificacion.sql

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
psql -h <host> -p <port> -U <user> -d <db> -f db_seed_inventarios.sql
psql -h <host> -p <port> -U <user> -d <db> -f db_structure_certificacion.sql
psql -h <host> -p <port> -U <user> -d <db> -f db_seed_certificacion.sql

## Consideraciones

- db_seed_system.sql crea roles, menus, permisos y dos usuarios admin por defecto.
  Se recomienda cambiar las credenciales y correos en produccion.
- Respete el orden indicado: cada seed se ejecuta despues de su estructura y el seed
  de inventarios necesita los roles y menus base creados por db_seed_system.sql.
- db_structure_inventarios.sql migra los campos descriptivos antiguos de equipo a
  inventario y crea equipo_catalogo. Debe ejecutarse antes de db_seed_certificacion.sql.
- equipo conserva su id y solo los datos operativos; consultas descriptivas deben usar
  la vista equipo_catalogo, que proyecta la informacion canonica de inventario.
- En una base existente, detenga la aplicacion antes de ejecutar db_structure_inventarios.sql;
  el script conserva los ids y migrará los equipos sin vínculo a registros tipo legado.
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
