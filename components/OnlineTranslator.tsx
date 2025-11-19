import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LiveServerMessage } from '@google/genai';
import { setupLiveSession, LiveClientType } from '../services/geminiService.ts';
import { Message, AppMode } from '../types.ts';
import Button from './Button.tsx';
import Spinner from './Spinner.tsx';
import AudioPulse from './AudioPulse.tsx';

const OnlineTranslator: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSessionReady, setIsSessionReady] = useState<boolean>(false);
  const [isLoadingMedia, setIsLoadingMedia] = useState<boolean>(false);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [currentAiResponseText, setCurrentAiResponseText] = useState<string>(''); 
  const [currentInputTranscription, setCurrentInputTranscription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const liveSessionRef = useRef<LiveClientType | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputNodeRef = useRef<GainNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const currentAiResponseTextRef = useRef('');
  const currentInputTranscriptionRef = useRef('');
  useEffect(() => { currentAiResponseTextRef.current = currentAiResponseText; }, [currentAiResponseText]);
  useEffect(() => { currentInputTranscriptionRef.current = currentInputTranscription; }, [currentInputTranscription]);

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
    nextStartTimeRef.current = 0;

    setCurrentInputTranscription('');
    setCurrentAiResponseText('');
  }, [stopMediaStream, resetAudioContexts]);

  const handleApiError = useCallback((e: Event) => {
    const errorMsg = (e as ErrorEvent).message || 'Unknown error';
    console.error('API Error Detected:', errorMsg);
    if (errorMsg.includes("Requested entity was not found.") || errorMsg.includes("Network error")) {
      setError(`API Key Error: Your API key might be invalid or unauthorized for this model. Please re-select your API key.`);
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
      setError(`Translation Error: ${errorMsg}. Please try again.`);
      stopConversation();
    }
  }, [stopConversation]);

  const onOpenCallback = useCallback(() => {
    console.log('Live session opened for Online Translator.');
    setIsSessionReady(true);
    setIsLoadingMedia(false);
    setConversation(prev => [...prev, { role: 'ai', text: `Ready. I will translate English to Spanish (and vice versa) for you.`, isThinking: false }]);
  }, []);

  const onMessageLogic = useCallback(async (message: LiveServerMessage) => {
    // NOTE: Audio is handled globally in geminiService.ts, do not double-play it here.
    
    const interrupted = message.serverContent?.interrupted;
    if (interrupted) {
        // If interrupted, geminiService stops the audio, we just handle UI state.
        nextStartTimeRef.current = 0;
    }

    if (message.serverContent?.inputTranscription) {
      setCurrentInputTranscription(prev => prev + message.serverContent.inputTranscription.text);
    }
    if (message.serverContent?.outputTranscription) {
      setCurrentAiResponseText(prev => prev + message.serverContent.outputTranscription.text);
    }

    if (message.serverContent?.turnComplete) {
      const latestInputTranscription = currentInputTranscriptionRef.current;
      const latestAiResponseText = currentAiResponseTextRef.current;
      
      let newMessages: Message[] = [];
      if (latestInputTranscription) {
        newMessages.push({ role: 'user', text: latestInputTranscription, isThinking: false });
      }

      if (latestAiResponseText) {
        // The model now just speaks the translation, so we show it directly.
        newMessages.push({ role: 'ai', text: latestAiResponseText, isThinking: false });
      }
      
      if (newMessages.length > 0) {
        setConversation(prev => [...prev, ...newMessages]);
      }

      setCurrentInputTranscription('');
      setCurrentAiResponseText('');
    }
  }, []);

  const onCloseCallback = useCallback((e: CloseEvent) => {
    console.log('Live session closed for Online Translator:', e.code, e.reason);
    if(isRecording) {
      setError('Translation session closed unexpectedly. Please start a new session.');
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
          mode: AppMode.ONLINE_TRANSLATOR,
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
      console.error('Error initializing audio or Live API for Online Translator:', err);
      setError(`Failed to start translator: ${err.message}. Please check microphone permissions and try again.`);
      setIsLoadingMedia(false);
      setIsSessionReady(false);
      stopConversation();
    }
  }, [stopMediaStream, resetAudioContexts, onOpenCallback, onMessageLogic, handleApiError, onCloseCallback, stopConversation]);

  const startTranslation = useCallback(() => {
    if (!isRecording) {
      setConversation([]);
      setCurrentInputTranscription('');
      setCurrentAiResponseText('');
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
  }, [conversation, currentInputTranscription, currentAiResponseText]);

  useEffect(() => {
    return () => {
      stopConversation();
    };
  }, [stopConversation]);

  const currentStatusText = isRecording ? (
    currentInputTranscription ? `Escuchando: "${currentInputTranscription}"` : 'Listening / Escuchando...'
  ) : (
    'Click "Start Translation" to begin.'
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 rounded-lg shadow-lg p-6">
      <h2 className="text-3xl font-bold text-gray-800 mb-4 text-center">Online Translator (English ↔ Español)</h2>

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

      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 bg-white rounded-lg border border-gray-200 mb-4 custom-scrollbar">
        {conversation.length === 0 && !isRecording && !isLoadingMedia ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-lg text-center">
            <p className="mb-2 font-semibold text-gray-800">Welcome to the Online Translator!</p>
            <p className="text-sm mb-2">
              Speak in <b>English</b> to get a <b>Spanish</b> translation.
            </p>
            <p className="text-sm mb-2">
              Habla en <b>Español</b> para obtener una traducción al <b>Inglés</b>.
            </p>
            <p className="text-sm text-indigo-600 font-medium mt-4">
              (Translations will appear in large text for easy reading)
            </p>
          </div>
        ) : (
          conversation.map((msg, index) => (
            <div
              key={index}
              className={`flex mb-6 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] p-4 rounded-2xl shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-gray-100 text-gray-600 rounded-br-none'
                    : 'bg-indigo-50 text-indigo-900 border border-indigo-100 rounded-bl-none'
                }`}
              >
                <p className="text-xs opacity-60 mb-2 font-bold uppercase tracking-widest">
                    {msg.role === 'user' ? 'Original Input' : 'Translation'}
                </p>
                <p className={`leading-relaxed whitespace-pre-wrap font-medium ${msg.role === 'user' ? 'text-base' : 'text-2xl md:text-3xl'}`}>
                    {msg.text}
                </p>
              </div>
            </div>
          ))
        )}
        {(isRecording || currentInputTranscription) && (
            <div className="flex justify-end mb-4">
                <div className="max-w-[85%] p-4 rounded-2xl shadow-sm bg-gray-50 text-gray-500 rounded-br-none flex items-center gap-3 border border-gray-200">
                    <AudioPulse active={true} mode="listening" />
                    <p className="leading-relaxed italic">... {currentInputTranscription}</p>
                </div>
            </div>
        )}
        {(isSessionReady && currentAiResponseText) && (
            <div className="flex justify-start mb-4">
                <div className="max-w-[85%] p-4 rounded-2xl shadow-sm bg-indigo-50 text-indigo-800 rounded-bl-none flex items-center gap-3 border border-indigo-100">
                    <AudioPulse active={true} mode="speaking" />
                    <p className="leading-relaxed text-xl font-medium">... {currentAiResponseText}</p>
                </div>
            </div>
        )}
      </div>

      <div className="flex flex-col items-center justify-center p-4 bg-white rounded-lg border border-gray-200 sticky bottom-0 z-10 -mx-6 -mb-6">
        <p className="text-gray-600 mb-3 text-center text-md font-medium">{isLoadingMedia ? 'Initializing microphone...' : currentStatusText}</p>
        <div className="flex items-center justify-center w-full max-w-md">
          <Button
            onClick={startTranslation}
            disabled={isRecording || isLoadingMedia}
            loading={isLoadingMedia}
            className="mr-4 w-48"
          >
            {isLoadingMedia ? 'Initializing...' : (isRecording ? 'Listening...' : 'Start Translation')}
          </Button>
          <Button
            onClick={stopConversation}
            disabled={!isRecording && !isLoadingMedia}
            variant="danger"
            className="w-48"
          >
            Stop Translation
          </Button>
        </div>
      </div>
    </div>
  );
};

export default OnlineTranslator;