import { GoogleGenAI, LiveServerMessage, Modality, Chat, GenerateContentResponse, Type } from "@google/genai";
import { decode, decodeAudioData, encode, createBlob } from "../utils/audioUtils.ts";
import { LearningLevel, LearningTopic, AppMode } from "../types.ts"; // Import AppMode
import type { MutableRefObject } from 'react';

export type LiveClientType = Awaited<ReturnType<GoogleGenAI['live']['connect']>>;

interface LiveSessionCallbacks {
  onOpen: () => void;
  onMessage: (message: LiveServerMessage) => Promise<void>;
  onError: (e: Event) => void;
  onClose: (e: CloseEvent) => void;
}

export interface SetupLiveSessionParams {
  callbacks: LiveSessionCallbacks;
  modeConfig: {
    mode: AppMode;
    level?: LearningLevel | null;
    topic?: LearningTopic | null;
  };
  audioConfig: {
    inputAudioContext: AudioContext;
    outputAudioContext: AudioContext;
    inputNode: GainNode;
    outputNode: GainNode;
    stream: MediaStream;
    sources: Set<AudioBufferSourceNode>;
    nextStartTimeRef: MutableRefObject<number>;
  };
}

async function ensureApiKeySelected(): Promise<void> {
  if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      alert("Please select your Gemini API key. This is required for some features like advanced video generation.");
      await window.aistudio.openSelectKey();
    }
  }
}

