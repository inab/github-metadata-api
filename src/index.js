/*
const { App } = require('@octokit/app');
const { Octokit } = require('@octokit/rest');


*/

//require('dotenv').config({ path: '/app/variables/.env' });
require('dotenv').config({ path: './variables/.env' });

var info = require('debug')('node-api:info');
var error = require('debug')('node-api:error');

const express = require('express');
var cors = require('cors')
const morgan = require('morgan'); 
const app = express();
const http = require("http");
const server = http.createServer(app);
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swaggerDefinition');

// Settings
app.set('port', process.env.PORT || 3800);
app.set('json spaces', 2);

// Middleware
app.use(morgan('dev'));
app.use(cors())
app.use(express.urlencoded({extended:false}));
app.use(express.json());
app.use(helmet());



// Routes
app.use(require('./metadataExtractor/routes'));
app.use(require('./metadataUpdater/routes'));


// Serve Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


// Starting the server
server.listen(app.get('port'), () => {
    info(`Server on port ${app.get('port')}`);
    });
