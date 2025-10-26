const supabase = require('../config/supabaseClient');

function getUserId(req){ return req.user && req.user.id ? req.user.id : null; }

/**
 * Get all scraped invoices with optional filters
 * Query params: supplier, status, startDate, endDate, format
 */
async function getScrapedInvoices(req, res) {
  try {
    const { supplier, status, startDate, endDate, format, limit = 100, offset = 0 } = req.query;

    let query = supabase
      .from('invoices')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    const userId = getUserId(req);
    if (userId) query = query.eq('user_id', userId);

    // Apply filters
    if (supplier && supplier !== 'All') {
      query = query.eq('vendor', supplier);
    }

    if (status && status !== 'All') {
      query = query.eq('status', status);
    }

    if (format && format !== 'All') {
      query = query.eq('format', format);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    // Pagination
    query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching scraped invoices:', error);
      return res.status(500).json({ error: error.message });
    }

    // Transform data to match frontend format
    const transformedData = data.map(invoice => ({
      id: invoice.id,
      date: invoice.created_at ? new Date(invoice.created_at).toISOString().split('T')[0] : null,
      company: invoice.vendor || 'Unknown',
      invoiceId: invoice.invoice_number || invoice.id,
      amount: invoice.amount ? `$${parseFloat(invoice.amount).toFixed(2)}` : '$0.00',
      format: invoice.format || 'PDF',
      status: invoice.status || 'Pending',
      currency: invoice.currency || 'USD',
      raw: invoice // Include raw data for detail view
    }));

    return res.json({
      success: true,
      data: transformedData,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Error in getScrapedInvoices:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Get statistics for scraped invoices dashboard
 */
async function getScrapedStats(req, res) {
  try {
    const { startDate, endDate } = req.query;

    let query = supabase.from('invoices').select('*');

    const userId = getUserId(req);
    if (userId) query = query.eq('user_id', userId);

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching stats:', error);
      return res.status(500).json({ error: error.message });
    }

    // Calculate statistics
    const totalInvoices = data.length;
  const parsedCount = data.filter(inv => inv.status === 'Parsed').length;
  const errorCount = data.filter(inv => inv.status === 'Error').length;
  const pendingCount = data.filter(inv => inv.status === 'Pending').length;
  const assignedCount = data.filter(inv => inv.status === 'Assigned').length;
  const approvedCount = data.filter(inv => inv.status === 'Approved').length;

    // Calculate total amount
    const totalAmount = data.reduce((sum, inv) => {
      const amount = parseFloat(inv.amount) || 0;
      return sum + amount;
    }, 0);

    // Get unique vendors
    const uniqueVendors = new Set(data.map(inv => inv.vendor).filter(Boolean));

    // Format breakdown
    const formatBreakdown = {
      PDF: data.filter(inv => inv.format === 'PDF').length,
      XML: data.filter(inv => inv.format === 'XML').length,
      Scan: data.filter(inv => inv.format === 'Scan').length
    };

    // Status breakdown
    const statusBreakdown = {
      Parsed: parsedCount,
      Error: errorCount,
      Pending: pendingCount,
      Assigned: assignedCount,
      Approved: approvedCount
    };

    // Calculate success rate
    const successRate = totalInvoices > 0 
      ? ((parsedCount / totalInvoices) * 100).toFixed(2) 
      : 0;

    return res.json({
      success: true,
      stats: {
        totalInvoices,
        totalAmount: totalAmount.toFixed(2),
        totalVendors: uniqueVendors.size,
        parsedCount,
        errorCount,
        pendingCount,
        assignedCount,
        approvedCount,
        successRate: parseFloat(successRate),
        formatBreakdown,
        statusBreakdown
      }
    });
  } catch (err) {
    console.error('Error in getScrapedStats:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Get unique suppliers/vendors for filter dropdown
 */
async function getSuppliers(req, res) {
  try {
    let q = supabase
      .from('invoices')
      .select('vendor')
      .not('vendor', 'is', null);

    const userId = getUserId(req);
    if (userId) q = q.eq('user_id', userId);

    const { data, error } = await q;

    if (error) {
      console.error('Error fetching suppliers:', error);
      return res.status(500).json({ error: error.message });
    }

    // Get unique vendors
    const uniqueSuppliers = [...new Set(data.map(inv => inv.vendor).filter(Boolean))].sort();

    return res.json({
      success: true,
      suppliers: uniqueSuppliers
    });
  } catch (err) {
    console.error('Error in getSuppliers:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Update invoice status
 */
async function updateInvoiceStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['Parsed', 'Error', 'Pending', 'Assigned', 'Approved'].includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status. Must be one of: Parsed, Error, Pending, Assigned, Approved' 
      });
    }

    const { data, error } = await supabase
      .from('invoices')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', getUserId(req))
      .select()
      .single();

    if (error) {
      console.error('Error updating invoice status:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('Error in updateInvoiceStatus:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Delete invoice(s)
 */
async function deleteInvoices(req, res) {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const { data, error } = await supabase
      .from('invoices')
      .delete()
      .in('id', ids)
      .eq('user_id', getUserId(req))
      .select();

    if (error) {
      console.error('Error deleting invoices:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      deleted: data.length,
      data
    });
  } catch (err) {
    console.error('Error in deleteInvoices:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Get single invoice by ID
 */
async function getInvoiceById(req, res) {
  try {
    const { id } = req.params;

    let q = supabase
      .from('invoices')
      .select('*')
      .eq('id', id);
    const userId = getUserId(req);
    if (userId) q = q.eq('user_id', userId);

    const { data, error } = await q.single();

    if (error) {
      console.error('Error fetching invoice:', error);
      return res.status(404).json({ error: 'Invoice not found' });
    }

    return res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('Error in getInvoiceById:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Export invoices data (CSV format)
 */
async function exportInvoices(req, res) {
  try {
    const { supplier, status, startDate, endDate, format } = req.query;

    let query = supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false });

    const userId = getUserId(req);
    if (userId) query = query.eq('user_id', userId);

    // Apply same filters as getScrapedInvoices
    if (supplier && supplier !== 'All') {
      query = query.eq('vendor', supplier);
    }

    if (status && status !== 'All') {
      query = query.eq('status', status);
    }

    if (format && format !== 'All') {
      query = query.eq('format', format);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error exporting invoices:', error);
      return res.status(500).json({ error: error.message });
    }

    // Convert to CSV
    if (data.length === 0) {
      return res.status(404).json({ error: 'No data to export' });
    }

    const headers = ['Date', 'Company', 'Invoice ID', 'Amount', 'Currency', 'Format', 'Status'];
    const csvRows = [headers.join(',')];

    data.forEach(invoice => {
      const row = [
        invoice.created_at ? new Date(invoice.created_at).toISOString().split('T')[0] : '',
        invoice.vendor || 'Unknown',
        invoice.invoice_number || invoice.id,
        invoice.amount || '0',
        invoice.currency || 'USD',
        invoice.format || 'PDF',
        invoice.status || 'Pending'
      ];
      csvRows.push(row.map(field => `"${field}"`).join(','));
    });

    const csvContent = csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="invoices_export_${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    console.error('Error in exportInvoices:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Bulk update invoices
 */
async function bulkUpdateInvoices(req, res) {
  try {
    const { ids, updates } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object is required' });
    }

    // Add updated_at timestamp
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('invoices')
      .update(updates)
      .in('id', ids)
      .eq('user_id', getUserId(req))
      .select();

    if (error) {
      console.error('Error bulk updating invoices:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      updated: data.length,
      data
    });
  } catch (err) {
    console.error('Error in bulkUpdateInvoices:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getScrapedInvoices,
  getScrapedStats,
  getSuppliers,
  updateInvoiceStatus,
  deleteInvoices,
  getInvoiceById,
  exportInvoices,
  bulkUpdateInvoices
};
