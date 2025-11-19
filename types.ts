export enum LearningLevel {
  BEGINNER = 'Beginner',
  INTERMEDIATE = 'Intermediate',
  ADVANCED = 'Advanced',
}

export enum LearningTopic {
  GENERAL = 'General Conversation',
  GREETINGS = 'Greetings and Introductions',
  TRAVEL = 'Travel and Directions',
  FOOD = 'Ordering Food',
  WORK = 'Work and Professions',
  DAILY_LIFE = 'Daily Life',
  STUDIES = 'Studies and Education',
  HOBBIES = 'Hobbies and Interests',
  NEWS = 'Current Events and News',
  COFFEE_SHOP_ORDER = 'Coffee Shop Order',
  HOTEL_COMPLAINT = 'Hotel Complaint',
}

export interface FeedbackItem {
  original: string;
  correction: string;
  explanation: string;
  type: 'grammar' | 'pronunciation' | 'vocabulary' | 'improvement';
}

export interface Message {
  role: 'user' | 'ai';
  text: string;
  feedback?: FeedbackItem; // Replaced old loose feedback fields with structured object
  isThinking?: boolean;
  // Additional fields for SpanishTranslator
  feedbackText?: string;
  feedbackType?: 'grammar' | 'pronunciation' | 'vocabulary' | 'general';
  pronunciationExampleText?: string;
}

export interface VoiceChatConfig {
  level: LearningLevel;
  topic: LearningTopic;
}

export enum AppMode {
  VOICE_TUTOR = 'voice_tutor',
  TEXT_CHAT = 'text_chat',
  GRAMMAR_CHECK = 'grammar_check',
  SPANISH_TRANSLATOR = 'spanish_translator',
  ONLINE_TRANSLATOR = 'online_translator',
}

// Global type definitions to prevent build errors
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
  }
}