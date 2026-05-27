# C4 - Componentes (backend)

## Proposito

Vista de componentes internos del backend Node.js/Express, sus responsabilidades y dependencias principales.

## Diagrama (Mermaid)

```mermaid
flowchart TB
  subgraph ExpressApp[MILab App (Express)]
    app_shell[app.js\nBootstrap, seguridad, sesion, CSP, rate limit]
    milab_router[milab_routes.js\nRouter canonico /milab y legacy /pazysalvos]
    routes_web[Rutas web\nsrc/routes/web/home]
    routes_api[Rutas API\nsrc/routes/api/index]
    auth_routes[Rutas de autenticacion\nlogin, microsoft, logout]
    middleware_auth[auth.js\nrequireUser, requireRoles, requireJsonRoles]
    middleware_menu[menu-permissions.js\nAutorizacion por menu persistido]
    middleware_nav[navigation.js\nConstruccion de navegacion y contexto de rol]
    middleware_log[request-logger.js\nTrazabilidad HTTP]
    middleware_error[error-handler.js\nManejo centralizado de errores]
  end

  subgraph DomainLibs[Librerias y servicios internos]
    db[db.js\npg Pool]
    logger[logger.js\nPino]
    menu_lib[menu.js\nMenu persistido por rol]
    roles_lib[roles.js\nNormalizacion y rol primario]
    faculty_scope[faculty-scope.js\nAlcance por facultad y UAL]
    user_identity[user-identity.js\nIdentidad y sesion]
    appurl[app-url.js\nURLs absolutas]
    recaptcha[recaptcha.js\nVerificacion anti-bot]
    mail[mail.js y emailConfig.js\nCorreo transaccional]
    cert_email[certificate-email.js\nPlantillas y envio de certificados]
    registration_token[registration-token.js\nTokens firmados]
    oati[oati-client.js\nOAuth2 client credentials + retry]
    generate_path[generate-path.js\nRutas de artefactos]
  end

  subgraph ExternalDeps[Dependencias externas]
    postgresql[(PostgreSQL)]
    entra[Microsoft Entra ID]
    oati_ext[Bus OATI / servicios academicos]
    recaptcha_ext[Google reCAPTCHA]
    smtp[SMTP Outlook / Office 365]
  end

  app_shell --> middleware_nav
  app_shell --> middleware_log
  app_shell --> milab_router
  app_shell --> auth_routes
  app_shell --> middleware_error

  milab_router --> middleware_menu
  milab_router --> routes_web
  milab_router --> routes_api
  milab_router --> auth_routes

  routes_api --> middleware_auth
  routes_api --> roles_lib
  routes_api --> faculty_scope
  routes_api --> user_identity
  routes_api --> appurl
  routes_api --> recaptcha
  routes_api --> mail
  routes_api --> cert_email
  routes_api --> registration_token
  routes_api --> oati
  routes_api --> generate_path
  routes_api --> db

  routes_web --> middleware_nav
  routes_web --> appurl
  middleware_menu --> db
  middleware_menu --> roles_lib
  middleware_nav --> menu_lib
  middleware_nav --> faculty_scope
  middleware_nav --> roles_lib
  middleware_nav --> db
  middleware_log --> logger
  middleware_error --> logger
  cert_email --> mail
  auth_routes --> user_identity
  auth_routes --> roles_lib
  auth_routes --> db
  auth_routes --> entra
  oati --> oati_ext
  recaptcha --> recaptcha_ext
  mail --> smtp
  db --> postgresql
```
