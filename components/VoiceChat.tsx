import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LiveServerMessage } from '@google/genai';
import { setupLiveSession, generateSpeechForText, LiveClientType } from '../services/geminiService.ts';
import { LearningLevel, LearningTopic, Message, VoiceChatConfig, AppMode, FeedbackItem } from '../types.ts';
import Button from './Button.tsx';
import Spinner from './Spinner.tsx';
import AudioPulse from './AudioPulse.tsx';
import { decode, decodeAudioData } from '../utils/audioUtils.ts';

interface VoiceChatProps {
  config: VoiceChatConfig;
}

const VoiceChat: React.FC<VoiceChatProps> = ({ config }) => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSessionReady, setIsSessionReady] = useState<boolean>(false);
  const [isLoadingMedia, setIsLoadingMedia] = useState<boolean>(false);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [sessionNotes, setSessionNotes] = useState<FeedbackItem[]>([]);
  const [showNotes, setShowNotes] = useState<boolean>(false);
  
  const [currentInputTranscription, setCurrentInputTranscription] = useState<string>('');
  const [currentOutputTranscription, setCurrentOutputTranscription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);

  const liveSessionRef = useRef<LiveClientType | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputNodeRef = useRef<GainNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const notesContainerRef = useRef<HTMLDivElement>(null);
  const currentPronunciationSource = useRef<AudioBufferSourceNode | null>(null);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  useEffect(() => { currentInputTranscriptionRef.current = currentInputTranscription; }, [currentInputTranscription]);
  useEffect(() => { currentOutputTranscriptionRef.current = currentOutputTranscription; }, [currentOutputTranscription]);

  const resetAudioContexts = useCallback(() => {
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(console.error);
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(console.error);
      outputAudioContextRef.current = null;
    }
  }, []);

  const stopMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const parseFeedback = useCallback((aiResponseText: string): { conversationalText: string; feedback?: FeedbackItem } => {
    const feedbackStart = '### FEEDBACK ###';
    const feedbackEnd = '### END FEEDBACK ###';

    let conversationalText = aiResponseText;
    let feedback: FeedbackItem | undefined;

    const startIndex = aiResponseText.indexOf(feedbackStart);
    const endIndex = aiResponseText.indexOf(feedbackEnd);

    if (startIndex !== -1 && endIndex !== -1) {
      conversationalText = aiResponseText.substring(0, startIndex).trim();
      const feedbackBlock = aiResponseText.substring(startIndex + feedbackStart.length, endIndex).trim();
      
      const typeMatch = feedbackBlock.match(/Type:\s*(.*)/i);
      const originalMatch = feedbackBlock.match(/Original:\s*(.*)/i);
      const correctionMatch = feedbackBlock.match(/Correction:\s*(.*)/i);
      const explanationMatch = feedbackBlock.match(/Explanation:\s*(.*)/i);

      if (correctionMatch) {
        feedback = {
          type: (typeMatch?.[1]?.trim().toLowerCase() as any) || 'general',
          original: originalMatch?.[1]?.trim() || '',
          correction: correctionMatch?.[1]?.trim() || '',
          explanation: explanationMatch?.[1]?.trim() || '',
        };
      }
    }

    return { conversationalText, feedback };
  }, []);

  const playPronunciationExample = useCallback(async (text: string, key: string) => {
    if (!outputAudioContextRef.current || playingAudioKey !== null) return;

    setPlayingAudioKey(key);
    if (currentPronunciationSource.current) {
        currentPronunciationSource.current.stop();
        currentPronunciationSource.current.disconnect();
    }
    
    try {
        const base64Audio = await generateSpeechForText(text);
        const audioBuffer = await decodeAudioData(
            decode(base64Audio),
            outputAudioContextRef.current,
            24000,
            1
        );

        const source = outputAudioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputNodeRef.current!);
        source.onended = () => {
            setPlayingAudioKey(null);
            currentPronunciationSource.current = null;
        };
        source.start(0);
        currentPronunciationSource.current = source;
    } catch (err) {
        console.error("Error playing pronunciation example:", err);
        setPlayingAudioKey(null);
    }
  }, [playingAudioKey]);

  const parseVocabulary = useCallback((text: string, messageId: number) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const word = part.slice(2, -2);
        const key = `msg-${messageId}-word-${index}`;
        return (
          <button
            key={key}
            onClick={() => playPronunciationExample(word, key)}
            className={`inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-sm font-bold transition-colors ${
                playingAudioKey === key 
                ? 'bg-indigo-200 text-indigo-800' 
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 cursor-pointer'
            }`}
            title="Click to hear pronunciation"
            disabled={playingAudioKey !== null && playingAudioKey !== key}
          >
            {playingAudioKey === key ? (
                <svg className="animate-spin h-3 w-3 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                </svg>
            )}
            {word}
          </button>
        );
      }
      return part;
    });
  }, [playPronunciationExample, playingAudioKey]);

  const stopConversation = useCallback(() => {
    setIsRecording(false);
    setIsSessionReady(false);
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    stopMediaStream();
    resetAudioContexts();
    audioSourceNodesRef.current.forEach(source => source.stop());
    audioSourceNodesRef.current.clear();
    if (currentPronunciationSource.current) {
        currentPronunciationSource.current.stop();
        currentPronunciationSource.current = null;
    }
    setPlayingAudioKey(null);
    nextStartTimeRef.current = 0;

    setCurrentInputTranscription('');
    setCurrentOutputTranscription('');
  }, [stopMediaStream, resetAudioContexts]);

  const handleApiError = useCallback((e: Event) => {
    const errorMsg = (e as ErrorEvent).message || 'Unknown error';
    console.error('API Error Detected:', errorMsg);
    
    if (errorMsg.includes("Requested entity was not found.") || errorMsg.includes("403") || errorMsg.includes("404") || errorMsg.includes("Network error")) {
      if (!window.aistudio) {
          setError(`API Error: Check Vercel Environment Variables. Make sure VITE_API_KEY is set.`);
      } else {
          setError(`API Key Error: Please re-select your API key.`);
          if (typeof window.aistudio.openSelectKey === 'function') {
              window.aistudio.openSelectKey().catch(console.error);
          }
      }
    } else {
      setError(`Conversation Error: ${errorMsg}. Please try again.`);
    }
    stopConversation();
  }, [stopConversation]);

  const onOpenCallback = useCallback(() => {
    console.log('Live session opened.');
    setIsSessionReady(true);
    setIsLoadingMedia(false);
    setConversation(prev => [...prev, { role: 'ai', text: `Hello! I'm Professor Spark. Let's talk about ${config.topic}.`, isThinking: false }]);
  }, [config.topic]);

  const onMessageLogic = useCallback(async (message: LiveServerMessage) => {
    if (message.serverContent?.outputTranscription) {
      setCurrentOutputTranscription(prev => prev + message.serverContent.outputTranscription.text);
    }
    if (message.serverContent?.inputTranscription) {
      setCurrentInputTranscription(prev => prev + message.serverContent.inputTranscription.text);
    }
  
    if (message.serverContent?.turnComplete) {
      const latestInputTranscription = currentInputTranscriptionRef.current;
      const latestOutputTranscription = currentOutputTranscriptionRef.current;

      if (latestInputTranscription) {
        setConversation(prev => [...prev, { role: 'user', text: latestInputTranscription, isThinking: false }]);
      }

      if (latestOutputTranscription) {
        const { conversationalText, feedback } = parseFeedback(latestOutputTranscription);
        
        setConversation(prev => [...prev, { 
            role: 'ai', 
            text: conversationalText, 
            isThinking: false,
            feedback: feedback // Store structured feedback on the message itself for potential inline display
        }]);

        if (feedback) {
          setSessionNotes(prev => [...prev, feedback!]);
          if (!showNotes) setShowNotes(true);
        }
      }
  
      setCurrentInputTranscription('');
      setCurrentOutputTranscription('');
    }
  }, [parseFeedback, showNotes]);

  const onCloseCallback = useCallback((e: CloseEvent) => {
    console.log('Live session closed:', e.code, e.reason);
    if(isRecording) {
      setError('Session closed unexpectedly. Please start a new session.');
    }
    stopConversation();
  }, [isRecording, stopConversation]);

  const initializeAudio = useCallback(async () => {
    setIsLoadingMedia(true);
    setError(null);
    try {
      stopMediaStream();
      resetAudioContexts();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const newInCtx = new AudioContext({ sampleRate: 16000 });
      const newOutCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioContextRef.current = newInCtx;
      outputAudioContextRef.current = newOutCtx;

      inputNodeRef.current = newInCtx.createGain();
      outputNodeRef.current = newOutCtx.createGain();
      outputNodeRef.current.connect(newOutCtx.destination);

      const session = await setupLiveSession({
        callbacks: {
          onOpen: onOpenCallback,
          onMessage: onMessageLogic,
          onError: handleApiError,
          onClose: onCloseCallback,
        },
        modeConfig: {
          mode: AppMode.VOICE_TUTOR,
          level: config.level,
          topic: config.topic
        },
        audioConfig: {
          inputAudioContext: newInCtx,
          outputAudioContext: newOutCtx,
          inputNode: inputNodeRef.current,
          outputNode: outputNodeRef.current,
          stream: stream,
          sources: audioSourceNodesRef.current,
          nextStartTimeRef: nextStartTimeRef,
        },
      });
      liveSessionRef.current = session;
    } catch (err: any) {
      console.error('Error initializing audio or Live API:', err);
      if (err.message.includes("API Key not found")) {
         setError("API Key missing. Please check Vercel Settings.");
      } else if (err.message.includes("Requested entity was not found") || err.message.includes("403")) {
          if (!window.aistudio) {
              setError(`API Error: Please check your 'API_KEY' or 'VITE_API_KEY' in Vercel Settings.`);
          } else {
              setError(`API Error: Invalid Key.`);
          }
      } else {
          setError(`Failed to start session: ${err.message}. Please check microphone permissions.`);
      }
      setIsLoadingMedia(false);
      setIsSessionReady(false);
      stopConversation();
    }
  }, [config, stopMediaStream, resetAudioContexts, onOpenCallback, onMessageLogic, handleApiError, onCloseCallback, stopConversation]);

  const startConversation = useCallback(() => {
    if (!isRecording) {
      setConversation([]);
      setSessionNotes([]);
      setCurrentInputTranscription('');
      setCurrentOutputTranscription('');
      nextStartTimeRef.current = 0;
      audioSourceNodesRef.current.forEach(source => source.stop());
      audioSourceNodesRef.current.clear();
      setIsRecording(true);
      initializeAudio();
    }
  }, [isRecording, initializeAudio]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [conversation, currentInputTranscription, currentOutputTranscription]);

  useEffect(() => {
    if (notesContainerRef.current) {
        notesContainerRef.current.scrollTop = notesContainerRef.current.scrollHeight;
    }
  }, [sessionNotes]);

  useEffect(() => {
    return () => {
      stopConversation();
    };
  }, [stopConversation]);

  return (
    <div className="flex h-full gap-4">
      <div className="flex flex-col flex-1 bg-gray-50 rounded-lg shadow-lg p-6 relative">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Voice Tutor ({config.topic})</h2>
          <div className="flex gap-2">
            <Button 
                variant="secondary" 
                onClick={() => setShowNotes(!showNotes)}
                className="lg:hidden"
            >
                {showNotes ? 'Hide Notes' : 'Show Notes'} {sessionNotes.length > 0 && `(${sessionNotes.length})`}
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
            <button onClick={() => setError(null)} className="absolute top-0 bottom-0 right-0 px-4 py-3" aria-label="Close">
                <svg className="fill-current h-6 w-6 text-red-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
            </button>
          </div>
        )}

        {isLoadingMedia && (
          <div className="flex flex-col items-center justify-center p-4 absolute inset-0 bg-white/80 z-10 rounded-lg">
            <Spinner size="lg" />
            <p className="mt-3 text-gray-700 text-lg">Connecting to Professor Spark...</p>
          </div>
        )}

        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 bg-white rounded-lg border border-gray-200 mb-4 custom-scrollbar">
          {conversation.length === 0 && !isRecording && !isLoadingMedia ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-lg text-center">
              <p className="mb-2">Click "Start Conversation" to begin.</p>
              <p className="text-sm">The AI tutor will help you practice {config.topic} at a {config.level} level.</p>
            </div>
          ) : (
            conversation.map((msg, index) => (
              <div
                key={index}
                className={`flex mb-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-lg shadow-md relative ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
                  }`}
                >
                    <p className="leading-relaxed whitespace-pre-wrap">
                      {msg.role === 'ai' ? parseVocabulary(msg.text, index) : msg.text}
                    </p>
                    
                    {/* Inline Feedback Card if available */}
                    {msg.role === 'ai' && msg.feedback && (
                        <div className={`mt-3 pt-3 border-t ${msg.feedback.type === 'improvement' ? 'border-purple-200 bg-purple-50' : 'border-red-200 bg-red-50'} -mx-3 -mb-3 p-3 rounded-b-lg`}>
                             <div className="flex items-start">
                                <span className={`${msg.feedback.type === 'improvement' ? 'text-purple-500' : 'text-red-500'} mr-2 mt-0.5`}>
                                    {msg.feedback.type === 'improvement' ? (
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                                      </svg>
                                    ) : (
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                </span>
                                <div>
                                    <p className={`text-xs font-bold ${msg.feedback.type === 'improvement' ? 'text-purple-700' : 'text-red-600'} uppercase tracking-wider mb-1`}>
                                        {msg.feedback.type === 'improvement' ? 'Native Suggestion' : `Correction (${msg.feedback.type})`}
                                    </p>
                                    <p className="text-sm text-gray-600 line-through mb-1">{msg.feedback.original}</p>
                                    <p className="text-sm text-green-700 font-semibold mb-1">{msg.feedback.correction}</p>
                                    <p className="text-xs text-gray-500 italic">{msg.feedback.explanation}</p>
                                </div>
                             </div>
                        </div>
                    )}
                </div>
              </div>
            ))
          )}
          {(isRecording || currentInputTranscription) && (
             <div className="flex justify-end mb-4">
                <div className="max-w-[85%] p-3 rounded-lg shadow-md bg-indigo-200 text-indigo-800 rounded-br-none flex items-center gap-3">
                    <AudioPulse active={true} mode="listening" />
                    <p className="leading-relaxed">You: {currentInputTranscription || 'Listening...'}</p>
                </div>
             </div>
          )}
          {(isSessionReady && currentOutputTranscription) && (
              <div className="flex justify-start mb-4">
                <div className="max-w-[85%] p-3 rounded-lg shadow-md bg-gray-100 text-gray-700 rounded-bl-none flex items-center gap-3">
                    <AudioPulse active={true} mode="speaking" />
                    <p className="leading-relaxed">Professor Spark: {currentOutputTranscription || 'Speaking...'}</p>
                </div>
              </div>
          )}
        </div>

        <div className="flex flex-col items-center justify-center p-4 bg-white rounded-lg border border-gray-200 sticky bottom-0 z-10 -mx-6 -mb-6">
            <p className="text-gray-600 mb-3 text-center text-md">
                {isRecording ? 'Microphone Active - Speak naturally' : 'Ready to start'}
            </p>
            <div className="flex items-center justify-center w-full max-w-md gap-4">
                <Button
                    onClick={startConversation}
                    disabled={isRecording || isLoadingMedia}
                    loading={isLoadingMedia}
                    className="flex-1"
                >
                    {isLoadingMedia ? 'Starting...' : (isRecording ? 'Session Active' : 'Start Conversation')}
                </Button>
                <Button
                    onClick={stopConversation}
                    disabled={!isRecording && !isLoadingMedia}
                    variant="danger"
                    className="flex-1"
                >
                    End Session
                </Button>
            </div>
        </div>
      </div>

      {/* Learning Board Sidebar */}
      <div className={`
        fixed inset-y-0 right-0 z-20 w-80 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out
        lg:relative lg:translate-x-0 lg:shadow-none lg:w-80 lg:flex lg:flex-col lg:bg-gray-50 lg:rounded-lg lg:border lg:border-gray-200
        ${showNotes ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-4 bg-indigo-600 text-white rounded-t-lg lg:rounded-t-lg flex justify-between items-center">
            <h3 className="font-bold text-lg">Learning Board</h3>
            <button onClick={() => setShowNotes(false)} className="lg:hidden text-white hover:text-indigo-200">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
        <div ref={notesContainerRef} className="flex-1 overflow-y-auto p-4 bg-white lg:bg-gray-50 custom-scrollbar">
            {sessionNotes.length === 0 ? (
                <div className="text-center text-gray-500 mt-10">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    <p>No corrections yet.</p>
                    <p className="text-sm mt-1">Speak to the AI, and your corrections will appear here!</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {sessionNotes.map((note, i) => (
                        <div key={i} className="bg-white p-3 rounded-lg shadow border border-gray-100">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-bold uppercase mb-2 ${
                                note.type === 'improvement' ? 'bg-purple-100 text-purple-800' :
                                note.type === 'grammar' ? 'bg-red-100 text-red-800' :
                                note.type === 'pronunciation' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-blue-100 text-blue-800'
                            }`}>
                                {note.type}
                            </span>
                            <div className="space-y-1">
                                <p className="text-xs text-gray-500">Original:</p>
                                <p className="text-sm text-red-500 line-through bg-red-50 p-1 rounded">{note.original}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                    {note.type === 'improvement' ? 'Better way:' : 'Correction:'}
                                </p>
                                <p className="text-sm font-bold text-green-600 bg-green-50 p-1 rounded">{note.correction}</p>
                                <p className="text-xs text-gray-600 italic mt-2 border-t pt-2">{note.explanation}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default VoiceChat;