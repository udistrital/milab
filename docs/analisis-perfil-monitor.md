# Analisis De Viabilidad Funcional Y Tecnica Del Perfil Monitor

## Objetivo

Evaluar la viabilidad de incorporar un nuevo perfil `monitor` en MiLab, enfocado en operacion de prestamos y recepcion de elementos, con capacidades acotadas frente a `laboratorista` y sin facultades de aprobacion o configuracion.

## Estado Actual

### Roles reconocidos por el sistema

Hoy el sistema reconoce explicitamente estos roles:

- `admin`
- `coordinador`
- `laboratorista`
- `docente`
- `estudiante`

Esto se observa en:

- `src/libs/roles.js`
- `sql-scripts/db_seed_system.sql`

El rol `monitor` no existe todavia ni en la capa de autenticacion/autorizacion, ni en semilla de roles, ni en el menu persistido.

### Modelo actual de permisos

MiLab combina tres capas de control:

1. `requireRoles(...)` para acceso backend por rol.
2. `menu_item` + `rol_permiso` para navegacion visible.
3. Alcance operativo por facultad o UAL segun rol.

En `prestamos`, la mayoria de rutas operativas estan hoy agrupadas bajo:

- `admin`
- `coordinador`
- `laboratorista`

Eso significa que el sistema ya tiene una separacion funcional clara entre:

- roles operativos de piso (`laboratorista`);
- roles de aprobacion (`coordinador`);
- roles globales (`admin`).

Desde arquitectura funcional, `monitor` encaja como un subrol operativo entre `laboratorista` y un auxiliar de ventanilla.

## Propuesta Funcional

### Definicion del perfil

El perfil `monitor` se propone como un rol operativo con alcance restringido a UAL o laboratorios asignados, orientado a ejecutar tareas de atencion presencial y trazabilidad de entregas/devoluciones, sin capacidad de autorizacion academica ni administrativa.

### Alcance funcional propuesto

Puede realizar:

- Registro de solicitudes operativas de prestamo.
- Entrega de elementos.
- Recepcion de devoluciones.
- Registro de observaciones e incidencias operativas.

No puede realizar:

- Aprobar sanciones.
- Configurar laboratorios o parametrizaciones.
- Modificar menus, roles o permisos.
- Generar o activar bloqueos de paz y salvo.
- Aprobar incidencias con impacto en paz y salvo.
- Gestionar usuarios operativos (`laboratoristas`, `coordinadores`, `admins`).

## Viabilidad Funcional

### Viable con ajustes moderados

La propuesta es funcionalmente viable porque el sistema ya separa:

- operacion de prestamo;
- entrega/recepcion;
- incidencias;
- aprobaciones;
- configuracion.

El nuevo rol puede reutilizar buena parte de los flujos ya existentes en `prestamos`, en especial:

- `gestion-solicitudes`
- `entrega-equipos`
- `incidencias`

### Restriccion importante

La funcionalidad "Registro de solicitudes" no es totalmente equivalente a habilitar la vista actual `/milab/prestamos/solicitar`, porque hoy esa ruta es de autoservicio para:

- `estudiante`
- `docente`

Por lo tanto, si se espera que el `monitor` registre solicitudes **en nombre de otro usuario**, no basta con agregar el rol a una ruta existente. Se requiere definir un flujo delegado con:

- identificacion del solicitante real;
- validacion de trazabilidad del operador;
- controles para evitar suplantacion o solicitudes inconsistentes.

## Matriz De Permisos Propuesta

| Proceso / capacidad | Estado actual | Perfil `monitor` propuesto | Observaciones |
| --- | --- | --- | --- |
| Ver modulo de prestamos operativo | `admin`, `coordinador`, `laboratorista` | Si | Requiere nuevo rol en RBAC y menu |
| Registrar solicitud propia del usuario | `estudiante`, `docente` | No directo | Solo si se diseña flujo delegado |
| Registrar solicitud operativa para tercero | No existe como flujo formal separado | Si, con nuevo flujo | Requiere nueva pantalla/reglas de negocio |
| Ver gestion de solicitudes | `admin`, `coordinador`, `laboratorista` | Si | Debe limitarse a su UAL/laboratorio |
| Aprobar solicitud | `admin`, `coordinador`, `laboratorista` | Recomendado: No | Evita elevar al monitor al nivel de laboratorista |
| Rechazar solicitud | `admin`, `coordinador`, `laboratorista` | Recomendado: No | Debe quedar en operador responsable o coordinacion |
| Entregar elementos | `admin`, `coordinador`, `laboratorista` | Si | Encaja con el rol |
| Recibir devoluciones | `admin`, `coordinador`, `laboratorista` | Si | Encaja con el rol |
| Registrar incidencia / observacion | `admin`, `coordinador`, `laboratorista` | Si | Solo registro, sin aprobacion |
| Aprobar incidencia | `admin`, `coordinador` | No | Mantener separacion de control |
| Definir impacto en paz y salvo | `admin`, `coordinador` | No | Es una decision disciplinaria |
| Convertir incidencia a bloqueo | `admin`, `coordinador` | No | Debe seguir en coordinacion |
| Aprobar multa / saldar multa | `coordinador` | No | Sin cambios |
| Configurar laboratorios / parametrizaciones | `admin`, `coordinador` segun modulo | No | Sin cambios |
| Administrar menus y permisos | `admin` | No | Sin cambios |
| Dashboard / monitoreo | `admin`, `coordinador`, `laboratorista` | Opcional, acotado | Recomendado: solo indicadores operativos |
| Auditoria completa | `admin`, `coordinador`, `laboratorista` en prestamos | Opcional, parcial | Recomendado: solo eventos de su alcance |

