/**
 * LoadingScreen - Full-screen loading indicator
 * 
 * Clean, minimal loading state with ALIN branding.
 */

import { motion } from 'framer-motion';
import { SparklesIcon } from '@heroicons/react/24/outline';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-primary">
      <div className="flex flex-col items-center gap-8">
        {/* Animated Logo */}
        <motion.div
          className="relative flex h-16 w-16 items-center justify-center"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Outer glow ring */}
          <motion.div
            className="absolute inset-0 rounded-2xl border border-brand-primary/20"
            animate={{
              boxShadow: [
                '0 0 20px rgba(99, 102, 241, 0.1)',
                '0 0 40px rgba(99, 102, 241, 0.2)',
                '0 0 20px rgba(99, 102, 241, 0.1)',
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* Icon */}
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-primary/10">
            <SparklesIcon className="h-6 w-6 text-brand-primary" />
          </div>
        </motion.div>
        
        {/* Loading Text */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <p className="text-sm font-medium text-text-secondary">
            {message}
          </p>
        </motion.div>
        
        {/* Minimal progress dots */}
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-1 w-1 rounded-full bg-text-quaternary"
              animate={{
                opacity: [0.3, 1, 0.3],
                scale: [0.8, 1.2, 0.8],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
