export type SuggestionType =
  | "question"
  | "talking_point"
  | "answer"
  | "fact_check"
  | "clarification"
  | "definition";

export interface Suggestion {
  id: string;
  type: SuggestionType;
  preview: string;
  detail_seed?: string;
}

export interface SuggestionBatch {
  id: string;
  timestamp: number;
  meetingType?: string;
  suggestions: Suggestion[];
  clickedIds: string[];
}

export interface TranscriptChunk {
  id: string;
  timestamp: number;
  text: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  fromSuggestionId?: string;
}

export interface Settings {
  apiKey: string;
  suggestPrompt: string;
  expandPrompt: string;
  chatPrompt: string;
  liveContextMinutes: number;
  expandContextMinutes: number; // 0 = full
  refreshIntervalSec: number;
  transcribeChunkSec: number;
}
