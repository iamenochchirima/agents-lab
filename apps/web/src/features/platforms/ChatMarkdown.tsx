import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render agent prose as Markdown; model output never becomes executable HTML. */
export function ChatMarkdown({ content }: { content: string }) {
  return <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    table: ({ children }) => <div className="chat-markdown-table"><table>{children}</table></div>,
  }}>{content}</ReactMarkdown></div>;
}
