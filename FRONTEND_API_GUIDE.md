# Frontend API Integration Guide

Complete guide for integrating VoMindAI backend APIs with your frontend application.

## Base Configuration

```javascript
// config/api.js
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

export const apiClient = {
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }
      
      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  },

  get(endpoint, options) {
    return this.request(endpoint, { ...options, method: 'GET' });
  },

  post(endpoint, body, options) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  put(endpoint, body, options) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  delete(endpoint, options) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  },
};
```

---

## Lead Management APIs

### 1. Create New Lead

**Endpoint:** `POST /api/new-lead`

```javascript
// services/leadService.js
export const createLead = async (leadData) => {
  return apiClient.post('/api/new-lead', leadData);
};

// Usage Example
const handleCreateLead = async () => {
  try {
    const result = await createLead({
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1234567890',
      company: 'Acme Inc',
      lead_source: 'website',
      lead_status: 'new',
      lead_priority: 'high',
      message: 'Interested in product demo',
      notes: 'Called from landing page',
      metadata: {
        campaign: 'Q4-2025',
        referrer: 'google-ads'
      }
    });
    
    console.log('Lead created:', result.data);
    // result.data contains the created lead object
  } catch (error) {
    console.error('Failed to create lead:', error.message);
  }
};
```

**Request Body:**
```typescript
{
  name?: string;           // Lead name
  email?: string;          // Email (validated)
  phone?: string;          // Phone (auto-formatted to E.164)
  company?: string;        // Company name
  lead_source?: string;    // 'website', 'referral', 'api', etc.
  lead_status?: string;    // 'new', 'contacted', 'qualified', 'converted'
  lead_priority?: string;  // 'low', 'medium', 'high'
  message?: string;        // Lead message
  notes?: string;          // Internal notes
  metadata?: object;       // Additional data (JSON)
}
```

**Response:**
```json
{
  "success": true,
  "message": "Lead created successfully",
  "data": {
    "id": "123",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "created_at": "2025-11-20T10:00:00Z",
    ...
  }
}
```

---

### 2. Get All Leads (with Pagination & Filtering)

**Endpoint:** `GET /api/leads`

```javascript
export const getLeads = async (filters = {}) => {
  const params = new URLSearchParams();
  
  // Pagination
  if (filters.limit) params.append('limit', filters.limit);
  if (filters.offset) params.append('offset', filters.offset);
  
  // Filters
  if (filters.status) params.append('status', filters.status);
  if (filters.priority) params.append('priority', filters.priority);
  if (filters.source) params.append('source', filters.source);
  if (filters.search) params.append('search', filters.search);
  
  // Date range
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  
  // Sorting
  if (filters.sortBy) params.append('sortBy', filters.sortBy);
  if (filters.sortOrder) params.append('sortOrder', filters.sortOrder);
  
  const query = params.toString();
  return apiClient.get(`/api/leads${query ? `?${query}` : ''}`);
};

// Usage Examples

// Get first 20 leads
const leads = await getLeads({ limit: 20, offset: 0 });

// Filter by status
const newLeads = await getLeads({ 
  status: 'new',
  limit: 50 
});

// Filter by priority
const highPriorityLeads = await getLeads({ 
  priority: 'high',
  sortBy: 'created_at',
  sortOrder: 'desc'
});

// Search leads
const searchResults = await getLeads({ 
  search: 'john',  // Searches name, email, phone, company
  limit: 10 
});

// Date range filter
const recentLeads = await getLeads({
  dateFrom: '2025-11-01',
  dateTo: '2025-11-20',
  sortBy: 'created_at',
  sortOrder: 'desc'
});
```

**Query Parameters:**
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | number | Results per page (max 100) | 50 |
| `offset` | number | Starting position | 0 |
| `status` | string | Filter by lead_status | - |
| `priority` | string | Filter by lead_priority | - |
| `source` | string | Filter by lead_source | - |
| `search` | string | Search in name, email, phone, company | - |
| `dateFrom` | string | Start date (ISO format) | - |
| `dateTo` | string | End date (ISO format) | - |
| `sortBy` | string | Sort field: created_at, name, email, lead_status, lead_priority | created_at |
| `sortOrder` | string | asc or desc | desc |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "123",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "company": "Acme Inc",
      "lead_status": "new",
      "lead_priority": "high",
      "created_at": "2025-11-20T10:00:00Z",
      ...
    }
  ],
  "pagination": {
    "total": 150,
    "count": 20,
    "limit": 20,
    "offset": 0,
    "currentPage": 1,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "filters": { ... },
  "sorting": { ... }
}
```

---

### 3. Get Single Lead

**Endpoint:** `GET /api/leads/:id`

```javascript
export const getLeadById = async (leadId) => {
  return apiClient.get(`/api/leads/${leadId}`);
};

