# Gua de instalacion BD (DBA)

Este documento describe como instalar el esquema y la precarga base de MiLab en PostgreSQL.

## Requisitos

- PostgreSQL 13+ (se ha usado postgres:latest en Docker)
- Permisos para CREATE EXTENSION pgcrypto
- Un usuario con permisos de crear tablas, indices y claves foraneas

## Archivos

- db_structure.sql: estructura completa, ajustes idempotentes, constraints e indices.
- db_seed_system.sql: catalogos base y bootstrap del modelo RBAC.
- db_seed_pruebas_local.sql: precarga local de pruebas (NO usar en produccion).

## Orden de ejecucion

Ejecutar en este orden:

1. db_structure.sql
2. db_seed_system.sql

## Comandos recomendados (psql)

Reemplazar variables de conexion segun el ambiente.

1. Estructura:

psql -h <host> -p <port> -U <user> -d <db> -f db_structure.sql

2. Catalogos y RBAC:

psql -h <host> -p <port> -U <user> -d <db> -f db_seed_system.sql

## Consideraciones

- db_seed_system.sql crea roles, menus, permisos y dos usuarios admin por defecto.
  Se recomienda cambiar las credenciales y correos en produccion.
- Los scripts son idempotentes en la mayoria de operaciones, pero no sustituyen una
  migracion formal si hay cambios mayores.
- Si no se permite CREATE EXTENSION pgcrypto, ejecutar la extension como superusuario
  o pedir al DBA que la habilite.

## Verificacion rapida

Consultas sugeridas despues de ejecutar los scripts:

- Tablas base:
  SELECT COUNT(_) FROM roles;
  SELECT COUNT(_) FROM menu_items;
  SELECT COUNT(\*) FROM role_permissions;

- Usuarios admin:
  SELECT documento, tipo, correo FROM auth WHERE tipo = 'admin';

## Alcance

Este flujo instala la base limpia con catalogos base. No incluye datos piloto ni
precargas locales (db_seed_pruebas_local.sql).
