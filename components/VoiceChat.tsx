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
        setError("Could not play pronunciation example. Please try again.");
        setPlayingAudioKey(null);
    }
  }, [playingAudioKey]);

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
    if (errorMsg.includes("Requested entity was not found.") || errorMsg.includes("Network error")) {
      setError(`API Key Error: Your API key might be invalid, unauthorized, or hitting a network issue. Please re-select your API key.`);
      if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
        window.aistudio.openSelectKey().then(() => {
          alert("Your API key might be invalid or unauthorized for this model. Please select a valid key and try again. Billing information: ai.google.dev/gemini-api/docs/billing");
          stopConversation();
        }).catch(selectKeyError => {
          console.error("Error opening select key dialog:", selectKeyError);
          setError(`API Key Error: ${errorMsg}. Failed to open key selection: ${selectKeyError.message}`);
          stopConversation();
        });
      } else {
        setError(`API Key Error: ${errorMsg}. API Key selection functionality is unavailable.`);
        stopConversation();
      }
    } else {
      setError(`Conversation Error: ${errorMsg}. Please try again.`);
      stopConversation();
    }
  }, [stopConversation]);

  const onOpenCallback = useCallback(() => {
    console.log('Live session opened.');
    setIsSessionReady(true);
    setIsLoadingMedia(false);
    setConversation(prev => [...prev, { role: 'ai', text: `Hello! I'm Professor Spark. I'm ready to help you practice English at the ${config.level} level, focusing on "${config.topic}". Let's begin!`, isThinking: false }]);
  }, [config.level, config.topic]);

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

      let newMessages: Message[] = [];
      if (latestInputTranscription) {
        newMessages.push({ role: 'user', text: latestInputTranscription, isThinking: false });
      }
      if (latestOutputTranscription) {
        const { conversationalText, feedback } = parseFeedback(latestOutputTranscription);
        newMessages.push({
          role: 'ai',
          text: conversationalText,
          feedback: feedback,
          isThinking: false,
        });
        
        if (feedback) {
            setSessionNotes(prev => [...prev, feedback!]);
            if (!showNotes) setShowNotes(true);
        }
      }
      
      if (newMessages.length > 0) {
        setConversation(prev => [...prev, ...newMessages]);
      }

      setCurrentInputTranscription('');
      setCurrentOutputTranscription('');
    }
  }, [parseFeedback, showNotes]);

  const onCloseCallback = useCallback((e: CloseEvent) => {
    console.log('Live session closed:', e.code, e.reason);
    if(isRecording) { 
      setError('Conversation session closed unexpectedly. Please start a new session.');
    }
    stopConversation();
  }, [isRecording, stopConversation]);

  const initializeAudio = useCallback(async () => {
    setIsLoadingMedia(true);
    setError(null);
    setSessionNotes([]); 
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
          topic: config.topic,
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
      setError(`Failed to start conversation: ${err.message}. Please check microphone permissions and try again.`);
      setIsLoadingMedia(false);
      setIsSessionReady(false);
      stopConversation();
    }
  }, [config.level, config.topic, stopMediaStream, resetAudioContexts, onOpenCallback, onMessageLogic, handleApiError, onCloseCallback, stopConversation]);

  const startConversation = useCallback(() => {
    if (!isRecording) {
      setConversation([]);
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

  const renderMessageContent = (text: string, msgIndex: number) => {
    // Split by bold markdown **word**
    const parts = text.split(/(\*\*.*?\*\*)/);
    return (
        <p className="leading-relaxed whitespace-pre-wrap">
            {parts.map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                    const word = part.slice(2, -2);
                    const key = `msg-${msgIndex}-word-${i}`;
                    const isPlaying = playingAudioKey === key;
                    return (
                        <button
                            key={i}
                            onClick={() => playPronunciationExample(word, key)}
                            className={`inline-flex items-baseline gap-1 font-bold text-indigo-700 cursor-pointer hover:text-indigo-900 transition-colors mx-0.5 px-1 rounded hover:bg-indigo-100 ${isPlaying ? 'opacity-75' : ''}`}
                            title={`Listen to "${word}"`}
                            disabled={playingAudioKey !== null}
                        >
                            {word}
                            {isPlaying ? (
                                <span className="text-[10px]">🔊</span>
                            ) : (
                                <svg className="w-3 h-3 self-center text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                            )}
                        </button>
                    );
                }
                return <span key={i}>{part}</span>;
            })}
        </p>
    );
  };

  return (
    <div className="flex h-full gap-4">
        <div className="flex flex-col flex-1 bg-gray-50 rounded-lg shadow-lg p-6 relative overflow-hidden">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-3xl font-bold text-gray-800">AI English Tutor</h2>
            <button 
                onClick={() => setShowNotes(!showNotes)}
                className="lg:hidden text-indigo-600 font-semibold text-sm"
            >
                {showNotes ? 'Hide Notes' : 'Show Notes'}
            </button>
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
            <div className="flex flex-col items-center justify-center p-4">
            <Spinner size="lg" />
            <p className="mt-3 text-gray-700 text-lg">Setting up your microphone and connecting to AI...</p>
            </div>
        )}

        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 bg-white rounded-lg border border-gray-200 mb-4 custom-scrollbar relative">
            {conversation.length === 0 && !isRecording && !isLoadingMedia ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-lg">
                <p className="mb-2">Click "Start Practice" to begin your English conversation!</p>
                <p className="text-sm">Current Level: <span className="font-semibold text-indigo-600">{config.level}</span>, Topic: <span className="font-semibold text-indigo-600">{config.topic}</span></p>
            </div>
            ) : (
            conversation.map((msg, index) => (
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
                    {renderMessageContent(msg.text, index)}
                    
                    {/* Enhanced Feedback Card */}
                    {msg.feedback && (
                        <div className="mt-3 bg-white rounded-md p-3 border-l-4 border-indigo-400 shadow-sm text-gray-800">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold uppercase text-indigo-500 tracking-wider">{msg.feedback.type} TIP</span>
                            </div>
                            <div className="mb-2">
                                <p className="text-xs text-red-500 font-semibold mb-0.5">You said:</p>
                                <p className="text-sm text-gray-600 italic">"{msg.feedback.original}"</p>
                            </div>
                            <div className="mb-2">
                                <p className="text-xs text-emerald-600 font-semibold mb-0.5">Better way:</p>
                                <p className="text-sm text-gray-900 font-medium">"{msg.feedback.correction}"</p>
                            </div>
                            <p className="text-xs text-gray-500 border-t border-gray-100 pt-2 mt-2">{msg.feedback.explanation}</p>

                            <Button
                                onClick={() => playPronunciationExample(msg.feedback!.correction, `feedback-${index}`)}
                                disabled={playingAudioKey !== null}
                                loading={playingAudioKey === `feedback-${index}`}
                                variant="secondary"
                                className="mt-3 text-xs py-1.5 px-3 w-full !bg-indigo-50 !text-indigo-700 hover:!bg-indigo-100"
                            >
                                {playingAudioKey === `feedback-${index}` ? 'Playing...' : `🔊 Listen to Correct Pronunciation`}
                            </Button>
                        </div>
                    )}
                </div>
                </div>
            ))
            )}
            
            {/* Real-time Input Visualization */}
            {(isRecording || currentInputTranscription) && (
                <div className="flex justify-end mb-4">
                    <div className="max-w-3/4 p-3 rounded-lg shadow-md bg-indigo-100 text-indigo-800 rounded-br-none flex items-center gap-3">
                        <AudioPulse active={true} mode="listening" />
                        <p className="leading-relaxed font-medium">You: {currentInputTranscription || 'Listening...'}</p>
                    </div>
                </div>
            )}
            
            {/* Real-time Output Visualization */}
            {(isSessionReady && currentOutputTranscription) && (
                <div className="flex justify-start mb-4">
                    <div className="max-w-3/4 p-3 rounded-lg shadow-md bg-emerald-50 text-emerald-800 rounded-bl-none flex items-center gap-3 border border-emerald-100">
                         <AudioPulse active={true} mode="speaking" />
                        <p className="leading-relaxed font-medium">Professor Spark: {currentOutputTranscription || 'Speaking...'}</p>
                    </div>
                </div>
            )}
        </div>

        <div className="flex items-center justify-center p-4 bg-white rounded-lg border border-gray-200 sticky bottom-0 z-10 -mx-6 -mb-6">
            <Button
            onClick={startConversation}
            disabled={isRecording || isLoadingMedia}
            loading={isLoadingMedia}
            className="mr-4 w-48"
            >
            {isLoadingMedia ? 'Initializing...' : (isRecording ? 'Practice in Progress...' : 'Start Practice')}
            </Button>
            <Button
            onClick={stopConversation}
            disabled={!isRecording && !isLoadingMedia}
            variant="danger"
            className="w-48"
            >
            Stop Practice
            </Button>
        </div>
        </div>

        {/* Session Notes Sidebar */}
        <div className={`
            fixed inset-y-0 right-0 w-80 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-20
            lg:relative lg:translate-x-0 lg:w-1/3 lg:shadow-none lg:bg-transparent lg:flex lg:flex-col
            ${showNotes ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
        `}>
            <div className="h-full bg-white rounded-lg shadow-lg border border-gray-200 flex flex-col overflow-hidden">
                <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-indigo-900">Session Notes</h3>
                        <p className="text-xs text-indigo-600">Corrections & Vocabulary detected</p>
                    </div>
                    <button 
                        onClick={() => setShowNotes(false)}
                        className="lg:hidden text-gray-500 hover:text-gray-700"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                
                <div ref={notesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                    {sessionNotes.length === 0 ? (
                        <div className="text-center text-gray-400 mt-10">
                            <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                            <p>No corrections yet.</p>
                            <p className="text-sm mt-1">Speak to Professor Spark!</p>
                        </div>
                    ) : (
                        sessionNotes.map((note, idx) => (
                            <div key={idx} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide
                                        ${note.type === 'grammar' ? 'bg-red-100 text-red-700' : 
                                          note.type === 'pronunciation' ? 'bg-purple-100 text-purple-700' : 
                                          'bg-blue-100 text-blue-700'}`}>
                                        {note.type}
                                    </span>
                                    <span className="text-xs text-gray-400">#{idx + 1}</span>
                                </div>
                                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm">
                                    <span className="text-red-500 font-medium">×</span>
                                    <span className="text-gray-500 line-through decoration-red-300 decoration-2">{note.original}</span>
                                    
                                    <span className="text-emerald-500 font-bold">✓</span>
                                    <span className="text-gray-900 font-medium">{note.correction}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                
                {sessionNotes.length > 0 && (
                     <div className="p-4 border-t border-gray-200 bg-white">
                        <Button variant="secondary" className="w-full text-sm" onClick={() => {
                             const blob = new Blob([JSON.stringify(sessionNotes, null, 2)], {type : 'application/json'});
                             const url = URL.createObjectURL(blob);
                             const a = document.createElement('a');
                             a.href = url;
                             a.download = `session-notes-${new Date().toISOString().slice(0,10)}.json`;
                             a.click();
                        }}>
                            Download Notes
                        </Button>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default VoiceChat;