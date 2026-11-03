import type { DateRange } from './types.js';
export interface CapacityDay {
    date: string;
    target: number;
    actual: number;
    occupied: number;
    available: number;
    unknown?: boolean;
}
export interface PlanningTask {
    ref: string;
    title: string;
    hours: number;
    memberIds: string[];
    storyId?: string;
    projectId?: string;
    earliest?: string;
    latest?: string;
    originalTaskKey?: string;
}
export interface PlanningDependency {
    before: string;
    after: string;
    delivery?: string;
    source: 'user' | 'inferred';
    allowSameDay?: boolean;
}
export interface PlanningInput {
    range: DateRange;
    tasks: PlanningTask[];
    capacities: Record<string, CapacityDay[]>;
    dependencies?: PlanningDependency[];
    milestones?: Array<{
        ref: string;
        date: string;
    }>;
    direction?: 'forward' | 'backward';
    maxStates?: number;
}
export interface TaskPlacement {
    ref: string;
    memberId: string;
    start: string;
    end: string;
    daily: Array<{
        date: string;
        hours: number;
    }>;
}
export interface ScheduleCandidate {
    id: string;
    profile: 'continuity' | 'earliest';
    placements: TaskPlacement[];
    metrics: {
        interruptions: number;
        splitDays: number;
        completion: string;
        start: string;
        requirementSpan: number;
    };
}
export interface PlanningResult {
    status: 'feasible' | 'infeasible' | 'search_incomplete' | 'needs_information';
    candidates: ScheduleCandidate[];
    conflicts: string[];
    unscheduled: string[];
    search: {
        visited: number;
        budget: number;
        complete: boolean;
    };
    assumptions: string[];
}
export declare function planSchedule(input: PlanningInput): PlanningResult;
