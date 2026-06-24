import React, { useState, useEffect, useMemo } from 'react';
import { 
  AlertOctagon, 
  Clock, 
  Wrench, 
  Download, 
  Printer, 
  X, 
  CheckCircle,
  HelpCircle,
  CalendarDays,
  Play
} from 'lucide-react';
import Navbar from './components/Navbar';
import DashboardTab from './components/DashboardTab';
import ScanTab from './components/ScanTab';
import LiveTab from './components/LiveTab';
import MachinesTab from './components/MachinesTab';
import HistoryTab from './components/HistoryTab';
import AnalyticsTab from './components/AnalyticsTab';
import SettingsTab from './components/SettingsTab';
import { Machine, BreakdownEvent, MasterLists, DateViewMode } from './types';
import { 
  DEFAULT_MASTERS, 
  DEFAULT_MACHINES, 
  generateSampleEvents, 
  getRangeBounds,
  convertToCSV,
  downloadBlob,
  calculateMachineMetrics
} from './utils/dataHelper';
import * as XLSX from 'xlsx';
import { 
  fetchMastersFromSupabase,
  saveMastersToSupabase,
  fetchMachinesFromSupabase,
  saveMachineToSupabase,
  deleteMachineFromSupabase,
  bulkSaveMachinesToSupabase,
  fetchEventsFromSupabase,
  saveEventToSupabase,
  bulkSaveEventsToSupabase,
  clearSupabaseDatabase,
  testSupabaseConnection,
  supabase
} from './utils/supabaseClient';

interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  msg?: string;
}

