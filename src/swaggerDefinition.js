const swaggerJsdoc = require('swagger-jsdoc');

// package.json is the single source of truth for the version. Resolved relative to
// this file rather than the process CWD, so it does not depend on where the server
// was started from.
const { version } = require('../package.json');

const options = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'GitHub Metadata API',
      version: version, // Use the version read from the file
    },
  },
  apis: ['./src/metadataExtractor/routes.js', './src/metadataUpdater/routes.js'],
};

const swaggerSpecification = swaggerJsdoc(options);

module.exports = swaggerSpecification;