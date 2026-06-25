const express = require('express');
const path = require('path');
const app = express();
const { menuPermissionMiddleware } = require('./routes/middlewares/menu-permissions');

app.disable('x-powered-by');

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use('/inicio', menuPermissionMiddleware);
app.use('/', require('./routes/web/home'));
app.use('/api', menuPermissionMiddleware, require('./routes/api/index'));
app.use('/auth', require('./routes/api/login'));
app.use('/auth', require('./routes/api/microsoft'));
app.use('/auth', require('./routes/api/logout'));
app.use('/auth', require('./routes/api/dev-login'));

app.use('/public', express.static(path.join(__dirname, 'public')));

module.exports = app;
