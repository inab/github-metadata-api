/*
const { App } = require('@octokit/app');
const { Octokit } = require('@octokit/rest');


*/

//require('dotenv').config({ path: '/app/variables/.env' });
require('dotenv').config({ path: './variables/.env' });

var info = require('debug')('node-api:info');
var error = require('debug')('node-api:error');

// The app is built in app.js so tests can load it without opening a port.
const app = require('./app');
const http = require("http");
const server = http.createServer(app);


// Starting the server
server.listen(app.get('port'), () => {
    info(`Server on port ${app.get('port')}`);
    });
