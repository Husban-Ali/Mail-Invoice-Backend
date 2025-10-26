const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/retrieval.controller');

router.get('/status', ctrl.getStatus);
router.post('/status', ctrl.setStatus);
router.get('/config', ctrl.getConfig);
router.post('/config', ctrl.setConfig);
router.post('/run', ctrl.runNow);
router.get('/logs', ctrl.listLogs);

module.exports = router;
