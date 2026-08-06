// Shared facts about player-side member records. Party members, temporary
// allies, and borrowed coworkers all use the same { sheet, actor } liveness
// shape even when their rosters live in different owners.
export const isLivingMember = (member) =>
  !!member?.actor && (member.sheet?.hp ?? 0) > 0;

export function livingMemberAt(members, x, z, exclude = null) {
  return (members || []).find((member) => isLivingMember(member)
    && member !== exclude && member.actor.x === x && member.actor.z === z) || null;
}
