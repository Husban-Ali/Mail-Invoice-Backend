const express = require('express');
const router = express.Router();
const rules = require('../controllers/rules.controller');

router.get('/', rules.listRules);
router.get('/:id', rules.getRuleById);
router.post('/', rules.createRule);
router.put('/:id', rules.updateRule);
router.post('/delete', rules.deleteRules);
router.post('/:id/activate', rules.activateRule);

module.exports = router;
