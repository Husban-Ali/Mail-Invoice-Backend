const express = require('express');
const router = express.Router();
const exportsController = require('../controllers/exports.controller');

router.get('/templates', exportsController.listTemplates);
router.post('/templates', exportsController.createTemplate);
router.put('/templates/:id', exportsController.updateTemplate);
router.delete('/templates/:id', exportsController.deleteTemplate);

router.get('/runs', exportsController.listRuns);
router.get('/runs/:id', exportsController.getRun);
router.get('/runs/:id/download', exportsController.downloadRun);

router.post('/run', exportsController.runExport);
router.post('/presets', exportsController.createPresets);

module.exports = router;
