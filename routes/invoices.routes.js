const express = require('express');
const router = express.Router();
let invoicesController;
try { invoicesController = require('../controllers/invoices.controller'); } catch (e) { invoicesController = {}; }

function safe(fn){ return typeof fn === 'function' ? fn : (_req,res)=>res.status(500).json({error:'Invoices controller unavailable'}); }

router.get('/', safe(invoicesController.listInvoices));
router.get('/:id', safe(invoicesController.getInvoice));
router.post('/fetch', safe(invoicesController.fetchFromImap));
router.post('/parse', safe(invoicesController.parseInvoice));
router.post('/test-connection', safe(invoicesController.testImap));
router.get('/folders', safe(invoicesController.listFolders));
router.post('/send-email', 
	invoicesController.uploadMiddleware || ((req,res,next)=>next()), 
	safe(invoicesController.sendInvoiceEmail)
);

module.exports = router;
