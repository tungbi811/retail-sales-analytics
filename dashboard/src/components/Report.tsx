import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Lightbulb } from 'lucide-react'

/** Agent-written Markdown: headings, lists, emphasis and tables. Raw HTML in it is shown as text, never run. */
export function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="report-table">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

/** The Business Translator's report. Its numbers come from the data lake, not the gold models, and the label says so. */
export function Report({ markdown }: { markdown: string }) {
  return (
    <section className="report" aria-label="Report">
      <p className="report-source">
        <Lightbulb size={14} strokeWidth={1.8} aria-hidden="true" />
        From the data lake
      </p>
      <Md text={markdown} />
    </section>
  )
}
