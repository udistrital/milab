# Despliegue de milab en Producción (ECS + RDS)

Este documento describe los pasos recomendados para desplegar la aplicación milab en un entorno de producción usando AWS ECS (Elastic Container Service) para la aplicación y AWS RDS (Relational Database Service) para la base de datos PostgreSQL.

---

## 1. Prerrequisitos

- Cuenta de AWS con permisos para ECS, ECR, RDS, IAM y VPC.
- Docker instalado localmente para construir la imagen.
- Acceso a los secretos y variables de entorno de producción.

---

## 2. Base de Datos (RDS)

1. **Crear una instancia RDS PostgreSQL**
   - Elige la versión compatible con tu aplicación.
   - Configura el nombre de la base de datos, usuario, contraseña y VPC/subredes.
   - Habilita el acceso solo desde la VPC/subred donde correrá ECS.
   - Aplica los scripts de estructura y seed si es necesario (`sql-scripts/db_structure.sql`, `db_seed_system.sql`).

2. **Configura los parámetros de conexión**
   - Obtén el endpoint, puerto, usuario, contraseña y nombre de la base de datos.
   - Actualiza el archivo de entorno de producción (`Docker/.prodenv`) con estos valores:
     - `DB_HOST=<endpoint RDS>`
     - `DB_PORT=<puerto RDS>`
     - `DB_USER=<usuario>`
     - `DB_PASSWORD=<contraseña>`
     - `DB_NAME=<nombre de la base de datos>`

---

## 3. Imagen de la Aplicación

1. **Construir la imagen Docker**
   ```sh
   docker build -t milab:prod .
   ```
2. **Subir la imagen a ECR (Elastic Container Registry)**
   - Crea un repositorio en ECR.
   - Etiqueta y sube la imagen:
     ```sh
     aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
     docker tag milab:prod <account-id>.dkr.ecr.<region>.amazonaws.com/milab:prod
     docker push <account-id>.dkr.ecr.<region>.amazonaws.com/milab:prod
     ```

---

## 4. Definición de la Tarea (Task Definition)

- Crea una Task Definition en ECS con:
  - Imagen: la URL de ECR subida.
  - Variables de entorno: copia el contenido de `Docker/.prodenv` (puedes usar AWS Secrets Manager para los secretos).
  - Configura puertos (por ejemplo, 3000).
  - Asigna un rol de tarea adecuado para acceso a otros servicios (por ejemplo, Secrets Manager, CloudWatch).

---

## 5. Servicio ECS

- Crea un servicio ECS (Fargate o EC2) en el cluster deseado.
- Asocia la Task Definition creada.
- Configura el balanceador de carga (ALB/NLB) si es necesario.
- Asegúrate de que las reglas de seguridad permitan el tráfico HTTP/HTTPS y el acceso a RDS solo desde ECS.

---

## 6. Variables de Entorno y Secretos

- Usa AWS Secrets Manager o Parameter Store para manejar contraseñas y secretos.
- No subas archivos `.env` con secretos a repositorios públicos.
- Revisa y ajusta los valores en `Docker/.prodenv` antes de desplegar.

Controles de seguridad recomendados para autenticación:
- `ENABLE_DEV_LOGIN=false` en producción.
- `ADMINDEV` debe permanecer vacío en producción.
- `ADMINDEV_HASH` y `DEV_LOGIN_HEADER_SECRET` se usan solo en desarrollo con `ENABLE_DEV_LOGIN=true`.
- `ALLOW_PUBLIC_SERVICE_STATUS` debe permanecer deshabilitado en producción (evita exponer endpoints de diagnóstico).
- `DEPLOYMENT_ENV=production` y `ALLOWED_DEV_RUNTIME_ENVS=local` para impedir que `NODE_ENV=dev` arranque en ambientes no permitidos.
- Si por error `ENABLE_DEV_LOGIN=true` o `ADMINDEV` tiene valor en producción, la aplicación ahora falla al iniciar (fail-fast).
- Si por error `ALLOW_PUBLIC_SERVICE_STATUS=true` fuera de `dev|development|local`, la aplicación falla al iniciar (fail-fast).
- En ambientes de desarrollo, limita `DEV_LOGIN_ALLOWED_IPS` a loopback o red interna de confianza.

---

## 7. Logs y Monitoreo

- Configura la salida de logs a CloudWatch Logs desde ECS.
- Habilita métricas y alarmas para la base de datos y la aplicación.

---

## 8. Notas Adicionales

- No se crea contenedor para la base de datos en producción.
- Revisa los scripts de inicialización y migración antes de lanzar la app.
- Mantén actualizado el archivo de variables de entorno y los secretos.

---

## 9. Referencias
- [AWS ECS Docs](https://docs.aws.amazon.com/ecs/latest/developerguide/)
- [AWS RDS Docs](https://docs.aws.amazon.com/rds/)
- [AWS ECR Docs](https://docs.aws.amazon.com/AmazonECR/latest/userguide/)

---

¿Dudas o problemas? Contacta al equipo de desarrollo o al responsable de infraestructura.
