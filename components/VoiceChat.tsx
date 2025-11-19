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
        console.error("Error playing pronunciation example:",