// Thin fetch wrapper around the local API.

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  bootstrap: () => req('GET', '/api/bootstrap'),

  createProject: (data) => req('POST', '/api/projects', data),
  updateProject: (id, data) => req('PUT', `/api/projects/${id}`, data),
  deleteProject: (id) => req('DELETE', `/api/projects/${id}`),

  createCharge: (data) => req('POST', '/api/charges', data),
  updateCharge: (id, data) => req('PUT', `/api/charges/${id}`, data),
  deleteCharge: (id) => req('DELETE', `/api/charges/${id}`),
  payCharge: (id, data) => req('POST', `/api/charges/${id}/pay`, data || {}),

  createPayment: (data) => req('POST', '/api/payments', data),
  updatePayment: (id, data) => req('PUT', `/api/payments/${id}`, data),
  deletePayment: (id) => req('DELETE', `/api/payments/${id}`),

  createOverhead: (data) => req('POST', '/api/overheads', data),
  updateOverhead: (id, data) => req('PUT', `/api/overheads/${id}`, data),
  deleteOverhead: (id) => req('DELETE', `/api/overheads/${id}`),
  payOverhead: (id, data) => req('POST', `/api/overheads/${id}/pay`, data || {}),

  updateSettings: (data) => req('PUT', '/api/settings', data),
};
