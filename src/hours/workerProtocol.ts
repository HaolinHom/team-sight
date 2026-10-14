import type { DateRange } from '@/gantt/dateUtils';
import type { HoursSettings, HoursSnapshot, MemberHours } from '@/types/hours';
import type { MemberEntry } from '@/types/settings';
export interface HoursCalculationInput { snapshot: HoursSnapshot; members: readonly MemberEntry[]; settings: HoursSettings; range: DateRange; today: string }
export interface HoursWorkerRequest { id: number; snapshot?: HoursSnapshot; input: Omit<HoursCalculationInput, 'snapshot'> }
export interface HoursWorkerResult { id: number; rows?: MemberHours[]; error?: string; calculationMs: number }
