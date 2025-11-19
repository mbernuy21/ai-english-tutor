import React from 'react';

interface AudioPulseProps {
  active: boolean;
  mode: 'listening' | 'speaking';
  className?: string;
}

const AudioPulse: React.FC<AudioPulseProps> = ({ active, mode, className = '' }) => {
  if (!active) return null;

  const barCount = 5;
  // Indigo for user input (listening), Emerald for AI output (speaking)
  const baseColor = mode === 'listening' ? 'bg-indigo-600' : 'bg-emerald-500';

  return (
    <div className={`flex items-center justify-center gap-1 h-6 ${className}`}>
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full ${baseColor}`}
          style={{
            animation: 'audio-wave 1s ease-in-out infinite',
            animationDelay: `${i * 0.15}s`,
            height: '100%'
          }}
        />
      ))}
      <style>{`
        @keyframes audio-wave {
          0%, 100% { height: 20%; opacity: 0.6; }
          50% { height: 100%; opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default AudioPulse;