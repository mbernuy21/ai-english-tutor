import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chat } from '@google/genai';
import { createTextChat, sendTextChatMessageStream, checkGrammarAndCorrect } from '../services/geminiService.ts';
import { Message } from '../types.ts';
import Button from './Button.tsx';
import Spinner from './Spinner.tsx';

interface TextChatProps {
  mode: 'text_chat' | 'grammar_check';
}

const TextChat: React.FC<TextChatProps> = ({ mode }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const chatRef = useRef<Chat | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const systemInstruction = mode === 'text_chat'
    ? `You are an AI English tutor named 'Professor Spark'. You are here to answer questions about English grammar, vocabulary, culture, or any general topic to help the user learn English. Provide clear, concise, and helpful responses. Always respond in English.`
    : `You are an AI grammar, spelling, and syntax checker. Your task is to review the user's provided English text for any grammar, spelling, punctuation, or syntax errors. If errors are found, provide the fully corrected version of the text, followed by a clear, concise, and encouraging explanation for each specific correction. Explain *why* it was an error and *what* the correct rule is. If the text is perfect, respond with 'No errors found. Your text is perfectly written!'`;

  useEffect(() => {
    try {
      chatRef.current = createTextChat(systemInstruction);
      setMessages([]);
      setError(null);
      if (mode === 'text_chat') {
        setMessages([{ role: 'ai', text: "Hello! I'm Professor Spark. Ask me anything about English!" }]);
      } else {
        setMessages([{ role: 'ai', text: "Paste or type your English text here, and I'll check its grammar and spelling for you." }]);
      }
    } catch (err: any) {
      console.error("Failed to initialize text chat:", err);
      setError(`Failed to start text service: ${err.message}.`);
    }
  }, [mode, systemInstruction]);

  const handleSendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', text: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'text_chat' && chatRef.current) {
        setMessages(prev => [...prev, { role: 'ai', text: '', isThinking: true }]);
        const resultStream = await sendTextChatMessageStream(chatRef.current, userMessage.text);
        let aiFullResponse = '';
        for await (const chunk of resultStream) {
          aiFullResponse += chunk.text;
          setMessages(prev => {
            const updated = [...prev];
            // Manually find last AI message index
            let lastAiMessageIndex = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'ai' && updated[i].isThinking) {
                lastAiMessageIndex = i;
                break;
              }
            }
            if (lastAiMessageIndex > -1) {
              updated[lastAiMessageIndex] = { ...updated[lastAiMessageIndex], text: aiFullResponse };
            }
            return updated;
          });
        }
        setMessages(prev => {
            const updated = [...prev];
            // Manually find last AI message index
            let lastAiMessageIndex = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'ai' && updated[i].isThinking) {
                lastAiMessageIndex = i;
                break;
              }
            }
            if (lastAiMessageIndex > -1) {
                updated[lastAiMessageIndex] = { ...updated[lastAiMessageIndex], text: aiFullResponse, isThinking: false };
            }
            return updated;
        });

      } else if (mode === 'grammar_check') {
        setMessages(prev => [...prev, { role: 'ai', text: 'Checking grammar...', isThinking: true }]);
        const correction = await checkGrammarAndCorrect(userMessage.text);
        setMessages(prev => {
          const updated = [...prev];
          // Manually find last thinking message index
          let lastThinkingMessageIndex = -1;
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === 'ai' && updated[i].isThinking) {
              lastThinkingMessageIndex = i;
              break;
            }
          }
          if (lastThinkingMessageIndex > -1) {
            updated[lastThinkingMessageIndex] = { role: 'ai', text: correction, isThinking: false };
          } else {
            updated.push({ role: 'ai', text: correction, isThinking: false });
          }
          return updated;
        });
      }
    } catch (err: any) {
      console.error("Error sending message or checking grammar:", err);
      const errorMsg = err.message || 'Unknown error';
      let displayError = `Failed to get response: ${errorMsg}. Please try again.`;
      if (errorMsg.includes("Requested entity was not found.") || errorMsg.includes("Network error")) {
        displayError = `API Key Error: Your API key might be invalid or unauthorized. Please re-select your key if the problem persists.`;
      }
      setError(displayError);
      setMessages(prev => {
        const updated = [...prev];
        // Manually find last AI message index
        let lastAiMessageIndex = -1;
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === 'ai' && updated[i].isThinking) {
            lastAiMessageIndex = i;
            break;
          }
        }
        if (lastAiMessageIndex > -1) {
          updated.splice(lastAiMessageIndex, 1);
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, mode, chatRef]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-gray-50 rounded-lg shadow-lg p-6">
      <h2 className="text-3xl font-bold text-gray-800 mb-4 text-center">
        {mode === 'text_chat' ? 'AI Text Chat' : 'Grammar & Spell Check'}
      </h2>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
          <span className="absolute top-0 bottom-0 right-0 px-4 py-3">
            <svg onClick={() => setError(null)} className="fill-current h-6 w-6 text-red-500 cursor-pointer" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
          </span>
        </div>
      )}

      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 bg-white rounded-lg border border-gray-200 mb-4 custom-scrollbar">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex mb-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-3/4 p-3 rounded-lg shadow-md ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-none'
                  : 'bg-gray-200 text-gray-800 rounded-bl-none'
              }`}
            >
              {msg.isThinking ? (
                <div className="flex items-center">
                    <Spinner size="sm" color={msg.role === 'user' ? 'text-white' : 'text-indigo-600'} className="mr-2" />
                    <span>{msg.text || 'Thinking...'}</span>
                </div>
              ) : (
                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex p-4 bg-white rounded-lg border border-gray-200 sticky bottom-0 z-10 -mx-6 -mb-6">
        <textarea
          className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mr-2"
          placeholder={mode === 'text_chat' ? "Ask Professor Spark anything..." : "Paste your text for grammar check..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
        ></textarea>
        <Button onClick={handleSendMessage} disabled={isLoading || !input.trim()} loading={isLoading}>
          Send
        </Button>
      </div>
    </div>
  );
};

export default TextChat;