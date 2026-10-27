'use strict';

/**
 * Scripted, fictional meeting used by the live replay demo (`GET /api/stream-meeting`).
 * @type {ReadonlyArray<import('./schemas').Utterance>}
 */
const DEMO_MEETING = Object.freeze([
  { speaker: 'Alice', text: "Alright everyone, let's kick off the planning meeting for the new analytics dashboard." },
  { speaker: 'Bob', text: 'Sounds good. Do we have the finalized designs from the UI team?' },
  { speaker: 'Charlie', text: "Not yet, they said they'd have them by tomorrow." },
  { speaker: 'Alice', text: 'Okay, we can start on the backend setup first.' },
  { speaker: 'Bob', text: 'I can build the API by Tuesday.' },
  { speaker: 'Alice', text: 'Great. Charlie, what about the database schema?' },
  { speaker: 'Charlie', text: "I'll draft the schema tonight and send it over for review." },
  {
    speaker: 'Bob',
    text: "Actually, there's a problem. We don't have the updated user metrics. We can't build the schema without them.",
  },
  { speaker: 'Charlie', text: "That's ridiculous, I asked for those metrics last week!" },
  { speaker: 'Alice', text: "Let's calm down. I will email the data team right after this call and get them." },
  { speaker: 'Bob', text: "Thanks Alice. If we get them today, we're still on track." },
  { speaker: 'Charlie', text: 'Agreed. Sorry for the outburst, just stressed about the deadline.' },
  { speaker: 'Alice', text: "No problem. So we have our action items. Let's reconvene on Wednesday." },
]);

module.exports = { DEMO_MEETING };
