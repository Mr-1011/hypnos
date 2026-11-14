# Two Hypnos demo situations

## Mock data

These are English role-play scripts, not real sleep recordings or evidence that speaking
at night improves sleep or next-day performance. The earlier statements are explicitly
fictional fixtures in `agent/mock/days/`. In real use, only the person's own recorded
statements may supply the behavior. Never present these demo memories as real history.

The scripts are a runbook, not an automatic audio simulator. The live model may phrase
its replies differently. Use Alexis, speed 0.7, expressivity -2. Do not read stage
directions aloud. The current loop cannot hear the person while Hypnos speaks.

## 1. Reactive — the person speaks while asleep

**Demo context:** The person is worried about an important investor call. The mock memory
from October 30 says: "On the investor call, I paused before answering and explained one
number at a time. That helped me stay clear."

**Person, softly:** "The numbers... I can't explain them."

**Dashboard:** The person's transcribed words appear as `you`. Hypnos calls `sense` and
`recall`; the Memory graph highlights the context it looked at.

**Hypnos:** "One number at a time helped."

**Dashboard:** The spoken response appears as `agent`, replacing the person's line in
the current single-line transcript. Both turns remain in the day's recording.

**[The person falls quiet; Hypnos does not ask a question.]**

**Acceptance:** With a sleeping stage, the reply is at most six words, grounded in the
retrieved behavior. Without a matching memory, use simple reassurance without an invented
success. The speech alone does not establish that the person is asleep: for a staged
presentation, explicitly call it a simulated sleep utterance. The sleep score is heuristic.

## 2. Preparatory — an important moment is ahead

**Demo context:** At bedtime, awake or drowsy, before the November 15 investor call.
The fictional November 13 statement says: "Sunday's investor call matters a lot to me.
Funding would let us keep building together, and I want to explain our numbers clearly."
The mock calendar confirms the upcoming call. October 30 supplies the person's own helpful
behavior: pausing, then explaining one number at a time.

**[Bedtime cue; the person has said nothing tonight.]**

**Hypnos:** "You paused and explained one number at a time last time."

**Hypnos:** "That same pause is available for tomorrow's call."

**Dashboard:** The retrieved memory is highlighted; the spoken preparation appears as
`agent`. No words are attributed to the person unless they actually speak.

**[Hypnos stays quiet afterward; no rehearsal or repeated prompting.]**

**Acceptance:** All three must be present: an upcoming event, personally stated high stakes,
and a relevant helpful behavior in the person's own retrieved words. Only awake/drowsy;
only once per event in this conversation. This is a prompt-level relevance rule, not a
validated estimate of impact or a deterministic policy engine.

**Negative checks:** An ordinary dentist appointment alone gets silence. A calendar event
without the person's stated stakes gets silence. High stakes without a relevant earlier
behavior get silence. Someone else's success does not count. Sleeping or unknown stage
gets silence for proactive preparation. A repeated cue for the same event gets silence.

## Presentation sequence

1. Explain the fictional history and simulated sleep scene before starting.
2. Show the relevant memory, then perform the reactive utterance and let Alexis finish.
3. For the preparatory scene, start a separate conversation with the important-event
   context available and an awake/drowsy stage. Keep the person silent for the bedtime cue.
4. Demonstrate a negative check: no important event means Hypnos stays quiet.

The bundled event is dated November 15, 2026. After that date, use a clearly labeled new
fixture for a future event; do not treat an expired appointment as upcoming.

The demo proves the interaction: heard words, retrieved context, a grounded spoken reply,
and selective silence. It does not establish prevention or a next-day behavioral benefit.
