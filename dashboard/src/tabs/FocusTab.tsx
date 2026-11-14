import { Memory } from '../components/Memory'
import { Transcript } from '../components/Transcript'

// Only how the agent works, as large as the screen (the user's rules, 2026-11-14): the picture of
// the Memory card, drawn twice as large, and the one line of words under it. No device cards over
// it, and no frame and no title around it (styles.css, "the Focus tab").
export function FocusTab() {
  return (
    <main className="grid focus">
      <Memory className="span12" scale={2}>
        <Transcript />
      </Memory>
    </main>
  )
}
