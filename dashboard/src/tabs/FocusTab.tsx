import { Course, Legend } from '../components/Course'
import { Panel } from '../components/Panel'
import { Transcript } from '../components/Transcript'

// Only the person, as large as the screen (the user's rule, 2026-11-14): the Sleep State graph,
// opened on the minutes around now, and the one line of words under it.
export function FocusTab() {
  return (
    <main className="grid focus">
      <Panel title="Sleep State" className="span12" tools={<Legend />}>
        <Course follow />
        <Transcript />
      </Panel>
    </main>
  )
}
