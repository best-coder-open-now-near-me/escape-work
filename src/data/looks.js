// The wardrobe: which rigs a CUSTOM character may wear.
//
// Pure data - imports nothing, per the layering rule.
//
// This list is short on purpose. Every other rig in assets/characters/ is
// spoken for by one of the precut characters or by somebody you meet, and
// wearing their body is the thing this registry used to get wrong: it offered
// all twelve, so you could start the game looking like the Executive you fight
// on the last floor, or like the IT person who later joins your party. A body
// belongs to whoever the game says it belongs to.
//
// What is here is what nobody wears. Three of the four came free by deleting
// duplicates rather than by drawing anything: `veteran` when the Middle Manager
// moved onto the file named for the job, `seniormanager` and `regional` when
// the two hand-written tier variants were replaced by the scaling curve that
// already existed. `intern` came free when the IT companion stopped overriding
// his class's rig.
//
// If you give one of these to a character, take it out of here in the same
// change. The lint in tests/unit/levels.test.js holds that line.
export const CUSTOM_RIGS = ['veteran', 'intern', 'seniormanager', 'regional'];
