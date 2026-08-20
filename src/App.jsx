import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Settings from './pages/Settings.jsx';

function addMonthsIso(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const daysInTarget = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTarget);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day)).toISOString().slice(0, 10);
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState({ name: 'dashboard', projectId: null });

  const reload = useCallback(async () => {
    try {
      setData(await api.bootstrap());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (error) return <div className="page"><div className="form-error">Failed to load: {error}. Is the API running?</div></div>;
  if (!data) return <div className="page"><p className="page-sub">Loading…</p></div>;

  const { settings } = data;

  // ---- handlers ----
  async function createProject(form, autoCharges) {
    const project = await api.createProject(form);
    if (autoCharges) {
      const { buildAmount, maintenance, startDate } = autoCharges;
      if (buildAmount) {
        await api.createCharge({
          project_id: project.id, direction: 'income', category: 'build',
          label: 'Build', amount: buildAmount, frequency: 'one_time',
          next_due: startDate, active: 1,
        });
      }
      if (maintenance) {
        await api.createCharge({
          project_id: project.id, direction: 'income', category: 'maintenance',
          label: `Maintenance (${maintenance.tierLabel})`, amount: maintenance.amount,
          frequency: maintenance.freq, next_due: addMonthsIso(startDate, 1), active: 1,
        });
      }
    }
    await reload();
    setView({ name: 'project', projectId: project.id });
  }

  async function updateProject(id, form) { await api.updateProject(id, form); await reload(); }
  async function deleteProject(id) {
    await api.deleteProject(id);
    await reload();
    setView({ name: 'dashboard', projectId: null });
  }

  async function createCharge(d) { await api.createCharge(d); await reload(); }
  async function updateCharge(id, d) { await api.updateCharge(id, d); await reload(); }
  async function deleteCharge(id) { await api.deleteCharge(id); await reload(); }
  async function payCharge(id) { await api.payCharge(id); await reload(); }
  async function updatePayment(id, d) { await api.updatePayment(id, d); await reload(); }
  async function deletePayment(id) { await api.deletePayment(id); await reload(); }

  async function createOverhead(d) { await api.createOverhead(d); await reload(); }
  async function updateOverhead(id, d) { await api.updateOverhead(id, d); await reload(); }
  async function deleteOverhead(id) { await api.deleteOverhead(id); await reload(); }
  async function payOverhead(id) { await api.payOverhead(id); await reload(); }

  async function toggleCurrency() {
    const next = settings.display_currency === 'EUR' ? 'RSD' : 'EUR';
    setData({ ...data, settings: { ...settings, display_currency: next } }); // optimistic
    await api.updateSettings({ display_currency: next });
  }
  async function saveSettings(patch) {
    const s = await api.updateSettings(patch);
    setData({ ...data, settings: s });
  }

  const go = (name, projectId = null) => setView({ name, projectId });

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="mark">AR</span>
            <span>Revenue Tracker</span>
          </div>
          <nav>
            <button className={`nav-btn ${view.name === 'dashboard' ? 'active' : ''}`} onClick={() => go('dashboard')}>Dashboard</button>
            <button className={`nav-btn ${view.name === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}>Settings</button>
          </nav>
          <div className="spacer" />
          <div className="seg" title="Display currency">
            <button className={settings.display_currency === 'EUR' ? 'active' : ''} onClick={() => settings.display_currency !== 'EUR' && toggleCurrency()}>EUR €</button>
            <button className={settings.display_currency === 'RSD' ? 'active' : ''} onClick={() => settings.display_currency !== 'RSD' && toggleCurrency()}>RSD дин</button>
          </div>
        </div>
      </header>

      {view.name === 'dashboard' && (
        <Dashboard data={data} onOpenProject={(id) => go('project', id)}
          createProject={createProject} payCharge={payCharge}
          createOverhead={createOverhead} updateOverhead={updateOverhead}
          deleteOverhead={deleteOverhead} payOverhead={payOverhead} />
      )}
      {view.name === 'project' && (
        <ProjectDetail data={data} projectId={view.projectId} onBack={() => go('dashboard')}
          updateProject={updateProject} deleteProject={deleteProject}
          createCharge={createCharge} updateCharge={updateCharge} deleteCharge={deleteCharge}
          payCharge={payCharge} updatePayment={updatePayment} deletePayment={deletePayment} />
      )}
      {view.name === 'settings' && (
        <Settings data={data} saveSettings={saveSettings} reload={reload} />
      )}
    </>
  );
}
