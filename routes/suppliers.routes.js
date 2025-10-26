const express = require('express');
const router = express.Router();
const suppliersController = require('../controllers/suppliers.controller');

// NEW: Core Flow Implementation - additional endpoints for activate/deactivate, review queue, and contacts
router.get('/', suppliersController.listSuppliers);
router.get('/duplicates', suppliersController.findDuplicates);
router.get('/review-queue', suppliersController.getReviewQueue);
router.post('/auto-link', suppliersController.autoLinkInvoices);
router.get('/:id', suppliersController.getSupplier);
router.post('/', suppliersController.createSupplier);
router.put('/:id', suppliersController.updateSupplier);
router.post('/delete', suppliersController.deleteSuppliers);
router.post('/merge', suppliersController.mergeSuppliers);
router.post('/block', suppliersController.blockSuppliers);
router.post('/activate', suppliersController.activateSuppliers);
router.post('/deactivate', suppliersController.deactivateSuppliers);

// Contacts sub-resource
router.get('/:supplierId/contacts', suppliersController.listContacts);
router.post('/:supplierId/contacts', suppliersController.createContact);
router.put('/contacts/:contactId', suppliersController.updateContact);
router.delete('/contacts/:contactId', suppliersController.deleteContact);

module.exports = router;