## Matriz Tecnica De Impacto

| Capa | Impacto | Nivel |
| --- | --- | --- |
| `src/libs/roles.js` | Agregar `monitor` en prioridad y etiqueta | Bajo |
| `sql-scripts/db_seed_system.sql` | Crear rol y permisos de menu | Medio |
| `menu_item` / `rol_permiso` | Asignar menu del monitor | Medio |
| `src/routes/middlewares/navigation.js` | Agregar menu estatico fallback | Bajo |
| `src/libs/prestamos-module-access.js` | Resolver alcance del monitor | Medio |
| `src/routes/api/prestamos.js` | Ajustar `requireRoles(...)` y separar acciones permitidas vs no permitidas | Alto |
| Modelo de asignacion operativa | Definir si el monitor usa UAL/laboratorio | Alto |
| Auditoria `log` | Mantener trazabilidad del actor monitor | Bajo |
| Documentacion RBAC | Actualizar mapas y matrices | Bajo |

## Impacto En Procesos Existentes

### 1. Prestamos

Impacto medio-alto.

Hoy varias rutas de `prestamos` agrupan en una sola autorizacion acciones de:

- consulta;
- aprobacion;
- entrega;
- recepcion;
- incidencias.

Si se introduce `monitor`, no es recomendable copiar exactamente todos los permisos del `laboratorista`, porque eso le daria capacidades no deseadas como aprobacion/rechazo de solicitudes si la ruta sigue compartida.

Se requerira dividir permisos por accion, por ejemplo:

- `monitor`: ver gestion, entregar, recibir, reportar incidencia;
- `laboratorista`: lo anterior mas aprobaciones operativas si se mantiene ese modelo;
- `coordinador`: aprobacion disciplinaria y alcance academico.

### 2. Sanciones y paz y salvo

Impacto bajo si el rol se diseña correctamente.

La recomendacion es mantener al `monitor` totalmente fuera de:

- `aprobacion_multa`
- `submit`
- `submit_docente`
- activacion/saldado de sanciones
- decisiones de bloqueo de paz y salvo

Asi se conserva la segregacion de funciones.

### 3. Navegacion y experiencia de usuario

Impacto medio.

Se debe crear un menu simplificado para `monitor`, idealmente con solo:

- `Inicio`
- `Prestamos > Gestion de solicitudes`
- `Prestamos > Entrega y devolucion`
- `Prestamos > Incidencias`
- `Perfil`

No deberian aparecer menus de:

- configuracion;
- autorizaciones;
- administracion;
- sanciones disciplinarias;
- menus/permisos.

### 4. Trazabilidad y auditoria

Impacto bajo.

La infraestructura de auditoria ya existe mediante `log`, por lo que el nuevo rol puede registrarse sin rediseño profundo. El valor agregado sera definir claramente:

- que acciones del monitor generan log;
- como se diferencia de laboratorista;
- si actua sobre solicitudes propias o delegadas.

## Riesgos Identificados

### Riesgos funcionales

- Ambiguedad entre `monitor` y `laboratorista` si ambos pueden hacer casi lo mismo.
- Confusion operativa si el monitor puede crear solicitudes para terceros sin reglas de negocio explicitas.
- Solapamiento de responsabilidades con coordinadores en casos de incidencias y sanciones.

### Riesgos tecnicos

- Varias rutas de `prestamos` hoy mezclan permisos heterogeneos bajo el mismo middleware.
- El alcance operativo actual solo contempla `coordinador` y `laboratorista`; `monitor` no tiene modelo de alcance propio.
- El menu fallback y el menu persistido tendrian que actualizarse en paralelo para evitar incoherencias visuales.

