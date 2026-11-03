export function resolveMemberScope(settings, input) {
    const directory = [...settings.members];
    if (settings.currentUser && !directory.some(member => member.staffId === settings.currentUser.staffId))
        directory.push(settings.currentUser);
    let ids;
    if (input.memberIds?.length)
        ids = input.memberIds;
    else if (input.groupIds?.length) {
        const groups = input.groupIds.map(id => settings.groups?.find(group => group.id === id));
        if (groups.some(group => !group))
            throw new Error('GROUP_NOT_FOUND');
        ids = groups.flatMap(group => group.memberIds);
    }
    else if (input.scope === 'self') {
        if (!settings.currentUser)
            throw new Error('CURRENT_USER_UNRESOLVED');
        ids = [settings.currentUser.staffId];
    }
    else
        ids = settings.groups?.find(group => group.id === settings.defaultGroupId)?.memberIds ?? [];
    const unique = [...new Set(ids)];
    if (unique.some(id => !directory.some(member => member.staffId === id)))
        throw new Error('MEMBER_NOT_CONFIGURED');
    const members = unique.map(id => directory.find(member => member.staffId === id)).filter(member => input.memberIds?.length || member.enabled !== false);
    if (!members.length)
        throw new Error('TEAM_SCOPE_REQUIRED');
    return members.sort((a, b) => (a.order ?? directory.indexOf(a)) - (b.order ?? directory.indexOf(b)));
}