// Usage Example
const handleViewLead = async (leadId) => {
  try {
    const result = await getLeadById('123');
    console.log('Lead details:', result.data);
  } catch (error) {
    console.error('Lead not found:', error.message);
  }
};
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "company": "Acme Inc",
    "lead_source": "website",
    "lead_status": "new",
    "lead_priority": "high",
    "message": "Interested in product demo",
    "notes": "Called from landing page",
    "metadata": {
      "campaign": "Q4-2025"
    },
    "ip_address": "192.168.1.1",
    "user_agent": "Mozilla/5.0...",
    "created_at": "2025-11-20T10:00:00Z",
    "updated_at": "2025-11-20T10:00:00Z",
    "last_contacted_at": null
  }
}
```

---

### 4. Update Lead

**Endpoint:** `PUT /api/leads/:id`

```javascript
export const updateLead = async (leadId, updates) => {
  return apiClient.put(`/api/leads/${leadId}`, updates);
};

// Usage Examples

// Update lead status
await updateLead('123', { 
  lead_status: 'contacted',
  last_contacted_at: new Date().toISOString()
});

// Update priority
await updateLead('123', { 
  lead_priority: 'high' 
});

// Update multiple fields
await updateLead('123', {
  lead_status: 'qualified',
  notes: 'Had a great conversation. Ready to proceed.',
  metadata: {
    call_duration: 300,
    interested_in: 'Enterprise plan'
  }
});

// Complete example
const handleUpdateLead = async (leadId, updates) => {
  try {
    const result = await updateLead(leadId, updates);
    console.log('Lead updated:', result.data);
  } catch (error) {
    console.error('Update failed:', error.message);
  }
};
```

**Request Body:** (all fields optional)
```typescript
{
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  lead_source?: string;
  lead_status?: string;
  lead_priority?: string;
  message?: string;
  notes?: string;
  metadata?: object;
  last_contacted_at?: string;  // ISO date
}
```

**Response:**
```json
{
  "success": true,
  "message": "Lead updated successfully",
  "data": {
    "id": "123",
    "lead_status": "contacted",
    "updated_at": "2025-11-20T11:00:00Z",
    ...
  }
}
```

---

## React Component Examples

### Lead List Component

```jsx
// components/LeadList.jsx
import { useState, useEffect } from 'react';
import { getLeads } from '../services/leadService';

