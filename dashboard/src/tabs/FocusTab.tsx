import { Memory } from '../components/Memory'
import { Transcript } from '../components/Transcript'

// Only how the agent works, as large as the screen (the user's rules, 2026-11-14): the Memory
// card's picture in detail, as a notes app draws a vault, and the one line of words under it. No
// device cards over it and no frame around it (styles.css, "the Focus tab").
export function FocusTab() {
  return (
    <main className="grid focus">
      <Memory className="span12" detail>
        <Transcript />
      </Memory>
    </main>
  )
}
