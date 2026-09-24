export interface Thought {
  id: string;
  quote_id: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface BacklinkItem {
  source_quote_id: string;
  source_thought_id: string | null;
  is_question: number;
  quote_source: string | null;
  context_snippet: string;
  created_at: number;
}

export interface QuoteDetail {
  id: string;
  content: string;
  source: string | null;
  is_question: number;
  is_resolved: number;
  created_at: number;
  tags: string[];
  thoughts: Thought[];
  backlinks_count?: number;
}

export interface TagStat {
  id: number;
  name: string;
  count: number;
}

export interface FlatTagRow {
  name: string;
  fullPath: string;
  depth: number;
  count: number;
  totalCount: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isMatched: boolean;
}

export interface TagNode {
  name: string;
  fullPath: string;
  count: number;
  totalCount: number;
  children: Map<string, TagNode>;
}

export interface TagColorStyle {
  bg: string;
  text: string;
  border: string;
  dot: string;
}

export interface SecuritySettings {
  is_locked: boolean;
  password_hash: string;
  salt: string;
}

export interface AppLog {
  id: number;
  time: string;
  level: "info" | "success" | "warn" | "error";
  tag: string;
  msg: string;
}

export interface TimeFilterRange {
  label: string;
  start: number;
  end: number;
}

export interface DayArchiveItem {
  key: string;
  label: string;
  dayOfWeek: string;
  start: number;
  end: number;
  quoteCount: number;
  thoughtCount: number;
  totalCount: number;
}

export interface MonthArchiveGroup {
  key: string;
  label: string;
  start: number;
  end: number;
  totalCount: number;
  days: DayArchiveItem[];
}

export interface NavHistoryItem {
  sourceCardId: string;
  sourceTitle: string;
  prevFilterOnlyQuestions: boolean;
  prevSelectedTag: string | null;
  prevSelectedTimeRange: TimeFilterRange | null;
  prevSearchQuery: string;
  prevEntryTypeFilter?: string;
}
