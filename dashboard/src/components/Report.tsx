import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Telescope } from 'lucide-react'

/**
 * The Business Translator's report as Markdown: headings, lists, emphasis and tables.
 * Raw HTML in it is shown as text, never run. Its numbers come from the data lake, not the gold models, and the label says so.
 */
export function Report({ markdown }: { markdown: string }) {
  return (
    <section className="report" aria-label="Report">
      <p className="report-source">
        <Telescope size={14} strokeWidth={1.8} aria-hidden="true" />
        From the data lake
      </p>
      <div className="report-body">
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
          {markdown}
        </Markdown>
      </div>
    </section>
  )
}