export default function App() {
  // Appearance Theme
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('syrma_theme') as 'dark' | 'light') || 'dark';
  });

  // Master lists, machines and breakdown logs
  const [masters, setMasters] = useState<MasterLists>(() => {
    const raw = localStorage.getItem('syrma_masters');
    return raw ? JSON.parse(raw) : DEFAULT_MASTERS;
  });

  const [machines, setMachines] = useState<Machine[]>(() => {
    const raw = localStorage.getItem('syrma_machines');
    return raw ? JSON.parse(raw) : DEFAULT_MACHINES;
  });

  const [events, setEvents] = useState<BreakdownEvent[]>(() => {
    const raw = localStorage.getItem('syrma_events');
    if (raw) {
      return JSON.parse(raw);
    }
    // Generate fresh dummy values on initial boot
    return generateSampleEvents(DEFAULT_MACHINES);
  });

  // Navigation tabs
  const [activeView, setActiveView] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Date selection states
  const [dashboardRange, setDashboardRange] = useState<DateViewMode>('today');
  const [dashboardCustomFrom, setDashboardCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  });
  const [dashboardCustomTo, setDashboardCustomTo] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Supabase Sync States
  const [supabaseStatus, setSupabaseStatus] = useState<'checking' | 'connected' | 'missing_tables' | 'error'>('checking');
  const [isSyncing, setIsSyncing] = useState(false);

  // Trigger browser-level changes on theme change
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    localStorage.setItem('syrma_theme', theme);
  }, [theme]);

  // Persist states to local storage (as robust local cache fallback)
  useEffect(() => {
    localStorage.setItem('syrma_masters', JSON.stringify(masters));
  }, [masters]);

  useEffect(() => {
    localStorage.setItem('syrma_machines', JSON.stringify(machines));
  }, [machines]);

  useEffect(() => {
    localStorage.setItem('syrma_events', JSON.stringify(events));
  }, [events]);

  // Initialize and load from Supabase on mount
  useEffect(() => {
    async function initSupabase() {
      try {
        setSupabaseStatus('checking');
        const isReachable = await testSupabaseConnection();
        
        if (!isReachable) {
          // Check if connection is fine but tables are missing, or if it is a general connection error.
          // We check if fetchMasters returns null due to missing table relation error.
          const loadedMasters = await fetchMastersFromSupabase();
          if (loadedMasters === null) {
            setSupabaseStatus('missing_tables');
            return;
          }
          setSupabaseStatus('error');
          return;
        }

        // Fetch data in parallel
        const [loadedMasters, loadedMachines, loadedEvents] = await Promise.all([
          fetchMastersFromSupabase(),
          fetchMachinesFromSupabase(),
          fetchEventsFromSupabase()
        ]);

        if (loadedMasters && loadedMachines && loadedEvents) {
          setMasters(loadedMasters);
          setMachines(loadedMachines);
          setEvents(loadedEvents);
          setSupabaseStatus('connected');
          showToast('success', 'Supabase Cloud Sync', 'All factory profiles and breakdown history loaded from cloud.');
        } else {
          // If connection is successful but tables are completely empty, let's auto-seed!
          setIsSyncing(true);
          const initialEvents = generateSampleEvents(DEFAULT_MACHINES);
          
          await Promise.all([
            saveMastersToSupabase(DEFAULT_MASTERS),
            bulkSaveMachinesToSupabase(DEFAULT_MACHINES),
            bulkSaveEventsToSupabase(initialEvents)
          ]);
          
          setMasters(DEFAULT_MASTERS);
          setMachines(DEFAULT_MACHINES);
          setEvents(initialEvents);
          setSupabaseStatus('connected');
          showToast('success', 'Cloud Database Seeding', 'Initialized Supabase with master categories and sample event logs.');
        }
      } catch (err) {
        console.error('Supabase initialization failed:', err);
        setSupabaseStatus('error');
      } finally {
        setIsSyncing(false);
      }
    }
    initSupabase();
  }, []);

  // Force Push: Local State to Supabase
  const handleForcePush = async () => {
    if (supabaseStatus !== 'connected' && supabaseStatus !== 'missing_tables') {
      showToast('error', 'Cloud Sync Failed', 'Database is unreachable. Check network.');
      return;
    }
    setIsSyncing(true);
    try {
      showToast('info', 'Uploading State...', 'Replacing Supabase schema with local cache.');
      await clearSupabaseDatabase();
      await Promise.all([
        saveMastersToSupabase(masters),
        bulkSaveMachinesToSupabase(machines),
        bulkSaveEventsToSupabase(events)
      ]);
      setSupabaseStatus('connected');
      showToast('success', 'Cloud Push Completed', 'Overwrote Supabase database successfully.');
    } catch (err) {
      showToast('error', 'Cloud Push Failed', 'Check SQL setup or table schemas.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Force Pull: Supabase to Local State
  const handleForcePull = async () => {
    if (supabaseStatus !== 'connected') {
      showToast('error', 'Cloud Sync Failed', 'Database is not connected.');
      return;
    }
    setIsSyncing(true);
    try {
      showToast('info', 'Downloading State...', 'Fetching latest cloud tables.');
      const [remoteMasters, remoteMachines, remoteEvents] = await Promise.all([
        fetchMastersFromSupabase(),
        fetchMachinesFromSupabase(),
        fetchEventsFromSupabase()
      ]);

      if (remoteMasters) setMasters(remoteMasters);
      if (remoteMachines) setMachines(remoteMachines);
      if (remoteEvents) setEvents(remoteEvents);

      showToast('success', 'Cloud Pull Completed', 'Overwrote local session with Supabase cloud data.');
    } catch (err) {
      showToast('error', 'Cloud Pull Failed', 'Could not fetch remote tables.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Push notifications toast controller
  const showToast = (type: 'success' | 'error' | 'info', title: string, msg?: string) => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, type, title, msg }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // Date bounds calculations based on current select state
  const { periodStart, periodEnd } = useMemo(() => {
    const [start, end] = getRangeBounds(dashboardRange, dashboardCustomFrom, dashboardCustomTo);
    return { periodStart: start, periodEnd: end };
  }, [dashboardRange, dashboardCustomFrom, dashboardCustomTo]);

  // 1. Report Breakdown Failure Process
  const handleRegisterFailure = (machineId: string, customFailTime?: number) => {
    const now = customFailTime || Date.now();
    const target = machines.find((m) => m.id === machineId);
    if (!target) return;

    // Check if there is already an unresolved failure event for safety
    const alreadyDown = events.some((e) => e.machineId === machineId && e.repairTime === undefined);
    if (alreadyDown) {
      showToast('error', 'Incident Already Logged', `${target.name} is already registered under breakdown.`);
      return;
    }

    const newEvent: BreakdownEvent = {
      id: `ev_${machineId}_fail_${now}`,
      machineId,
      area: target.area,
      line: target.line,
      customer: target.customer,
      machineName: target.name,
      assetNo: target.assetNo,
      failTime: now,
    };

    const updatedMachine: Machine = { ...target, status: 'breakdown' };

    setEvents((prev) => [newEvent, ...prev]);
    setMachines((prev) =>
      prev.map((m) => (m.id === machineId ? updatedMachine : m))
    );
    showToast(
      'error',
      'Breakdown Event Registered',
      `${target.name} status updated to Breakdown. Downtime clock started.`
    );

    // Sync with Supabase in background
    if (supabaseStatus === 'connected') {
      setIsSyncing(true);
      Promise.all([
        saveEventToSupabase(newEvent),
        saveMachineToSupabase(updatedMachine)
      ]).then(([s1, s2]) => {
        if (s1 && s2) {
          showToast('info', 'Cloud Sync', 'Breakdown incident logged to Supabase.');
        }
      }).finally(() => setIsSyncing(false));
    }
  };

  // 2. Mark Repaired Process
  const handleRegisterRepair = (machineId: string, customRepairTime?: number) => {
    const now = customRepairTime || Date.now();
    const target = machines.find((m) => m.id === machineId);
    if (!target) return;

    // Find the active breakdown incident
    const activeIncidentIdx = events.findIndex(
      (e) => e.machineId === machineId && e.repairTime === undefined
    );

    if (activeIncidentIdx === -1) {
      showToast('error', 'No Active Breakdown', `There is no outstanding breakdown logs for ${target.name}.`);
      return;
    }

    const targetIncident = events[activeIncidentIdx];
    const durationMinutes = Math.max(1, (now - targetIncident.failTime) / 60000);

    const updatedEvent: BreakdownEvent = {
      ...targetIncident,
      repairTime: now,
      duration: durationMinutes,
    };

    const updatedMachine: Machine = { ...target, status: 'running' };

    const updatedEvents = [...events];
    updatedEvents[activeIncidentIdx] = updatedEvent;

    setEvents(updatedEvents);
    setMachines((prev) =>
      prev.map((m) => (m.id === machineId ? updatedMachine : m))
    );

    const formattedDuration = durationMinutes >= 60 
      ? `${(durationMinutes / 60).toFixed(1)} hours` 
      : `${durationMinutes.toFixed(0)} minutes`;

    showToast(
      'success',
      'Machine Repaired',
      `${target.name} has resumed running operations. Downtime duration: ${formattedDuration}.`
    );

    // Sync with Supabase in background
    if (supabaseStatus === 'connected') {
      setIsSyncing(true);
      Promise.all([
        saveEventToSupabase(updatedEvent),
        saveMachineToSupabase(updatedMachine)
      ]).then(([s1, s2]) => {
        if (s1 && s2) {
          showToast('info', 'Cloud Sync', 'Repair log saved to Supabase.');
        }
      }).finally(() => setIsSyncing(false));
    }
  };

  // Add Machine Asset
  const handleAddMachine = (newMachineData: {
    area: string;
    line: string;
    customer: string;
    name: string;
    assetNo: string;
  }) => {
    const id = `mc_${Date.now()}`;
    const payloadStr = JSON.stringify({ id, name: newMachineData.name, assetNo: newMachineData.assetNo });

    const newMachine: Machine = {
      id,
      ...newMachineData,
      status: 'running',
      qrPayload: payloadStr,
    };

    setMachines((prev) => [...prev, newMachine]);

    // Check and add master list values if they are custom entries
    const updateMasters = { ...masters };
    let masterUpdated = false;

    if (!updateMasters.areas.includes(newMachineData.area)) {
      updateMasters.areas.push(newMachineData.area);
      masterUpdated = true;
    }
    if (!updateMasters.lines.includes(newMachineData.line)) {
      updateMasters.lines.push(newMachineData.line);
      masterUpdated = true;
    }
    if (!updateMasters.customers.includes(newMachineData.customer)) {
      updateMasters.customers.push(newMachineData.customer);
      masterUpdated = true;
    }

    if (masterUpdated) {
      setMasters(updateMasters);
    }

    // Sync with Supabase in background
    if (supabaseStatus === 'connected') {
      setIsSyncing(true);
      Promise.all([
        saveMachineToSupabase(newMachine),
        masterUpdated ? saveMastersToSupabase(updateMasters) : Promise.resolve(true)
      ]).then(([s1, s2]) => {
        if (s1 && s2) {
          showToast('info', 'Cloud Sync', 'New machine profile synced to Supabase.');
        }
      }).finally(() => setIsSyncing(false));
    }
  };

  // Delete Machine Asset
  const handleDeleteMachine = (id: string) => {
    const target = machines.find((m) => m.id === id);
    if (!target) return;

    const confirm = window.confirm(`Are you sure you want to delete ${target.name}? This will purge its history too.`);
    if (confirm) {
      setMachines((prev) => prev.filter((m) => m.id !== id));
      setEvents((prev) => prev.filter((e) => e.machineId !== id));
      showToast('success', 'Profile Purged', `${target.name} removed from fleet master data.`);

      // Sync with Supabase in background
      if (supabaseStatus === 'connected') {
        setIsSyncing(true);
        Promise.all([
          deleteMachineFromSupabase(id),
          // Clean up its events
          supabase.from('syrma_events').delete().eq('machine_id', id)
        ]).then(([s1]) => {
          if (s1) {
            showToast('info', 'Cloud Sync', 'Machine deleted from Supabase.');
          }
        }).finally(() => setIsSyncing(false));
      }
    }
  };

  // Master registries operations
  const handleAddMasterValue = (listKey: 'areas' | 'lines' | 'customers', val: string) => {
    const updated = { ...masters };
    if (!updated[listKey].includes(val)) {
      updated[listKey] = [...updated[listKey], val];
      setMasters(updated);

      if (supabaseStatus === 'connected') {
        setIsSyncing(true);
        saveMastersToSupabase(updated).then((success) => {
          if (success) showToast('info', 'Cloud Sync', 'Added master option in Supabase.');
        }).finally(() => setIsSyncing(false));
      }
    }
  };

  const handleRemoveMasterValue = (listKey: 'areas' | 'lines' | 'customers', val: string) => {
    const confirm = window.confirm(`Remove "${val}" option from our lists? This won't affect existing machines but prevents creating new ones with this option.`);
    if (confirm) {
      const updated = { ...masters };
      updated[listKey] = updated[listKey].filter((item) => item !== val);
      setMasters(updated);

      if (supabaseStatus === 'connected') {
        setIsSyncing(true);
        saveMastersToSupabase(updated).then((success) => {
          if (success) showToast('info', 'Cloud Sync', 'Removed master option from Supabase.');
        }).finally(() => setIsSyncing(false));
      }
    }
  };

  // Load sample baseline data
  const handleLoadSampleData = async () => {
    setMasters(DEFAULT_MASTERS);
    setMachines(DEFAULT_MACHINES);
    const sampleEvents = generateSampleEvents(DEFAULT_MACHINES);
    setEvents(sampleEvents);

    if (supabaseStatus === 'connected') {
      setIsSyncing(true);
      try {
        await clearSupabaseDatabase();
        await Promise.all([
          saveMastersToSupabase(DEFAULT_MASTERS),
          bulkSaveMachinesToSupabase(DEFAULT_MACHINES),
          bulkSaveEventsToSupabase(sampleEvents)
        ]);
        showToast('success', 'Cloud Synced', 'Sample history initialized in Supabase.');
      } catch (err) {
        showToast('error', 'Cloud Seeding Failed');
      } finally {
        setIsSyncing(false);
      }
    }
  };

  // Reset database completely
  const handleResetAllData = async () => {
    setMasters({ areas: [], lines: [], customers: [] });
    setMachines([]);
    setEvents([]);
    localStorage.removeItem('syrma_masters');
    localStorage.removeItem('syrma_machines');
    localStorage.removeItem('syrma_events');

    if (supabaseStatus === 'connected') {
      setIsSyncing(true);
      try {
        await clearSupabaseDatabase();
        showToast('success', 'Cloud Synced', 'All remote tables cleared from Supabase.');
      } catch (err) {
        showToast('error', 'Cloud Reset Failed');
      } finally {
        setIsSyncing(false);
      }
    }
  };

  // Download comprehensive Monthly Report
  const handleDownloadMonthlyReport = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();

    const headers = ['Area Location', 'Line Number', 'Customer Profile', 'Machine Asset Name', 'Serial ID', 'Status', 'MTTR (Minutes)', 'MTBF (Minutes)', 'Failures Registered'];
    
    const rows = machines.map((m) => {
      const mMetrics = calculateMachineMetrics(m.id, events, firstDay, lastDay);
      return [
        m.area,
        m.line,
        m.customer,
        m.name,
        m.assetNo,
        m.status === 'running' ? 'Running' : 'Breakdown',
        mMetrics.mttrMinutes.toFixed(1),
        mMetrics.mtbfMinutes.toFixed(1),
        mMetrics.failures,
      ];
    });

    const monthStr = now.toLocaleString([], { month: 'long', year: 'numeric' });

    const wb = XLSX.utils.book_new();
    const wsOverview = XLSX.utils.aoa_to_sheet([
      [`SYRMA SGS TECHNOLOGY - MONTHLY MAINTENANCE REPORT (${monthStr.toUpperCase()})`],
      [],
      ['Total Machine Assets', machines.length],
      ['Operating Running Fleet', machines.filter((m) => m.status === 'running').length],
      ['Breakdown Fleet', machines.filter((m) => m.status === 'breakdown').length],
      ['Monthly Failure count', events.filter((e) => e.failTime >= firstDay).length],
      [],
      ['--- ASSET STATISTICS BREAKDOWN ---'],
      headers,
      ...rows,
    ]);

    XLSX.utils.book_append_sheet(wb, wsOverview, 'Fleet Monthly Review');
    XLSX.writeFile(wb, `syrma_monthly_report_${monthStr.replace(' ', '_')}.xlsx`);
    showToast('success', 'Monthly Report Generated', `Downloaded Excel workbook for ${monthStr}`);
  };

  const activeBreakdownsCount = events.filter((e) => e.repairTime === undefined).length;

  return (
    <div className={`min-h-screen flex flex-col lg:flex-row transition-colors duration-300 ${
      theme === 'dark' 
        ? 'bg-slate-950 text-slate-100 bg-[radial-gradient(1200px_800px_at_85%_-10%,_rgba(59,130,246,0.15),_transparent_60%)]' 
        : 'bg-slate-50 text-slate-900 bg-[radial-gradient(1200px_800px_at_85%_-10%,_rgba(59,130,246,0.06),_transparent_60%)]'
    }`}>
      
      {/* Navigation Drawer Menu */}
      <Navbar
        activeView={activeView}
        setActiveView={setActiveView}
        theme={theme}
        setTheme={setTheme}
        liveBreakdownsCount={activeBreakdownsCount}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        supabaseStatus={supabaseStatus}
        isSyncing={isSyncing}
      />

      {/* Main Panel Column */}
      <main className="flex-1 flex flex-col min-w-0">
        
        {/* Print-Only Title Segment */}
        <div className="hidden print:block p-6 text-center border-b border-slate-300 mb-6">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Syrma SGS Breakdown Monitoring</h1>
          <p className="text-sm text-slate-500 mt-1">Generated report on {new Date().toLocaleDateString()}</p>
        </div>

        {/* Content Section Container */}
        <div className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6">
          
          {activeView === 'dashboard' && (
            <DashboardTab
              theme={theme}
              machines={machines}
              events={events}
              periodStart={periodStart}
              periodEnd={periodEnd}
              dashboardRange={dashboardRange}
              setDashboardRange={setDashboardRange}
              dashboardCustomFrom={dashboardCustomFrom}
              setDashboardCustomFrom={setDashboardCustomFrom}
              dashboardCustomTo={dashboardCustomTo}
              setDashboardCustomTo={setDashboardCustomTo}
            />
          )}

          {activeView === 'scan' && (
            <ScanTab
              theme={theme}
              machines={machines}
              onRegisterFailure={handleRegisterFailure}
              onRegisterRepair={handleRegisterRepair}
              toast={showToast}
            />
          )}

          {activeView === 'live' && (
            <LiveTab
              theme={theme}
              machines={machines}
              events={events}
              onRegisterRepair={handleRegisterRepair}
            />
          )}

          {activeView === 'machines' && (
            <MachinesTab
              theme={theme}
              machines={machines}
              masters={masters}
              onAddMachine={handleAddMachine}
              onDeleteMachine={handleDeleteMachine}
              toast={showToast}
            />
          )}

          {activeView === 'history' && (
            <HistoryTab
              theme={theme}
              events={events}
              onDownloadMonthlyReport={handleDownloadMonthlyReport}
            />
          )}

          {activeView === 'analytics' && (
            <AnalyticsTab
              theme={theme}
              machines={machines}
              events={events}
            />
          )}

          {activeView === 'settings' && (
            <SettingsTab
              theme={theme}
              masters={masters}
              onAddMasterValue={handleAddMasterValue}
              onRemoveMasterValue={handleRemoveMasterValue}
              onLoadSampleData={handleLoadSampleData}
              onResetAllData={handleResetAllData}
              toast={showToast}
              supabaseStatus={supabaseStatus}
              isSyncing={isSyncing}
              onForcePush={handleForcePush}
              onForcePull={handleForcePull}
            />
          )}

        </div>
      </main>

      {/* Floating Animated Push-Toasts Layer */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3.5 max-w-sm w-full pointer-events-none no-print">
        {toasts.map((toast) => {
          const borders = {
            success: 'border-emerald-500/15 bg-emerald-500/10 dark:bg-emerald-950/85 text-emerald-400',
            error: 'border-red-500/15 bg-red-500/10 dark:bg-red-950/85 text-red-400',
            info: 'border-blue-500/15 bg-blue-500/10 dark:bg-slate-900/90 text-blue-400',
          };
          return (
            <div
              key={toast.id}
              className={`p-4 rounded-xl border shadow-lg flex gap-3 pointer-events-auto backdrop-blur-md animate-slide-in ${
                borders[toast.type]
              }`}
            >
              <div className="mt-0.5 flex-shrink-0">
                {toast.type === 'success' && <CheckCircle size={16} />}
                {toast.type === 'error' && <AlertOctagon size={16} />}
                {toast.type === 'info' && <Clock size={16} />}
              </div>
              <div>
                <h5 className="font-bold text-xs tracking-tight text-white dark:text-white light:text-slate-900">
                  {toast.title}
                </h5>
                {toast.msg && (
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    {toast.msg}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
