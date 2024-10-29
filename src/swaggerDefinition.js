const fs = require('fs');
const swaggerJsdoc = require('swagger-jsdoc');

// Read version from the VERSION file in the parent directory
const version = fs.readFileSync('../VERSION', 'utf8').trim();

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