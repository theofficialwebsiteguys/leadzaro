'use strict';

const { listSectionDefinitionsForRequester } = require('../../core/authorization/clientVisibleModels');

function listSectionDefinitions(context) {
  return listSectionDefinitionsForRequester(context);
}

module.exports = { listSectionDefinitions };
