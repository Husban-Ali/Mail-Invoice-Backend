const express = require('express');
const router = express.Router();
const scrapedDataController = require('../controllers/scrapedData.controller');

// Get all scraped invoices with filters
// Query params: supplier, status, startDate, endDate, format, limit, offset
router.get('/', scrapedDataController.getScrapedInvoices);

// Get statistics for dashboard
// Query params: startDate, endDate
router.get('/stats', scrapedDataController.getScrapedStats);

// Get list of suppliers/vendors for filter dropdown
router.get('/suppliers', scrapedDataController.getSuppliers);

// Get single invoice by ID
router.get('/:id', scrapedDataController.getInvoiceById);

// Update invoice status
// Body: { status: 'Parsed' | 'Error' | 'Pending' }
router.patch('/:id/status', scrapedDataController.updateInvoiceStatus);

// Delete invoice(s)
// Body: { ids: [id1, id2, ...] }
router.delete('/', scrapedDataController.deleteInvoices);

// Export invoices to CSV
// Query params: same as GET / (supplier, status, startDate, endDate, format)
router.get('/export/csv', scrapedDataController.exportInvoices);

// Bulk update invoices
// Body: { ids: [id1, id2, ...], updates: { field: value, ... } }
router.patch('/bulk', scrapedDataController.bulkUpdateInvoices);

module.exports = router;