export default function LeadList() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({
    limit: 20,
    offset: 0,
    status: '',
    search: ''
  });

  useEffect(() => {
    fetchLeads();
  }, [filters]);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const result = await getLeads(filters);
      setLeads(result.data);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newOffset) => {
    setFilters({ ...filters, offset: newOffset });
  };

  const handleSearch = (searchTerm) => {
    setFilters({ ...filters, search: searchTerm, offset: 0 });
  };

  const handleStatusFilter = (status) => {
    setFilters({ ...filters, status, offset: 0 });
  };

  if (loading) return <div>Loading leads...</div>;

  return (
    <div>
      <h1>Leads ({pagination.total})</h1>
      
      {/* Search */}
      <input
        type="text"
        placeholder="Search leads..."
        onChange={(e) => handleSearch(e.target.value)}
      />
      
      {/* Status Filter */}
      <select onChange={(e) => handleStatusFilter(e.target.value)}>
        <option value="">All Statuses</option>
        <option value="new">New</option>
        <option value="contacted">Contacted</option>
        <option value="qualified">Qualified</option>
        <option value="converted">Converted</option>
      </select>

      {/* Lead Table */}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(lead => (
            <tr key={lead.id}>
              <td>{lead.name}</td>
              <td>{lead.email}</td>
              <td>{lead.phone}</td>
              <td>{lead.lead_status}</td>
              <td>{lead.lead_priority}</td>
              <td>{new Date(lead.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div>
        <button 
          disabled={!pagination.hasPrevPage}
          onClick={() => handlePageChange(filters.offset - filters.limit)}
        >
          Previous
        </button>
        <span>Page {pagination.currentPage} of {pagination.totalPages}</span>
        <button 
          disabled={!pagination.hasNextPage}
          onClick={() => handlePageChange(filters.offset + filters.limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

### Create Lead Form

```jsx
// components/CreateLeadForm.jsx
import { useState } from 'react';
import { createLead } from '../services/leadService';

export default function CreateLeadForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    lead_priority: 'medium',
    message: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const result = await createLead(formData);
      alert('Lead created successfully!');
      onSuccess?.(result.data);
      // Reset form
      setFormData({
        name: '',
        email: '',
        phone: '',
        company: '',
        lead_priority: 'medium',
        message: ''
      });
    } catch (error) {
      alert('Error creating lead: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Name *</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>

      <div>
        <label>Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        />
      </div>

      <div>
        <label>Phone</label>
        <input
          type="tel"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          placeholder="+1234567890"
        />
      </div>

      <div>
        <label>Company</label>
        <input
          type="text"
          value={formData.company}
          onChange={(e) => setFormData({ ...formData, company: e.target.value })}
        />
      </div>

      <div>
        <label>Priority</label>
        <select
          value={formData.lead_priority}
          onChange={(e) => setFormData({ ...formData, lead_priority: e.target.value })}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div>
        <label>Message</label>
        <textarea
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          rows={4}
        />
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating...' : 'Create Lead'}
      </button>
    </form>
  );
}
```

### Lead Details Component

```jsx
// components/LeadDetails.jsx
import { useState, useEffect } from 'react';
import { getLeadById, updateLead } from '../services/leadService';

export default function LeadDetails({ leadId }) {
  const [lead, setLead] = useState(null);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({});

  useEffect(() => {
    fetchLead();
  }, [leadId]);

  const fetchLead = async () => {
    try {
      const result = await getLeadById(leadId);
      setLead(result.data);
      setFormData(result.data);
    } catch (error) {
      console.error('Error fetching lead:', error);
    }
  };

  const handleUpdate = async () => {
    try {
      const result = await updateLead(leadId, formData);
      setLead(result.data);
      setEditing(false);
      alert('Lead updated successfully!');
    } catch (error) {
      alert('Error updating lead: ' + error.message);
    }
  };

  if (!lead) return <div>Loading...</div>;

  return (
    <div>
      <h2>Lead Details</h2>
      
      {!editing ? (
        <div>
          <p><strong>Name:</strong> {lead.name}</p>
          <p><strong>Email:</strong> {lead.email}</p>
          <p><strong>Phone:</strong> {lead.phone}</p>
          <p><strong>Company:</strong> {lead.company}</p>
          <p><strong>Status:</strong> {lead.lead_status}</p>
          <p><strong>Priority:</strong> {lead.lead_priority}</p>
          <p><strong>Notes:</strong> {lead.notes}</p>
          
          <button onClick={() => setEditing(true)}>Edit</button>
        </div>
      ) : (
        <div>
          <input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          
          <select
            value={formData.lead_status}
            onChange={(e) => setFormData({ ...formData, lead_status: e.target.value })}
          >
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="converted">Converted</option>
          </select>
          
          <button onClick={handleUpdate}>Save</button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
```

---

## Error Handling

```javascript
// utils/errorHandler.js
export const handleApiError = (error) => {
  if (error.response) {
    // Server responded with error
    switch (error.response.status) {
      case 400:
        return 'Invalid request. Please check your input.';
      case 404:
        return 'Resource not found.';
      case 500:
        return 'Server error. Please try again later.';
      default:
        return error.response.data?.error || 'An error occurred.';
    }
  } else if (error.request) {
    // Request made but no response
    return 'Network error. Please check your connection.';
  } else {
    // Other errors
    return error.message || 'An unexpected error occurred.';
  }
};

// Usage
try {
  await createLead(data);
} catch (error) {
  const errorMessage = handleApiError(error);
  showNotification(errorMessage);
}
```

---

## TypeScript Types

```typescript
// types/lead.ts
export interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  lead_source: string;
  lead_status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  lead_priority: 'low' | 'medium' | 'high';
  message: string | null;
  notes: string | null;
  metadata: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  referrer: string | null;
  created_at: string;
  updated_at: string;
  last_contacted_at: string | null;
}

export interface LeadFilters {
  limit?: number;
  offset?: number;
  status?: string;
  priority?: string;
  source?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginationInfo {
  total: number;
  count: number;
  limit: number;
  offset: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
```

---

## Next Steps

1. **Set up axios** (alternative to fetch):
   ```bash
   npm install axios
   ```

2. **Add React Query** for caching:
   ```bash
   npm install @tanstack/react-query
   ```

3. **Implement other APIs:**
   - Call Queue Management
   - Call History
   - Transcripts
   - Queue Statistics

For complete API documentation for all endpoints, see:
- [QUEUE_SYSTEM.md](./QUEUE_SYSTEM.md) - Queue APIs
- [README.md](./README.md) - All endpoints overview
