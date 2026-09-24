import { Node, mergeAttributes } from "@tiptap/vue-3";

export interface QuoteRefOptions {
  HTMLAttributes?: Record<string, any>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    quoteRef: {
      insertQuoteRef: (attributes: { quoteId: string; title: string }) => ReturnType;
    };
  }
}

/**
 * 架构级安全加固：TipTap 原生原子引用胶囊
 */
export const QuoteRefExtension = Node.create<QuoteRefOptions>({
  name: "quoteRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      quoteId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-quote-id"),
        renderHTML: (attributes) => {
          if (!attributes.quoteId) return {};
          return { "data-quote-id": attributes.quoteId };
        },
      },
      title: {
        default: "摘录原句",
        parseHTML: (element) => element.getAttribute("data-quote-title") || element.textContent?.replace(/^[🔗\s]+/, "") || "摘录原句",
        renderHTML: (attributes) => {
          return { "data-quote-title": attributes.title };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="quote-ref"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const title = HTMLAttributes["data-quote-title"] || "摘录原句";
    const quoteId = HTMLAttributes["data-quote-id"] || "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "quote-ref",
        "data-ref-quote-id": quoteId,
        class: "quote-ref-atom quote-link-badge inline-flex items-center gap-1 px-2.5 py-0.5 mx-1 rounded-full bg-emerald-50 text-emerald-950 border border-emerald-300 font-sans text-xs font-semibold select-none align-middle shadow-2xs hover:bg-emerald-100 hover:border-emerald-400 transition-all cursor-pointer",
      }),
      ["span", { class: "text-[11px] text-emerald-700 leading-none pointer-events-none" }, "🔗"],
      ["span", { class: "truncate max-w-[160px] pointer-events-none" }, title],
    ];
  },

  addCommands() {
    return {
      insertQuoteRef:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },
});
