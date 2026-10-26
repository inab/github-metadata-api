var cors = require('cors')
const morgan = require('morgan');
const express = require('express');
const app = express();
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swaggerDefinition');

// Settings
app.set('port', process.env.PORT || 3800);
app.set('json spaces', 2);

// Middleware
// Jest sets NODE_ENV=test; the per-request log would drown the test output.
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
}
app.use(cors())
app.use(express.urlencoded({extended:false}));
app.use(express.json());
app.use(helmet());



// Routes
app.use(require('./metadataExtractor/routes'));
app.use(require('./metadataUpdater/routes'));

var options = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "GitHub Metadata API",
    customfavIcon: "/assets/favicon.ico"
  };

const path = require('path');
app.get('/assets/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, './assets', 'favicon.ico'));
});

// Serve Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, options));

module.exports = app;
