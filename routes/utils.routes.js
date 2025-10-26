const express = require('express');
const router = express.Router();
const utilsController = require('../controllers/utils.controller');

router.post('/send-test-email', utilsController.sendTestEmail);

module.exports = router;
