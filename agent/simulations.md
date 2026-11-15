# David and Leah — the two approved Hypnos demo stories

## Mock data

Fictional English scripts approved for the demo. These are not real recordings, measured
sleep responses, or evidence of prevention. Show the daytime context before the night
scene. Label the sleep scenes as simulated. Use Alexis, speed 0.7, expressivity -2.

This document is the storyboard, not an automatic audio replay. David now has a live filming
mode: `./run.sh --demo-david`, or `agent/voice.py --demo david` with the other services running.
It loads isolated mock memories from `agent/demo/david/`. Turn Demo on and speak naturally near the real band, then pause.
"Oh no, I can't" is one example, not a special trigger. Context lookup runs for every speech
turn in both modes; Gemini chooses further memory searches and its response. Actual STT,
retrieval and Alexis produce the scene; rehearse first, since wording and ordering can vary.
Leah remains a storyboard. Never combine David and Leah in the same live brain.

## 1. David — reactive reassurance

### Daytime: David speaks to a friend

**David:** "They've worked on this for a year. I'm scared I'll let them down."

**Known upcoming event:** Tomorrow's investor pitch, personally important to David.

### Earlier experience: David's own words

**David:** "Maya and I took turns presenting. Having her beside me helped me feel steady."

### Current confirmation: David's own words

**David:** "Maya's presenting with me again tomorrow."

Both pieces of evidence must be visible in the story: sharing the presentation helped,
and Maya is actually participating tomorrow. A past mention of Maya alone is insufficient.

### Night: simulated sleep speech

**David, softly and hesitantly:** "No… I can't…"

**Dashboard:** The transcribed words appear as `you`. Hypnos looks at the known context
and earlier memory; the Memory graph can highlight retrieved evidence.

**Hypnos:** "You and Maya are a team."

**[Silence. No follow-up question.]**

The current dashboard shows one transcript line: Hypnos's response replaces David's line;
both settled turns remain in the day's recording. A fragment such as "No" does not prove
that David is dreaming about the pitch. This is contextual reassurance, not dream reading.

**Checks:** Without current confirmation that Maya participates, do not use this reply.
Without attributable context, do not infer a specific worry from "No" or "I can't".
During sleep, use at most six words and no question. Do not demand a response.

## 2. Leah — sensor-triggered support while asleep, without speech

### Daytime: Leah speaks to her sister

**Leah:** "This job would let me move closer to you. I keep trying to prepare every possible answer."

**Known upcoming event:** Tomorrow's important job interview. Being closer to her sister
is Leah's stated reason that this matters.

### Earlier experience: Leah's own words

**Leah:** "For my last interview, I picked one project I knew well. Talking through it helped me settle."

### Current plan: Leah's own words

**Leah:** "Tomorrow, I'll start with the community project."

### Night: simulated arousal, Leah says nothing

**[Leah is asleep. The dashboard's arousal trace rises.]**

A sensor cue prompts Hypnos to check the already known context: important upcoming event,
personally stated significance, and a relevant helpful behavior in Leah's own words.
Arousal does not identify a worry or prove that Leah is thinking about her interview.

**Hypnos:** "One familiar story to start."

**[Silence. No rehearsal, question or repeated prompting.]**

**Dashboard:** Only Hypnos's sentence appears as `agent`. Never insert a `you` utterance
for Leah. The retrieved memory supplies the reason for the response, not a supposed
interpretation of the sensor trace. Do not stage an immediate arousal drop as proof of benefit.

**Checks:** No important upcoming event, no personally stated significance, no matching
helpful memory, or unknown sleep stage means stay quiet. A second cue for the same event
in the same conversation also means stay quiet. An ordinary calendar entry is insufficient.

## Implementation and presentation boundaries

The approved second story replaces the earlier awake/drowsy bedtime-preparation version.
The prompt and agent skills allow one short sleep response to a restlessness/arousal cue
when all context checks pass. Bedtime alone does not trigger this second scene.

The existing backend emits movement/restlessness and sleep-to-awake cues; it does not
consume the dashboard's arousal curve as a trigger. The dashboard is a view, and its
made-up history is not sensor evidence. David has an isolated live context; driving a simulated Leah cue and loading her isolated
context remain separate work.

For a one-minute video, show David's spoken trigger and Leah's silent sensor trigger.
Keep each evidence card readable, show the response, then leave silence. This demonstrates
context retrieval and selective response, not validated psychological benefit. Sleep stages
are heuristic. The relevance and once-per-event checks are currently prompt-level rules.
