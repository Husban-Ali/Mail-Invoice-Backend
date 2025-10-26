# Scraped Data API Documentation

This API provides endpoints for managing scraped invoice data with filtering, statistics, and export capabilities.

## Base URL
```
/api/scraped-data
```

---

## Endpoints

### 1. Get All Scraped Invoices
Retrieve all scraped invoices with optional filtering and pagination.

**Endpoint:** `GET /api/scraped-data`

**Query Parameters:**
- `supplier` (string, optional) - Filter by supplier/vendor name (use "All" for no filter)
- `status` (string, optional) - Filter by status: "Parsed", "Error", "Pending", or "All"
- `format` (string, optional) - Filter by format: "PDF", "XML", "Scan", or "All"
- `startDate` (string, optional) - Filter by start date (ISO format: YYYY-MM-DD)
- `endDate` (string, optional) - Filter by end date (ISO format: YYYY-MM-DD)
- `limit` (number, optional) - Number of records to return (default: 100)
- `offset` (number, optional) - Number of records to skip (default: 0)

**Example Request:**
```bash
GET /api/scraped-data?supplier=ACME%20Corp&status=Parsed&limit=50&offset=0
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "123",
      "date": "2025-09-15",
      "company": "ACME Corp",
      "invoiceId": "1001",
      "amount": "$200.00",
      "format": "PDF",
      "status": "Parsed",
      "currency": "USD",
      "raw": { /* full invoice object */ }
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

---

### 2. Get Statistics
Retrieve comprehensive statistics for the scraped invoices.

**Endpoint:** `GET /api/scraped-data/stats`

**Query Parameters:**
- `startDate` (string, optional) - Filter stats by start date
- `endDate` (string, optional) - Filter stats by end date

**Example Request:**
```bash
GET /api/scraped-data/stats?startDate=2025-01-01&endDate=2025-12-31
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "stats": {
    "totalInvoices": 250,
    "totalAmount": "125000.00",
    "totalVendors": 45,
    "parsedCount": 200,
    "errorCount": 30,
    "pendingCount": 20,
    "successRate": 80.00,
    "formatBreakdown": {
      "PDF": 150,
      "XML": 75,
      "Scan": 25
    },
    "statusBreakdown": {
      "Parsed": 200,
      "Error": 30,
      "Pending": 20
    }
  }
}
```

---

### 3. Get Suppliers List
Retrieve a list of unique suppliers/vendors for filter dropdowns.

**Endpoint:** `GET /api/scraped-data/suppliers`

**Example Request:**
```bash
GET /api/scraped-data/suppliers
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "suppliers": [
    "ACME Corp",
    "GlobalCo",
    "SmallBiz",
    "XYZ Ltd"
  ]
}
```

---

### 4. Get Single Invoice
Retrieve a single invoice by its ID.

**Endpoint:** `GET /api/scraped-data/:id`

**Path Parameters:**
- `id` (string, required) - Invoice ID

**Example Request:**
```bash
GET /api/scraped-data/123
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "123",
    "vendor": "ACME Corp",
    "amount": 200.00,
    "currency": "USD",
    "status": "Parsed",
    "format": "PDF",
    "invoice_number": "1001",
    "created_at": "2025-09-15T10:30:00Z",
    "updated_at": "2025-09-15T10:30:00Z"
  }
}
```

**Error Response (404 Not Found):**
```json
{
  "error": "Invoice not found"
}
```

---

### 5. Update Invoice Status
Update the status of a single invoice.

**Endpoint:** `PATCH /api/scraped-data/:id/status`

**Path Parameters:**
- `id` (string, required) - Invoice ID

**Request Body:**
```json
{
  "status": "Parsed"
}
```

**Valid Status Values:**
- `"Parsed"` - Successfully processed
- `"Error"` - Processing failed
- `"Pending"` - Awaiting processing

**Example Request:**
```bash
PATCH /api/scraped-data/123/status
Content-Type: application/json

{
  "status": "Parsed"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "123",
    "status": "Parsed",
    "updated_at": "2025-10-23T15:30:00Z"
  }
}
```

---

### 6. Delete Invoices
Delete one or multiple invoices.

**Endpoint:** `DELETE /api/scraped-data`

**Request Body:**
```json
{
  "ids": ["123", "456", "789"]
}
```

**Example Request:**
```bash
DELETE /api/scraped-data
Content-Type: application/json

