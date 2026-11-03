import type { TeamSightSettings, MemberEntry } from './types.js';
export interface MemberScope {
    scope?: 'self' | 'team';
    memberIds?: string[];
    groupIds?: string[];
}
export declare function resolveMemberScope(settings: TeamSightSettings, input: MemberScope): MemberEntry[];