### Riesgos de seguridad

- Escalamiento de privilegios si se agrega `monitor` a middlewares amplios sin separar acciones criticas.
- Riesgo de suplantacion si el monitor registra solicitudes para terceros sin validaciones adicionales.
- Puntos ciegos de auditoria si no se registran claramente actor, usuario final beneficiario y contexto de operacion.

## Alternativas Tecnicas

### Opcion A. Reutilizar el alcance de laboratorista

Consiste en:

- crear rol `monitor`;
- reutilizar logica similar a `laboratorista_ual`;
- habilitar solo ciertas rutas y vistas.

Ventajas:

- menor tiempo de salida;
- menos cambios de esquema;
- reutiliza consultas existentes por UAL/laboratorio.

Desventajas:

- acopla semanticamente a `monitor` con `laboratorista`;
- dificulta diferenciar reglas futuras;
- puede inducir atajos inseguros en middleware compartido.

### Opcion B. Crear modelo propio `monitor` + asignacion a UAL

Consiste en:

- agregar rol `monitor`;
- crear entidad de asignacion operativa dedicada, por ejemplo `monitor_ual`;
- extender resolucion de alcance en `prestamos`;
- crear menu y permisos propios.

Ventajas:

- separacion limpia de responsabilidades;
- mejor trazabilidad organizacional;
- facilita crecimiento futuro del perfil.

Desventajas:

- mayor esfuerzo inicial;
- requiere cambios de BD, seed, UI administrativa y consultas.





**Si el perfil `monitor` va a ser permanente y con identidad organizacional propia, se recomienda la Opcion B: rol dedicado + asignacion dedicada a UAL.**

Justificacion:

- evita mezclar al monitor con el laboratorista;
- permite modelar permisos minimos reales;
- reduce riesgo de escalamiento accidental;
- prepara mejor el sistema para auditoria y segregacion de funciones.

### 

Para una primera version, el `monitor` deberia quedar limitado a:

- consultar solicitudes dentro de su alcance;
- registrar recepcion/entrega;
- reportar incidencias u observaciones;
- consultar estado operativo de equipos y prestamos.

No deberia incluir en fase 1:

- aprobacion/rechazo de solicitudes;
- registro de sanciones formales;
- cambios sobre paz y salvo;
- configuraciones;
- gestion de usuarios.

## Implementacion Recomendada

### Fase 1. Definicion y control de acceso

1. Agregar rol `monitor` en:
   - `rol`
   - `src/libs/roles.js`
2. Crear menu y `rol_permiso` especificos.
3. Extender `navigation.js` para fallback visual.
4. Incorporar alcance del monitor en `prestamos-module-access.js` y en `resolveLoanManagementScope(...)`.

### Fase 2. Segmentacion de rutas de prestamos

1. Separar rutas de consulta/operacion de rutas de aprobacion.
2. Crear middlewares mas finos, por ejemplo:
   - `requireLoanOperationsAccess`
   - `requireLoanApprovalAccess`
   - `requireIncidentReportingAccess`
   - `requireIncidentApprovalAccess`
3. Asignar `monitor` solo a middlewares operativos.

### Fase 3. Solicitudes delegadas

Solo si el negocio lo requiere:

1. Diseñar flujo para registrar solicitudes en nombre de terceros.
2. Guardar actor operador y usuario solicitante final.
3. Agregar mensajes, auditoria y validaciones especificas.

### Fase 4. Documentacion y control

1. Actualizar:
   - `docs/matriz-accesos.md`
   - `docs/route-access-map.md`
   - `docs/architecture/security-rbac.md`
   - `docs/README-flujos-procesos.md`
2. Validar con negocio la segregacion de funciones.

## Conclusion

La incorporacion del perfil `monitor` es **viable**, pero **no deberia implementarse como una simple copia del `laboratorista`**.

La viabilidad es alta si se define al monitor como un rol operativo restringido, sin aprobaciones disciplinarias ni administrativas. El principal punto de cuidado esta en `prestamos`, donde hoy varias acciones distintas comparten los mismos middlewares de autorizacion. Por eso, el cambio recomendable no es solo agregar un rol, sino refinar el RBAC por tipo de accion.

## Resumen Ejecutivo

- **Viabilidad funcional:** alta.
- **Viabilidad tecnica:** media.
- **Esfuerzo estimado:** medio si solo se limita a entrega/recepcion/incidencias; medio-alto si incluye registro delegado de solicitudes.
- **Riesgo principal:** darle al monitor permisos demasiado amplios por reutilizar middlewares de `laboratorista`.
- **Recomendacion:** crear rol `monitor` con alcance propio por UAL y permisos operativos minimos.