export const setupLiveSession = async (
  params: SetupLiveSessionParams
): Promise<LiveClientType> => {
  const { callbacks, modeConfig, audioConfig } = params;
  const { mode, level, topic } = modeConfig;
  const {
    inputAudioContext,
    outputAudioContext,
    inputNode,
    outputNode,
    stream,
    sources,
    nextStartTimeRef,
  } = audioConfig;
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  let systemInstruction: string;

  if (mode === AppMode.SPANISH_TRANSLATOR) {
    systemInstruction = `You are an AI English tutor named 'Professor Spark', operating in "Spanish to English Translator & Pronunciation Practice" mode.
Your main goal is to help the user translate Spanish phrases into English and then practice their English pronunciation.

Here's the interaction flow:
1.  **When the user speaks SPANISH (initial input):**
    *   Listen to the user's Spanish phrase.
    *   Your immediate response MUST be:
        *   The accurate English translation of the Spanish phrase.
        *   Speak this English translation aloud using your voice.
        *   Implicitly acknowledge the Spanish input (e.g., "Ah, entiendo. In English, we say...").
        *   Conclude your response by explicitly prompting the user to *repeat the English translation* for pronunciation practice. E.g., "In English, we say, '**[English translation]**'. Please say it after me for pronunciation practice." (Use double asterisks for the word/phrase to be practiced).
2.  **When the user speaks ENGLISH (following your translation prompt):**
    *   Listen to the user's attempt at pronouncing the English phrase you just provided.
    *   Do NOT translate or offer new content. Your task now is to provide **explicit pronunciation feedback** on their English attempt, comparing it to the correct English phrase you provided.
    *   Use the format: "💡 Pronunciation Tip: [Description of the incorrect sound or area for improvement, how to correctly produce it (e.g., tongue/mouth position if possible)]. You might have meant: **[the correctly pronounced English word or phrase]**. Try again!"
    *   After giving pronunciation feedback, conclude your response by resetting and prompting the user to say *another* Spanish phrase to start a new cycle. E.g., "Great practice! Now, tell me another phrase in Spanish."

Always respond in English, except for explicitly acknowledging Spanish input or providing Spanish context for a translation. Keep your English simple and clear. Let's begin! Ask the user to say something in Spanish.`;
  } else if (mode === AppMode.ONLINE_TRANSLATOR) {
    systemInstruction = `You are a professional, high-accuracy Real-Time Interpreter.

**Objective:**
Translate spoken language immediately and accurately between English and Spanish. The user is reading your output, so the text must be grammatically correct and easy to read.

**Strict Protocol:**
1.  **Listen** to the input.
2.  **Translate**:
    *   If the input is **English** -> Translate to **Spanish**.
    *   If the input is **Spanish** -> Translate to **English**.
3.  **Speak**: Output ONLY the translation.
    *   Do NOT add filler words (e.g., "The translation is...", "Says...").
    *   Do NOT explain the translation.
    *   Do NOT engage in conversation.

**Example:**
*   User (English): "Where is the library?"
*   You (Output): "¿Dónde está la biblioteca?"

*   User (Spanish): "Quiero un café."
*   You (Output): "I want a coffee."`;
  } else { // Default to VOICE_TUTOR mode
    systemInstruction = `You are an AI English tutor named 'Professor Spark'. Your goal is to help the user improve their spoken English. The current learning level is ${level} and the topic is "${topic}".

**Core Interaction Rules:**
1.  **Conversational Language:** Speak primarily in ENGLISH. Keep the conversation natural and engaging based on the topic.
2.  **Active Correction:** If the user makes a grammar, pronunciation, or vocabulary mistake, you MUST provide a correction AFTER your conversational response.
3.  **Vocabulary Highlighting:** When you use an interesting idiom, phrasal verb, or advanced vocabulary word in your response, wrap it in double asterisks (e.g., **serendipity**) so the user can click it to hear the pronunciation.

**Output Format (CRITICAL):**
You must strictly separate your conversational response from your teaching feedback using a specific text block format.

1.  **Conversational Part:** Respond naturally to what the user said.
2.  **Feedback Part (Only if an error occurred):**
    If an error is detected, insert a line break and then output a block exactly like this:

    ### FEEDBACK ###
    Type: [Grammar / Pronunciation / Vocabulary]
    Original: [The specific part of the user's sentence that was incorrect]
    Correction: [The correct way to say it]
    Explanation: [A brief, simple explanation of why, max 15 words]
    ### END FEEDBACK ###

    *Example Output:*
    "That sounds like a lovely trip! Paris is **beautiful** in the spring. Did you visit the Eiffel Tower?"
    ### FEEDBACK ###
    Type: Grammar
    Original: I go to Paris last year.
    Correction: I went to Paris last year.
    Explanation: Use the past tense 'went' for actions completed in the past.
    ### END FEEDBACK ###

**Level Adaptation:**
*   **${LearningLevel.BEGINNER}:** Simple words, slow pace. Correct basic errors. Highlight 1-2 key simple words per turn.
*   **${LearningLevel.INTERMEDIATE}:** Normal pace. Correct tense and preposition errors. Highlight interesting idioms or phrasal verbs.
*   **${LearningLevel.ADVANCED}:** Natural pace. Focus on native-like phrasing and idioms. Highlight sophisticated vocabulary.

Start the conversation now based on the topic "${topic}".`;
  }

  const sessionConnectionPromise = ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
    callbacks: {
      onopen: () => {
        const source = inputAudioContext.createMediaStreamSource(stream);
        const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
          const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
          const pcmBlob = createBlob(inputData);
          sessionConnectionPromise.then((session) => {
            session.sendRealtimeInput({ media: pcmBlob });
          });
        };
        source.connect(scriptProcessor);
        scriptProcessor.connect(inputAudioContext.destination);
        callbacks.onOpen();
      },
      onmessage: async (message: LiveServerMessage) => {
        const base64EncodedAudioString =
          message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (base64EncodedAudioString) {
          nextStartTimeRef.current = Math.max(
            nextStartTimeRef.current,
            outputAudioContext.currentTime
          );
          const audioBuffer = await decodeAudioData(
            decode(base64EncodedAudioString),
            outputAudioContext,
            24000,
            1
          );
          const source = outputAudioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(outputNode);
          source.addEventListener('ended', () => {
            sources.delete(source);
          });

          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
          sources.add(source);
        }

        const interrupted = message.serverContent?.interrupted;
        if (interrupted) {
          for (const source of sources.values()) {
            source.stop();
            sources.delete(source);
          }
          nextStartTimeRef.current = 0;
        }

        await callbacks.onMessage(message);
      },
      onerror: (e: Event) => {
        console.error('Live API Error:', e);
        callbacks.onError(e);
      },
      onclose: (e: CloseEvent) => {
        console.debug('Live API Closed:', e);
        callbacks.onClose(e);
      },
    },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
      },
      systemInstruction: systemInstruction,
      outputAudioTranscription: {},
      inputAudioTranscription: {}
    }
  });

  const session = await sessionConnectionPromise;
  return session;
};

export const createTextChat = (systemInstruction?: string): Chat => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return ai.chats.create({
    model: 'gemini-2.5-flash',
    config: systemInstruction ? { systemInstruction } : undefined,
  });
};

export const sendTextChatMessage = async (
  chat: Chat,
  message: string
): Promise<GenerateContentResponse> => {
  return await chat.sendMessage({ message: message });
};

export const sendTextChatMessageStream = async (
  chat: Chat,
  message: string
): Promise<AsyncIterable<GenerateContentResponse>> => {
  return await chat.sendMessageStream({ message: message });
};

export const checkGrammarAndCorrect = async (text: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `You are an AI grammar, spelling, and syntax checker. Review the following English text for any grammar, spelling, punctuation, or syntax errors. If errors are found, provide the fully corrected version of the text, followed by a clear, concise, and encouraging explanation for each specific correction. Explain *why* it was an error and *what* the correct rule is. If the text is perfect, respond with 'No errors found. Your text is perfectly written!'

Text to check:
\`\`\`
${text}
\`\`\``,
    config: {
      temperature: 0.2,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 500,
      thinkingConfig: { thinkingBudget: 100 }
    }
  });
  return response.text;
};

export const generateSpeechForText = async (text: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Zephyr' }
        }
      }
    }
  });
  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Failed to generate speech audio.');
  }
  return base64Audio;
};