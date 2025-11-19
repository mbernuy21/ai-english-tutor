import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LiveServerMessage } from '@google/genai';
import { setupLiveSession, generateSpeechForText, LiveClientType } from '../services/geminiService.ts';
import { Message, AppMode } from '../types.ts';
import Button from './Button.tsx';
import Spinner from './Spinner.tsx';
import AudioPulse from './AudioPulse.tsx';
import { decode, decodeAudioData } from '../utils/audioUtils.ts';

const SpanishTranslator: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSessionReady, setIsSessionReady] = useState<boolean>(false);
  const [isLoadingMedia, setIsLoadingMedia] = useState<boolean>(false);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [currentInputTranscription, setCurrentInputTranscription] = useState<string>('');
  const [currentOutputTranscription, setCurrentOutputTranscription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [playingPronunciationIndex, setPlayingPronunciationIndex] = useState<number | null>(null);
  const [currentTurnStage, setCurrentTurnStage] = useState<'spanish_input' | 'english_pronunciation'>('spanish_input');

  const liveSessionRef = useRef<LiveClientType | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputNodeRef = useRef<GainNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const currentPronunciationSource = useRef<AudioBufferSourceNode | null>(null);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const currentTurnStageRef = useRef(currentTurnStage);
  useEffect(() => { currentInputTranscriptionRef.current = currentInputTranscription; }, [currentInputTranscription]);
  useEffect(() => { currentOutputTranscriptionRef.current = currentOutputTranscription; }, [currentOutputTranscription]);
  useEffect(() => { currentTurnStageRef.current = currentTurnStage; }, [currentTurnStage]);

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

  const parseFeedback = useCallback((aiResponseText: string): { conversationalText: string; feedback?: { text: string; type: Message['feedbackType']; pronunciationExampleText?: string } } => {
    const pronunciationTipMarker = '💡 Pronunciation Tip:';
    let conversationalText = aiResponseText;
    let feedback: { text: string; type: Message['feedbackType']; pronunciationExampleText?: string } | undefined;

    let startIndex = aiResponseText.indexOf(pronunciationTipMarker);
    if (startIndex !== -1) {
      conversationalText = aiResponseText.substring(0, startIndex).trim();
      const feedbackText = aiResponseText.substring(startIndex).trim();
      const pronunciationMatch = feedbackText.match(/\*\*(.*?)\*\*/);
      
      feedback = {
        text: feedbackText,
        type: 'pronunciation',
        pronunciationExampleText: pronunciationMatch ? pronunciationMatch[1] : undefined,
      };
    } else {
        const pronunciationMatch = aiResponseText.match(/\*\*(.*?)\*\*/);
        if (pronunciationMatch) {
             feedback = {
                 text: '',
                 type: 'general',
                 pronunciationExampleText: pronunciationMatch[1],
             };
        }
    }
    return { conversationalText, feedback };
  }, []);

  const playPronunciationExample = useCallback(async (text: string, index: number) => {
    if (!outputAudioContextRef.current || playingPronunciationIndex !== null) return;

    setPlayingPronunciationIndex(index);
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
            setPlayingPronunciationIndex(null);
            currentPronunciationSource.current = null;
        };
        source.start(0);
        currentPronunciationSource.current = source;
    } catch (err) {
        console.error("Error playing pronunciation example:", err);
        setError("Could not play pronunciation example. Please try again.");
        setPlayingPronunciationIndex(null);
    }
  }, [playingPronunciationIndex]);

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
    setPlayingPronunciationIndex(null);
    nextStartTimeRef.current = 0;
    setCurrentTurnStage('spanish_input');

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
    console.log('Live session opened for Spanish Translator.');
    setIsSessionReady(true);
    setIsLoadingMedia(false);
    setConversation(prev => [...prev, { role: 'ai', text: `Hola! Soy Profesor Spark. Diga una frase en español y la traduciré a inglés para usted.`, isThinking: false }]);
    setCurrentTurnStage('spanish_input');
  }, []);

  const onMessageLogic = useCallback(async (message: LiveServerMessage) => {
    if (message.serverContent?.outputTranscription) {
      setCurrentOutputTranscription(prev => prev + message.serverContent.outputTranscription.text);
    }
    if (message.serverContent?.inputTranscription) {
      setCurrentInputTranscription(prev => prev + message.serverContent.inputTranscription.text);
    }
  
    if (message.serverContent?.turnComplete) {
      const currentTurn = currentTurnStageRef.current;
      const latestInputTranscription = currentInputTranscriptionRef.current;
      const latestOutputTranscription = currentOutputTranscriptionRef.current;

      let newMessages: Message[] = [];

      if (latestInputTranscription) {
        const userMessageText = currentTurn === 'spanish_input' ? `(Español) ${latestInputTranscription}` : `(English Attempt) ${latestInputTranscription}`;
        newMessages.push({ role: 'user', text: userMessageText, isThinking: false });
      }

      if (latestOutputTranscription) {
        const { conversationalText, feedback } = parseFeedback(latestOutputTranscription);
        newMessages.push({
          role: 'ai',
          text: conversationalText,
          feedbackText: feedback?.text,
          feedbackType: feedback?.type,
          pronunciationExampleText: feedback?.pronunciationExampleText,
          isThinking: false,
        });
      }

      if (newMessages.length > 0) {
        setConversation(prev => [...prev, ...newMessages]);
      }
      
      if (currentTurn === 'spanish_input') {
        setCurrentTurnStage('english_pronunciation');
      } else {
        setCurrentTurnStage('spanish_input');
      }
  
      setCurrentInputTranscription('');
      setCurrentOutputTranscription('');
    }
  }, [parseFeedback]);

  const onCloseCallback = useCallback((e: CloseEvent) => {
    console.log('Live session closed for Spanish Translator:', e.code, e.reason);
    if(isRecording) {
      setError('Conversation session closed unexpectedly. Please start a new session.');
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
          mode: AppMode.SPANISH_TRANSLATOR,
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
  }, [stopMediaStream, resetAudioContexts, onOpenCallback, onMessageLogic, handleApiError, onCloseCallback, stopConversation]);

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
    return () => {
      stopConversation();
    };
  }, [stopConversation]);

  const currentStatusText = isRecording ? (
    currentTurnStage === 'spanish_input' ? 'Say a phrase in Spanish...' : 'Now, say it in English for pronunciation practice...'
  ) : (
    'Click "Start Translation" to begin.'
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 rounded-lg shadow-lg p-6">
      <h2 className="text-3xl font-bold text-gray-800 mb-4 text-center">Dilo en Español (Translator &amp; Pronunciation)</h2>

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
            <p className="mb-2">Click "Start Translation" to begin!</p>
            <p className="text-sm">Say something in Spanish, and Professor Spark will translate it to English and help you with pronunciation.</p>
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
                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                {msg.feedbackText && (
                    <div className="mt-2 p-2 text-sm bg-indigo-100 text-indigo-800 rounded-md">
                        <p className="font-medium flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Pronunciation Tip
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{msg.feedbackText}</p>
                        {msg.pronunciationExampleText && (
                            <Button
                                onClick={() => playPronunciationExample(msg.pronunciationExampleText!, index)}
                                disabled={playingPronunciationIndex !== null}
                                loading={playingPronunciationIndex === index}
                                variant="secondary"
                                className="mt-2 text-xs py-1 px-2 !bg-indigo-200 !text-indigo-900 hover:!bg-indigo-300"
                            >
                                {playingPronunciationIndex === index ? 'Playing...' : `Play "${msg.pronunciationExampleText}"`}
                            </Button>
                        )}
                    </div>
                )}
                {!msg.feedbackText && msg.pronunciationExampleText && msg.role === 'ai' && (
                   <Button
                        onClick={() => playPronunciationExample(msg.pronunciationExampleText!, index)}
                        disabled={playingPronunciationIndex !== null}
                        loading={playingPronunciationIndex === index}
                        variant="secondary"
                        className="mt-2 text-xs py-1 px-2 !bg-indigo-200 !text-indigo-900 hover:!bg-indigo-300"
                    >
                        {playingPronunciationIndex === index ? 'Playing...' : `Play "${msg.pronunciationExampleText}"`}
                    </Button>
                )}
              </div>
            </div>
          ))
        )}
        {(isRecording || currentInputTranscription) && (
            <div className="flex justify-end mb-4">
                <div className="max-w-3/4 p-3 rounded-lg shadow-md bg-indigo-200 text-indigo-800 rounded-br-none flex items-center gap-3">
                    <AudioPulse active={true} mode="listening" />
                    <p className="leading-relaxed">You: {currentInputTranscription || 'Escuchando...'}</p>
                </div>
            </div>
        )}
        {(isSessionReady && currentOutputTranscription) && (
            <div className="flex justify-start mb-4">
                <div className="max-w-3/4 p-3 rounded-lg shadow-md bg-gray-100 text-gray-700 rounded-bl-none flex items-center gap-3">
                    <AudioPulse active={true} mode="speaking" />
                    <p className="leading-relaxed">Professor Spark: {currentOutputTranscription || 'Speaking...'}</p>
                </div>
            </div>
        )}
      </div>

      <div className="flex flex-col items-center justify-center p-4 bg-white rounded-lg border border-gray-200 sticky bottom-0 z-10 -mx-6 -mb-6">
        <p className="text-gray-600 mb-3 text-center text-md">{isLoadingMedia ? 'Initializing microphone...' : currentStatusText}</p>
        <div className="flex items-center justify-center w-full max-w-md">
          <Button
            onClick={startConversation}
            disabled={isRecording || isLoadingMedia}
            loading={isLoadingMedia}
            className="mr-4 w-48"
          >
            {isLoadingMedia ? 'Initializing...' : (isRecording ? 'Translating...' : 'Start Translation')}
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

export default SpanishTranslator;