'use strict';

const sectionDefinitionService = require('./sectionDefinitionService');
const { success } = require('../../utils/response');

async function list(req, res, next) {
  try {
    const sectionDefinitions = await sectionDefinitionService.listSectionDefinitions(req.context);
    return success(res, { sectionDefinitions });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
