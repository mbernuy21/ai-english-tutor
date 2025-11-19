import React, { useState, useEffect } from 'react';
import VoiceChat from './components/VoiceChat.tsx';
import TextChat from './components/TextChat.tsx';
import SpanishTranslator from './components/SpanishTranslator.tsx';
import OnlineTranslator from './components/OnlineTranslator.tsx';
import { LearningLevel, LearningTopic, AppMode } from './types.ts';
import Button from './components/Button.tsx';
import { getApiKey } from './utils/env.ts';

function App() {
  const [selectedLevel, setSelectedLevel] = useState<LearningLevel>(LearningLevel.BEGINNER);
  const [selectedTopic, setSelectedTopic] = useState<LearningTopic>(LearningTopic.GENERAL);
  const [appMode, setAppMode] = useState<AppMode>(AppMode.VOICE_TUTOR);
  const [isApiKeySelected, setIsApiKeySelected] = useState<boolean>(false);
  const [isAiStudioEnvironment, setIsAiStudioEnvironment] = useState<boolean>(false);

  // Check for API key selection on mount
  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        setIsAiStudioEnvironment(true);
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setIsApiKeySelected(hasKey);
      } else {
        setIsAiStudioEnvironment(false);
        // Use safe getter that checks various env locations
        const key = getApiKey();
        setIsApiKeySelected(!!key);
      }
    };
    checkApiKey();
  }, []);

  const handleSelectApiKey = async () => {
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      await window.aistudio.openSelectKey();
      setIsApiKeySelected(true);
      alert("Please ensure your API key has access to the Gemini API. Billing information: ai.google.dev/gemini-api/docs/billing");
    } else {
      alert("API Key selection is not available in this environment. Please ensure environment variables are configured.");
    }
  };

  if (!isApiKeySelected) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 p-4 font-sans">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full text-center border border-indigo-100">
          <div className="mb-6 flex justify-center">
             <div className="bg-indigo-100 p-4 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
             </div>
          </div>

          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Setup Required</h1>
          <p className="text-gray-500 mb-8">To use the AI English Tutor, you need to connect your Google Gemini API Key.</p>
          
          {isAiStudioEnvironment ? (
            <div className="space-y-4">
              <p className="text-lg text-gray-700">
                You are in Google AI Studio. Simply click the button below to select your key.
              </p>
              <Button onClick={handleSelectApiKey} variant="primary" className="w-full py-3 text-lg shadow-lg shadow-indigo-200">
                Select API Key
              </Button>
            </div>
          ) : (
            <div className="text-left bg-gray-50 rounded-xl p-6 border border-gray-200">
               <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <span className="bg-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2">1</span>
                  Get your API Key
               </h3>
               <div className="mb-6 pl-8">
                  <p className="text-sm text-gray-600 mb-3">Generate a free API key from Google AI Studio.</p>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200 transition-colors"
                  >
                    Get API Key <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
               </div>

               <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <span className="bg-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2">2</span>
                  Configure Vercel (Recommended)
               </h3>
               <div className="pl-8 text-sm text-gray-600 space-y-3">
                  <p>In Vercel Settings &rarr; Environment Variables, add <strong>BOTH</strong> of these to be safe (some frameworks require the VITE_ prefix):</p>
                  
                  <div className="bg-gray-100 p-3 rounded-md border border-gray-300 space-y-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white border border-gray-300 p-2 rounded text-gray-900 font-mono text-sm font-bold">VITE_API_KEY</div>
                        <div className="bg-white border border-gray-300 p-2 rounded text-gray-500 font-mono text-sm italic overflow-hidden text-ellipsis">AIzaSy... (Paste Key)</div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white border border-gray-300 p-2 rounded text-gray-900 font-mono text-sm font-bold">API_KEY</div>
                        <div className="bg-white border border-gray-300 p-2 rounded text-gray-500 font-mono text-sm italic overflow-hidden text-ellipsis">AIzaSy... (Paste Key)</div>
                    </div>
                  </div>
                  
                  <p className="mt-2">Then click <strong>Save</strong> and then <strong>Redeploy</strong>.</p>
               </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 p-4 sm:p-6 lg:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col lg:flex-row">
        <div className="w-full lg:w-1/4 bg-indigo-700 p-4 text-white flex flex-col">
          <h1 className="text-3xl font-bold mb-6">AI Tutor</h1>
          <nav className="flex flex-col space-y-2 mb-6">
            <Button
              variant={appMode === AppMode.VOICE_TUTOR ? 'secondary' : 'primary'}
              className={`w-full text-left justify-start ${appMode === AppMode.VOICE_TUTOR ? 'bg-indigo-300 text-indigo-900' : 'bg-indigo-600 hover:bg-indigo-500'} transition duration-200`}
              onClick={() => setAppMode(AppMode.VOICE_TUTOR)}
            >
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m7 0V5a2 2 0 012-2h2a2 2 0 012 2v6m-7 0h2"/>
                </svg>
                Voice Tutor
              </span>
            </Button>
            <Button
              variant={appMode === AppMode.TEXT_CHAT ? 'secondary' : 'primary'}
              className={`w-full text-left justify-start ${appMode === AppMode.TEXT_CHAT ? 'bg-indigo-300 text-indigo-900' : 'bg-indigo-600 hover:bg-indigo-500'} transition duration-200`}
              onClick={() => setAppMode(AppMode.TEXT_CHAT)}
            >
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Text Chat
              </span>
            </Button>
            <Button
              variant={appMode === AppMode.GRAMMAR_CHECK ? 'secondary' : 'primary'}
              className={`w-full text-left justify-start ${appMode === AppMode.GRAMMAR_CHECK ? 'bg-indigo-300 text-indigo-900' : 'bg-indigo-600 hover:bg-indigo-500'} transition duration-200`}
              onClick={() => setAppMode(AppMode.GRAMMAR_CHECK)}
            >
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                Grammar Check
              </span>
            </Button>
            <Button
              variant={appMode === AppMode.SPANISH_TRANSLATOR ? 'secondary' : 'primary'}
              className={`w-full text-left justify-start ${appMode === AppMode.SPANISH_TRANSLATOR ? 'bg-indigo-300 text-indigo-900' : 'bg-indigo-600 hover:bg-indigo-500'} transition duration-200`}
              onClick={() => setAppMode(AppMode.SPANISH_TRANSLATOR)}
            >
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26c.45.3.99.44 1.5.44s1.05-.14 1.5-.44L21 8m-10 12l2.39-1.92c.5-.4.81-1.04.81-1.74V12H3v4.34c0 .7.31 1.34.81 1.74L6 20m5-8V5c0-.55-.45-1-1-1H7a1 1 0 00-1 1v7m10-7v7m-4-7V5c0-.55-.45-1-1-1h-3a1 1 0 00-1 1v7" />
                </svg>
                Dilo en Español
              </span>
            </Button>
            <Button
              variant={appMode === AppMode.ONLINE_TRANSLATOR ? 'secondary' : 'primary'}
              className={`w-full text-left justify-start ${appMode === AppMode.ONLINE_TRANSLATOR ? 'bg-indigo-300 text-indigo-900' : 'bg-indigo-600 hover:bg-indigo-500'} transition duration-200`}
              onClick={() => setAppMode(AppMode.ONLINE_TRANSLATOR)}
            >
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m0 0a9 9 0 019-9m-9 9a9 9 0 009 9" />
                </svg>
                Online Translator
              </span>
            </Button>
          </nav>

          {appMode === AppMode.VOICE_TUTOR && ( // Only show settings for Voice Tutor mode
            <div className="space-y-4">
              <h3 className="text-xl font-semibold mb-2">Voice Tutor Settings</h3>
              <div>
                <label htmlFor="level-select" className="block text-sm font-medium mb-1">Learning Level:</label>
                <select
                  id="level-select"
                  className="block w-full p-2 border border-gray-300 rounded-md bg-white text-gray-800 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  value={selectedLevel}
                  onChange={(e) => setSelectedLevel(e.target.value as LearningLevel)}
                >
                  {Object.values(LearningLevel).map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="topic-select" className="block text-sm font-medium mb-1">Learning Topic:</label>
                <select
                  id="topic-select"
                  className="block w-full p-2 border border-gray-300 rounded-md bg-white text-gray-800 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  value={selectedTopic}
                  onChange={(e) => setSelectedTopic(e.target.value as LearningTopic)}
                >
                  {Object.values(LearningTopic).map((topic) => (
                    <option key={topic} value={topic}>{topic}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <main className="w-full lg:w-3/4 p-4 sm:p-6 lg:p-8 flex-1 min-h-[80vh] flex flex-col">
          {appMode === AppMode.VOICE_TUTOR && (
            <VoiceChat config={{ level: selectedLevel, topic: selectedTopic }} />
          )}
          {appMode === AppMode.TEXT_CHAT && (
            <TextChat mode="text_chat" />
          )}
          {appMode === AppMode.GRAMMAR_CHECK && (
            <TextChat mode="grammar_check" />
          )}
          {appMode === AppMode.SPANISH_TRANSLATOR && (
            <SpanishTranslator />
          )}
          {appMode === AppMode.ONLINE_TRANSLATOR && (
            <OnlineTranslator />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;