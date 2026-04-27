# C4 - Componentes (backend)

## Proposito

Vista de componentes internos del backend Node.js.

## Diagrama (Mermaid)

```mermaid
flowchart TB
  subgraph ExpressApp[MiLab App (Express)]
    routes_web[Rutas web\nsrc/routes/web]
    routes_api[Rutas API\nsrc/routes/api]
    middleware_auth[Middleware de auth\nrequireUser/requireRoles]
    middleware_nav[Middleware de navegacion]
    middleware_log[Logger de requests + logger de seguridad]
  end

  subgraph Libs[Librerias]
    db[db.js\npg Pool]
    logger[logger.js\nPino]
    appurl[app-url.js]
    recaptcha[recaptcha.js]
    mail[mail.js\nNodemailer]
    cert_email[certificate-email.js]
    faculty_scope[faculty-scope.js]
    registration_token[registration-token.js]
    user_identity[user-identity.js]
    roles_lib[roles.js]
    generate_path[generate-path.js]
  end

  routes_api --> middleware_auth
  routes_api --> db
  routes_api --> recaptcha
  routes_api --> appurl
  routes_api --> mail
  routes_api --> cert_email
  routes_api --> faculty_scope
  routes_api --> registration_token
  routes_api --> user_identity
  routes_api --> roles_lib
  routes_api --> generate_path

  routes_web --> middleware_nav
  routes_web --> middleware_log
  routes_web --> appurl

  middleware_log --> logger
  cert_email --> mail
```
