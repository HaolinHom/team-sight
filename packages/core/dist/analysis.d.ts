import type { HoursSnapshot, MemberHours } from './hoursTypes.js';
import type { DateRange, TeamSightSettings } from './types.js';
export declare const RULES_VERSION = "teamsight-hours-v1.2";
export declare const MCP_RULES_VERSION = "teamsight-mcp-hours-v2";
export interface AnalysisContext {
    range: DateRange;
    analysisDate: string;
    timeZone: string;
    projectIds: string[];
    memberIds: string[];
    configRevision: number;
    calendarVersion: string;
    rulesVersion: string;
}
export interface RiskFinding {
    code: 'HISTORICAL_HOURS_SHORT' | 'FORECAST_SHORT' | 'MISSING_SCHEDULE' | 'MISSING_ESTIMATE' | 'OVERDUE';
    message: string;
    staffId?: string;
    date?: string;
    taskKey?: string;
    evidence: string[];
}
export interface TeamAnalysis {
    analysisId: string;
    snapshotId: string;
    createdAt: string;
    fetchedAt: string;
    context: AnalysisContext;
    status: HoursSnapshot['status'];
    unit: 'hours';
    snapshot: HoursSnapshot;
    members: MemberHours[];
    risks: RiskFinding[];
    limitations: string[];
}
export declare function validateAnalysisInput(range: DateRange, analysisDate: string): void;
export declare function checkRisks(snapshot: HoursSnapshot, members: MemberHours[], settings: TeamSightSettings, today: string, policy?: 'legacy' | 'mcp'): RiskFinding[];