{
  "ids": ["123", "456"]
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "deleted": 2,
  "data": [
    { "id": "123", /* deleted invoice data */ },
    { "id": "456", /* deleted invoice data */ }
  ]
}
```

---

### 7. Export Invoices to CSV
Export filtered invoices as a CSV file.

**Endpoint:** `GET /api/scraped-data/export/csv`

**Query Parameters:**
Same as "Get All Scraped Invoices" endpoint (supplier, status, format, startDate, endDate)

**Example Request:**
```bash
GET /api/scraped-data/export/csv?status=Parsed&startDate=2025-01-01
```

**Success Response (200 OK):**
Returns a CSV file with Content-Type: text/csv

**CSV Format:**
```csv
Date,Company,Invoice ID,Amount,Currency,Format,Status
2025-09-15,"ACME Corp",1001,200.00,USD,PDF,Parsed
2025-09-10,"GlobalCo",1003,100.00,USD,PDF,Pending
```

---

### 8. Bulk Update Invoices
Update multiple invoices at once.

**Endpoint:** `PATCH /api/scraped-data/bulk`

**Request Body:**
```json
{
  "ids": ["123", "456", "789"],
  "updates": {
    "status": "Parsed",
    "format": "PDF"
  }
}
```

**Example Request:**
```bash
PATCH /api/scraped-data/bulk
Content-Type: application/json

{
  "ids": ["123", "456"],
  "updates": {
    "status": "Parsed"
  }
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "updated": 2,
  "data": [
    { "id": "123", /* updated invoice */ },
    { "id": "456", /* updated invoice */ }
  ]
}
```

---

## Error Responses

All endpoints may return the following error responses:

**400 Bad Request:**
```json
{
  "error": "Invalid parameters or missing required fields"
}
```

**404 Not Found:**
```json
{
  "error": "Resource not found"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error message"
}
```

---

## Data Models

### Invoice Object
```typescript
{
  id: string;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
  status: 'Parsed' | 'Error' | 'Pending';
  format: 'PDF' | 'XML' | 'Scan';
  invoice_number: string | null;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}
```

---

## Frontend Integration Example

### Fetch Scraped Invoices
```javascript
import axios from 'axios';

const fetchScrapedData = async (filters) => {
  try {
    const params = new URLSearchParams();
    if (filters.supplier !== 'All') params.append('supplier', filters.supplier);
    if (filters.status !== 'All') params.append('status', filters.status);
    if (filters.format !== 'All') params.append('format', filters.format);
    
    const response = await axios.get(`/api/scraped-data?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching scraped data:', error);
    throw error;
  }
};
```

### Fetch Statistics
```javascript
const fetchStats = async () => {
  try {
    const response = await axios.get('/api/scraped-data/stats');
    return response.data.stats;
  } catch (error) {
    console.error('Error fetching stats:', error);
    throw error;
  }
};
```

### Update Invoice Status
```javascript
const updateStatus = async (invoiceId, newStatus) => {
  try {
    const response = await axios.patch(
      `/api/scraped-data/${invoiceId}/status`,
      { status: newStatus }
    );
    return response.data;
  } catch (error) {
    console.error('Error updating status:', error);
    throw error;
  }
};
```

### Delete Invoices
```javascript
const deleteInvoices = async (ids) => {
  try {
    const response = await axios.delete('/api/scraped-data', {
      data: { ids }
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting invoices:', error);
    throw error;
  }
};
```

### Export to CSV
```javascript
const exportToCSV = async (filters) => {
  try {
    const params = new URLSearchParams();
    if (filters.supplier !== 'All') params.append('supplier', filters.supplier);
    if (filters.status !== 'All') params.append('status', filters.status);
    
    const response = await axios.get(
      `/api/scraped-data/export/csv?${params.toString()}`,
      { responseType: 'blob' }
    );
    
    // Create download link
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `invoices_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    console.error('Error exporting data:', error);
    throw error;
  }
};
```

---

## Database Schema Requirements

Run the SQL migration file `003_create_scraped_data_schema.sql` to set up the required database schema:

```bash
psql -d your_database -f Backend/sql/003_create_scraped_data_schema.sql
```

This will:
- Add required columns (format, status, invoice_number, updated_at)
- Create indexes for better query performance
- Add constraints for data validation
- Set up automatic updated_at triggers
