export interface Machine {
  id: string;
  area: string;
  line: string;
  customer: string;
  name: string;
  assetNo: string;
  status: 'running' | 'breakdown';
  qrPayload: string;
}

export interface BreakdownEvent {
  id: string;
  machineId: string;
  area: string;
  line: string;
  customer: string;
  machineName: string;
  assetNo: string;
  failTime: number; // timestamp
  repairTime?: number; // timestamp
  duration?: number; // in minutes
}

export interface MasterLists {
  areas: string[];
  lines: string[];
  customers: string[];
}

export type DateViewMode = 'today' | 'week' | 'month' | 'custom';

export interface DashboardStats {
  totalMachines: number;
  runningMachines: number;
  breakdownMachines: number;
  totalFailures: number;
  totalRepairs: number;
  totalDowntimeMinutes: number;
  avgMTTRMinutes: number;
  avgMTBFMinutes: number;
}
