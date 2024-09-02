const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  swaggerDefinition: {
   openapi: '3.0.0',
    info: {
      title: 'GitHub Metadata API',
      version: '0.0.1',
    },
  },
  apis: ['./src/metadataExtractor/routes.js', './src/metadataUpdater/routes.js'],
};

const swaggerSpecification = swaggerJsdoc(options);

module.exports = swaggerSpecification;

